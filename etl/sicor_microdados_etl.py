#!/usr/bin/env python3
"""
ETL alternativo do Painel do Crédito Rural: microdados do SICOR (arquivos .gz do BCB).

Usado quando a API OData (Olinda) está fora do ar. Os arquivos ficam em
https://www.bcb.gov.br/estabilidadefinanceira/tabelas-credito-rural-proagro
e são atualizados mensalmente pelo BCB.

Cobertura:
- Brasil e UFs: completa (mês, finalidade, atividade, programa, fonte, produto, instituição).
  Conferido contra a API: em 2023, custeio de MG = R$ 29.409.567.821 (API: ...815) e
  120.342 contratos (idem); cada linha do arquivo (REF_BACEN + NU_ORDEM) é um contrato.
- Municípios: PARCIAL. O município só é publicado no arquivo complementar do
  "crédito rural público" (operações com Proagro ou fontes públicas). O ETL mede e grava a
  fração do valor coberta em cada ano (meta.munCobertura) e o painel avisa o usuário.
- Sexo do beneficiário: não existe nos microdados públicos (gen_AAAA.json fica vazio).

Requer: pip install duckdb

Uso:
    python etl/sicor_microdados_etl.py --inicio 2013 --out public/data
    python etl/sicor_microdados_etl.py --dir-local PASTA   # usa .gz já baixados (ex.: pelo navegador)
"""
from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import json
import shutil
import sys
import time
import urllib.request
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).parent))
from sicor_etl import (  # noqa: E402  (reaproveita tabelas e regras do ETL da API)
    FINALIDADES, FONTES, PROGRAMAS, SEXO_NOMES, UFS, _dump, grupo_fonte, grupo_programa, log,
)

URL_BASE = "https://www.bcb.gov.br/htms/sicor/"
URL_DADOS = URL_BASE + "DadosBrutos/"
H8 = ["qC", "vC", "qI", "vI", "qM", "vM", "qN", "vN"]
# 2º dígito do CD_EMPREENDIMENTO -> índice da finalidade no painel
FIN_DIGITO = {"2": 0, "3": 1, "1": 2, "4": 3}
SIGLA_IBGE = {s: v[0] for s, v in UFS.items()}


# --------------------------------------------------------------------------- #
# Download com cache por Last-Modified
# --------------------------------------------------------------------------- #
def _req(url: str, metodo: str = "GET"):
    return urllib.request.urlopen(urllib.request.Request(url, method=metodo, headers={
        "User-Agent": "painel-credito-rural-etl/1.0 (+github.com/Benfluc/painel-credito-rural)"}), timeout=300)


def versao(url: str) -> str:
    try:
        with _req(url, "HEAD") as r:
            return r.headers.get("Last-Modified", "")
    except Exception:  # noqa: BLE001
        return ""


def baixar(url: str, destino: Path, tentativas: int = 4) -> str:
    """Baixa se mudou desde a última vez. Devolve o Last-Modified do servidor."""
    marca = destino.with_suffix(destino.suffix + ".lastmod")
    for t in range(1, tentativas + 1):
        try:
            with _req(url, "HEAD") as r:
                lm = r.headers.get("Last-Modified", "")
            if destino.exists() and marca.exists() and marca.read_text() == lm:
                return lm
            log(f"  baixando {url.rsplit('/', 1)[-1]} …")
            t0 = time.time()
            tmp = destino.with_suffix(destino.suffix + ".part")
            with _req(url) as r, open(tmp, "wb") as fh:
                shutil.copyfileobj(r, fh, 1 << 20)
            tmp.replace(destino)
            marca.write_text(lm)
            log(f"    {destino.stat().st_size / 1e6:.1f} MB em {time.time() - t0:.0f}s")
            return lm
        except Exception as e:  # noqa: BLE001
            if t == tentativas:
                raise
            log(f"  falha ao baixar ({e}); nova tentativa em {10 * t}s")
            time.sleep(10 * t)
    return ""


def ler_texto(p: Path) -> str:
    b = p.read_bytes()
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return b.decode("latin-1")


def tabela_csv(p: Path) -> list[list[str]]:
    linhas = [l for l in ler_texto(p).splitlines() if l.strip()]
    sep = ";" if linhas[0].count(";") >= linhas[0].count(",") else ","
    return [[c.strip().strip('"').strip() for c in l.split(sep)] for l in linhas]


# --------------------------------------------------------------------------- #
def carregar_dominios(con: duckdb.DuckDBPyConnection, pasta: Path) -> tuple[dict, dict]:
    emp = tabela_csv(pasta / "Empreendimento.csv")
    cab = [c.lstrip("#") for c in emp[0]]
    iC, iP = cab.index("CODIGO"), cab.index("PRODUTO")
    produtos = {}
    for r in emp[1:]:
        if len(r) > iP and r[iC]:
            produtos[r[iC]] = r[iP] or "NÃO INFORMADO"
    con.execute("CREATE OR REPLACE TABLE emp(cod VARCHAR, produto VARCHAR)")
    con.executemany("INSERT INTO emp VALUES (?, ?)", list(produtos.items()))

    ifs = {}
    lst = tabela_csv(pasta / "SICOR_LISTA_IFS.csv")
    for r in lst[1:]:
        if len(r) >= 3:
            ifs[r[0]] = (r[1], r[2].capitalize())
    mun = {}
    for r in tabela_csv(pasta / "MunicipiosSicor.csv")[1:]:
        if len(r) >= 3 and len(r[2]) == 7:
            mun[r[2]] = [r[1].title(), r[0]]
    return ifs, mun


def ler_ops(con, arquivo: Path) -> None:
    con.execute(f"""
        CREATE OR REPLACE TABLE ops AS
        SELECT TRY_CAST(c."#REF_BACEN" AS BIGINT)                      AS ref,
               TRY_CAST(c.NU_ORDEM AS INTEGER)                          AS ord,
               TRY_CAST(substr(c.DT_EMISSAO, 4, 2) AS INTEGER)          AS mes,
               c.CD_ESTADO                                               AS uf,
               c.CD_EMPREENDIMENTO                                       AS emp,
               substr(c.CD_EMPREENDIMENTO, 1, 1)                         AS dig_at,
               substr(c.CD_EMPREENDIMENTO, 2, 1)                         AS dig_fin,
               lpad(c.CD_PROGRAMA, 4, '0')                               AS prog,
               lpad(c.CD_FONTE_RECURSO, 4, '0')                          AS fonte,
               c.CNPJ_IF                                                 AS cnpj,
               coalesce(TRY_CAST(c.VL_PARC_CREDITO AS DOUBLE), 0)        AS v,
               coalesce(TRY_CAST(c.VL_AREA_FINANC AS DOUBLE), 0)         AS area
        FROM read_csv('{arquivo.as_posix()}', delim=';', header=true, all_varchar=true,
                      quote='"', compression='gzip', ignore_errors=true) c
    """)


def ler_complemento(con, arquivo: Path) -> None:
    con.execute(f"""
        CREATE OR REPLACE TABLE comp AS
        SELECT TRY_CAST(c."#REF_BACEN" AS BIGINT) AS ref,
               TRY_CAST(c.NU_ORDEM AS INTEGER)    AS ord,
               lpad(CAST(c.CD_IBGE_MUNICIPIO AS VARCHAR), 7, '0') AS ibge
        FROM read_csv('{arquivo.as_posix()}', delim=';', header=true, all_varchar=true,
                      quote='"', compression='gzip', ignore_errors=true) c
    """)
    con.execute("CREATE INDEX IF NOT EXISTS comp_idx ON comp(ref, ord)")


def _m8(q: int, v: float, fin_dig: str) -> list[float]:
    out = [0.0] * 8
    k = FIN_DIGITO.get(fin_dig)
    if k is not None:
        out[2 * k] = q
        out[2 * k + 1] = v
    return out


def _soma(acc: dict, k: tuple, vals: list[float]) -> None:
    a = acc.get(k)
    if a is None:
        acc[k] = list(vals)
    else:
        for i, x in enumerate(vals):
            a[i] += x


def _inteiros(vals: list[float], n_area: int = 0) -> list:
    return [round(x, 1) if n_area and i >= len(vals) - n_area else int(round(x)) for i, x in enumerate(vals)]


def processar_ano(con, ano: int, ifs: dict, out: Path, meta_ant: dict) -> dict:
    at = lambda d: 2 if d == "2" else 1  # noqa: E731

    # ---- UF mensal ----
    acc: dict = {}
    for mes, uf, dig_at, dig_fin, prog, fonte, q, v in con.execute("""
        SELECT mes, uf, dig_at, dig_fin, prog, fonte, count(*), sum(v)
        FROM ops GROUP BY ALL""").fetchall():
        ibge = SIGLA_IBGE.get((uf or "").upper())
        if not ibge or not mes:
            continue
        _soma(acc, (mes, ibge, at(dig_at), grupo_programa(prog), grupo_fonte(fonte)), _m8(q, v, dig_fin))
    meses = sorted({k[0] for k in acc})
    _dump(out / f"uf_{ano}.json", {"h": ["mes", "uf", "at", "pg", "fg"] + H8,
                                     "r": [list(k) + _inteiros(v) for k, v in sorted(acc.items())]})
    anual: dict = {}
    for (mes, uf, a, pg, fg), v in acc.items():
        _soma(anual, (ano, uf, a, pg), v)

    # ---- Municípios (só operações com município publicado) ----
    total_q, total_v = con.execute("SELECT count(*), sum(v) FROM ops").fetchone()
    total_v = total_v or 0
    fonte_mun = (meta_ant.get("munFonte") or {}).get(str(ano))
    if fonte_mun == "api" and (meta_ant.get("mesesPorAno") or {}).get(str(ano)) != meses:
        fonte_mun = None  # chegaram meses novos: a versão da API ficou incompleta até ser refeita
    cobertura = None
    if fonte_mun == "api":
        log(f"  {ano}: municípios já vêm completos da API; arquivo municipal mantido")
        cobertura = {"v": 1.0, "q": 1.0}
    else:
        acc = {}
        coberto = 0.0
        coberto_q = 0
        for ibge, dig_at, dig_fin, prog, q, v, area in con.execute("""
            SELECT c.ibge, o.dig_at, o.dig_fin, o.prog, count(*), sum(o.v), sum(o.area)
            FROM ops o JOIN comp c ON o.ref = c.ref AND o.ord = c.ord
            GROUP BY ALL""").fetchall():
            if not ibge or len(ibge) != 7:
                continue
            coberto += v
            coberto_q += q
            m = _m8(q, v, dig_fin)
            aC = area if dig_fin == "2" else 0.0
            aI = area if dig_fin == "3" else 0.0
            _soma(acc, (ibge, at(dig_at), grupo_programa(prog)), m + [aC, aI])
        cobertura = {"v": round(coberto / total_v, 4) if total_v else 0.0,
                     "q": round(coberto_q / total_q, 4) if total_q else 0.0}
        _dump(out / f"mun_{ano}.json", {"h": ["ibge", "at", "pg"] + H8 + ["aC", "aI"],
                                          "r": [list(k) + _inteiros(v, 2) for k, v in sorted(acc.items())]})

    # ---- Produtos (custeio, investimento, comercialização) ----
    acc = {}
    for uf, dig_at, dig_fin, prog, produto, q, v, area in con.execute("""
        SELECT o.uf, o.dig_at, o.dig_fin, o.prog, coalesce(e.produto, 'NÃO INFORMADO'), count(*), sum(o.v), sum(o.area)
        FROM ops o LEFT JOIN emp e ON o.emp = e.cod
        WHERE o.dig_fin IN ('1', '2', '3')
        GROUP BY ALL""").fetchall():
        ibge = SIGLA_IBGE.get((uf or "").upper())
        if ibge:
            _soma(acc, (ibge, FIN_DIGITO[dig_fin], produto, at(dig_at), grupo_programa(prog)), [q, v, area])
    nomes = sorted({k[2] for k in acc})
    ix = {n: i for i, n in enumerate(nomes)}
    _dump(out / f"prod_{ano}.json", {"produtos": nomes, "h": ["uf", "fin", "prod", "at", "pg", "q", "v", "a"],
                                       "r": [[k[0], k[1], ix[k[2]], k[3], k[4]] + _inteiros(v, 1) for k, v in sorted(acc.items())]})

    # ---- Instituições financeiras ----
    acc = {}
    for uf, cnpj, dig_at, dig_fin, prog, q, v in con.execute("""
        SELECT uf, cnpj, dig_at, dig_fin, prog, count(*), sum(v) FROM ops GROUP BY ALL""").fetchall():
        ibge = SIGLA_IBGE.get((uf or "").upper())
        if not ibge:
            continue
        nome, seg = ifs.get((cnpj or "").zfill(8), (f"CNPJ {cnpj}", "Não informado"))
        _soma(acc, (ibge, nome, seg, at(dig_at), grupo_programa(prog)), _m8(q, v, dig_fin))
    lista_if = sorted({k[1] for k in acc})
    segs = sorted({k[2] for k in acc})
    ii, si = {n: i for i, n in enumerate(lista_if)}, {n: i for i, n in enumerate(segs)}
    _dump(out / f"if_{ano}.json", {"ifs": lista_if, "segmentos": segs, "h": ["uf", "if", "seg", "at", "pg"] + H8,
                                     "r": [[k[0], ii[k[1]], si[k[2]], k[3], k[4]] + _inteiros(v) for k, v in sorted(acc.items())]})

    # ---- Sexo: não existe nos microdados públicos ----
    gen = out / f"gen_{ano}.json"
    gen_api = (meta_ant.get("genFonte") or {}).get(str(ano)) == "api" and (meta_ant.get("mesesPorAno") or {}).get(str(ano)) == meses
    if not gen_api:
        _dump(gen, {"h": ["uf", "sexo", "at", "pg"] + H8, "r": [], "indisponivel": True})

    log(f"  {ano}: meses {meses}; R$ {total_v / 1e9:.1f} bi; municípios cobrem {cobertura['q']:.0%} dos contratos e {cobertura['v']:.0%} do valor")
    return {"meses": meses, "anual": anual, "cobertura": cobertura}


def main(argv=None) -> int:
    hoje = dt.date.today()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--inicio", type=int, default=2013)
    ap.add_argument("--fim", type=int, default=hoje.year)
    ap.add_argument("--out", type=Path, default=Path("public/data"))
    ap.add_argument("--cache", type=Path, default=Path(".cache/microdados"))
    ap.add_argument("--dir-local", type=Path, help="pasta com os arquivos já baixados (não baixa nada)")
    ap.add_argument("--forcar", action="store_true", help="reprocessa mesmo sem arquivo novo no BCB")
    a = ap.parse_args(argv)

    pasta = a.dir_local or a.cache
    pasta.mkdir(parents=True, exist_ok=True)
    a.out.mkdir(parents=True, exist_ok=True)
    meta_p = a.out / "meta.json"
    meta_ant = json.loads(meta_p.read_text("utf-8")) if meta_p.exists() else {}

    anos = list(range(a.inicio, a.fim + 1))
    versoes = {}
    if not a.dir_local:
        log("Verificando arquivos do BCB…")
        previa = {"complemento": versao(URL_DADOS + "SICOR_COMPLEMENTO_OPERACAO_BASICA.gz")}
        for ano in anos:
            previa[str(ano)] = versao(URL_DADOS + f"SICOR_OPERACAO_BASICA_ESTADO_{ano}.gz")
        previa = {k: v for k, v in previa.items() if v}
        if not a.forcar and previa and meta_ant.get("microdados") == previa:
            log("Nenhum arquivo novo no BCB desde a última execução. Nada a fazer.")
            return 0
        for nome in ["Empreendimento.csv", "MunicipiosSicor.csv"]:
            baixar(URL_BASE + nome, pasta / nome)
        baixar(URL_DADOS + "SICOR_LISTA_IFS.csv", pasta / "SICOR_LISTA_IFS.csv")
        versoes["complemento"] = baixar(URL_DADOS + "SICOR_COMPLEMENTO_OPERACAO_BASICA.gz",
                                        pasta / "SICOR_COMPLEMENTO_OPERACAO_BASICA.gz")
        for ano in anos:
            try:
                versoes[str(ano)] = baixar(URL_DADOS + f"SICOR_OPERACAO_BASICA_ESTADO_{ano}.gz",
                                           pasta / f"SICOR_OPERACAO_BASICA_ESTADO_{ano}.gz")
            except Exception as e:  # noqa: BLE001
                log(f"  {ano}: arquivo indisponível ({e})")
        versoes = {k: v for k, v in versoes.items() if v}

    con = duckdb.connect(str(pasta / "trabalho.duckdb"))
    con.execute("PRAGMA threads=4")
    ifs, municipios = carregar_dominios(con, pasta)
    log("Lendo o complemento (município das operações com recursos públicos)…")
    ler_complemento(con, pasta / "SICOR_COMPLEMENTO_OPERACAO_BASICA.gz")

    serie: dict = {}
    meses_por_ano: dict = {}
    cobertura: dict = {}
    for ano in anos:
        f = pasta / f"SICOR_OPERACAO_BASICA_ESTADO_{ano}.gz"
        if not f.exists():
            continue
        log(f"Processando {ano}…")
        ler_ops(con, f)
        res = processar_ano(con, ano, ifs, a.out, meta_ant)
        if not res["meses"]:
            continue
        meses_por_ano[str(ano)] = res["meses"]
        cobertura[str(ano)] = res["cobertura"]
        for k, v in res["anual"].items():
            _soma(serie, k, v)
    con.close()

    _dump(a.out / "serie_anual.json", {"h": ["ano", "uf", "at", "pg"] + H8,
                                        "r": [list(k) + _inteiros(v) for k, v in sorted(serie.items())]})
    _dump(a.out / "municipios.json", municipios)
    ultimo = None
    for ano in sorted(meses_por_ano, reverse=True):
        ultimo = f"{ano}-{max(meses_por_ano[ano]):02d}"
        break
    meta = {
        **{k: v for k, v in meta_ant.items() if k in ("munFonte", "genFonte")},
        "geradoEm": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "amostra": False,
        "origem": "microdados",
        "fonte": "Banco Central do Brasil — microdados do SICOR (Tabelas do Crédito Rural e do Proagro)",
        "fonteUrl": "https://www.bcb.gov.br/estabilidadefinanceira/tabelas-credito-rural-proagro",
        "licenca": "ODbL",
        "anos": sorted(int(x) for x in meses_por_ano),
        "mesesPorAno": meses_por_ano,
        "ultimoMes": ultimo,
        "munCobertura": cobertura,
        "generoDisponivel": bool(meta_ant.get("genFonte")),
        "microdados": versoes,
        "ufs": {v[0]: {"sigla": s, "nome": v[1], "regiao": v[2]} for s, v in UFS.items()},
        "programas": PROGRAMAS,
        "fontes": FONTES,
        "finalidades": FINALIDADES,
        "sexos": SEXO_NOMES,
    }
    _dump(meta_p, meta)
    log(f"Pronto: anos {meta['anos']}, último mês {ultimo}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
