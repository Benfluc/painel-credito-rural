#!/usr/bin/env python3
"""
ETL do Painel do Crédito Rural — Matriz de Dados do Crédito Rural (SICOR/BCB).

Coleta mês a mês as entidades do serviço OData v2 do Olinda, agrega cada mês num
cache compacto e gera os JSONs estáticos lidos pelo dashboard (app/public/data).

Somente biblioteca padrão (roda no GitHub Actions sem pip install).

Uso:
    python etl/sicor_etl.py                         # incremental: meses faltantes + últimos 3
    python etl/sicor_etl.py --inicio 2013 --refresh 6
    python etl/sicor_etl.py --fixtures DIR          # lê respostas gravadas (testes/offline)

Fonte: https://olinda.bcb.gov.br/olinda/servico/SICOR/versao/v2/odata/
Licença dos dados: ODbL (Banco Central do Brasil).
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import gzip
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

BASE_URL = "https://olinda.bcb.gov.br/olinda/servico/SICOR/versao/v2/odata"
TOP = 100_000
TIMEOUT = 180
MAX_TENTATIVAS = 6
PRIMEIRO_ANO_SICOR = 2013

# --------------------------------------------------------------------------- #
# Tabelas de referência
# --------------------------------------------------------------------------- #
UFS = {  # sigla -> (código IBGE, nome, região)
    "RO": ("11", "Rondônia", "Norte"), "AC": ("12", "Acre", "Norte"),
    "AM": ("13", "Amazonas", "Norte"), "RR": ("14", "Roraima", "Norte"),
    "PA": ("15", "Pará", "Norte"), "AP": ("16", "Amapá", "Norte"),
    "TO": ("17", "Tocantins", "Norte"), "MA": ("21", "Maranhão", "Nordeste"),
    "PI": ("22", "Piauí", "Nordeste"), "CE": ("23", "Ceará", "Nordeste"),
    "RN": ("24", "Rio Grande do Norte", "Nordeste"), "PB": ("25", "Paraíba", "Nordeste"),
    "PE": ("26", "Pernambuco", "Nordeste"), "AL": ("27", "Alagoas", "Nordeste"),
    "SE": ("28", "Sergipe", "Nordeste"), "BA": ("29", "Bahia", "Nordeste"),
    "MG": ("31", "Minas Gerais", "Sudeste"), "ES": ("32", "Espírito Santo", "Sudeste"),
    "RJ": ("33", "Rio de Janeiro", "Sudeste"), "SP": ("35", "São Paulo", "Sudeste"),
    "PR": ("41", "Paraná", "Sul"), "SC": ("42", "Santa Catarina", "Sul"),
    "RS": ("43", "Rio Grande do Sul", "Sul"), "MS": ("50", "Mato Grosso do Sul", "Centro-Oeste"),
    "MT": ("51", "Mato Grosso", "Centro-Oeste"), "GO": ("52", "Goiás", "Centro-Oeste"),
    "DF": ("53", "Distrito Federal", "Centro-Oeste"),
}

# Grupos de programa (índice usado nos JSONs)
PROGRAMAS = ["Pronaf", "Pronamp", "Sem vínculo a programa", "RenovAgro / ABC+", "Outros programas"]
_PROG = {"0001": 0, "0050": 1, "0999": 2, "0156": 3, "0222": 3, "0180": 3}


def grupo_programa(cd: str | None) -> int:
    return _PROG.get((cd or "").zfill(4), 4)


# Grupos de fonte de recursos
FONTES = [
    "Recursos obrigatórios", "Poupança rural", "LCA", "Recursos livres",
    "Fundos constitucionais (FNO/FNE/FCO)", "BNDES / Finame", "Outras fontes",
]


def grupo_fonte(cd: str | None) -> int:
    c = (cd or "").zfill(4)
    if c in {"0201", "0202", "0222", "0225", "0226", "0250", "0260"}:
        return 0
    if c.startswith("030"):
        return 1
    if c in {"0430", "0431", "0440"}:
        return 2
    if c in {"0402", "0403", "0405"}:
        return 3
    if c in {"0501", "0502", "0503"}:
        return 4
    if c in {"0505", "0506"}:
        return 5
    return 6


SEXOS = {"1": 0, "2": 1}  # 0 Masculino, 1 Feminino, 2 PJ/não informado
SEXO_NOMES = ["Masculino", "Feminino", "Pessoa jurídica / não informado"]

FINALIDADES = ["Custeio", "Investimento", "Comercialização", "Industrialização"]
_M_CAMPOS = [  # ordem das 8 métricas: q/v por finalidade
    ("QtdCusteio", "VlCusteio"), ("QtdInvestimento", "VlInvestimento"),
    ("QtdComercializacao", "VlComercializacao"), ("QtdIndustrializacao", "VlIndustrializacao"),
]


def _num(x) -> float:
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def metricas8(r: dict) -> list[float]:
    out: list[float] = []
    for q, v in _M_CAMPOS:
        out += [_num(r.get(q)), _num(r.get(v))]
    return out


def atividade(r: dict) -> int:
    return 2 if str(r.get("Atividade", "")).strip() == "2" else 1


def uf_ibge(r: dict) -> str | None:
    s = str(r.get("nomeUF") or "").strip().upper()
    return UFS[s][0] if s in UFS else None


def produto_nome(r: dict) -> str:
    return str(r.get("nomeProduto") or "").strip().strip('"').strip() or "NÃO INFORMADO"


# --------------------------------------------------------------------------- #
# Acesso à API
# --------------------------------------------------------------------------- #
class Fonte:
    """Busca registros de uma entidade num mês (API real ou fixtures gravadas)."""

    def __init__(self, fixtures: Path | None = None):
        self.fixtures = fixtures

    def buscar(self, entidade: str, ano: int, mes: int, select: list[str] | None = None) -> list[dict] | None:
        if self.fixtures:
            f = self.fixtures / f"{entidade}_{ano}_{mes:02d}.json.gz"
            if not f.exists():
                return None  # mês não gravado: trata como indisponível
            with gzip.open(f) as fh:
                return json.load(fh)["value"]
        return self._api(entidade, ano, mes, select)

    def _api(self, entidade, ano, mes, select):
        filtro = f"AnoEmissao eq '{ano}' and MesEmissao eq '{mes:02d}'"
        registros: list[dict] = []
        skip = 0
        while True:
            partes = ["$format=json", f"$top={TOP}", "$filter=" + urllib.parse.quote(filtro, safe="(),'")]
            if skip:
                partes.append(f"$skip={skip}")
            if select:
                partes.append("$select=" + ",".join(select))
            url = f"{BASE_URL}/{entidade}?" + "&".join(partes)
            lote = _get_json(url)["value"]
            registros += lote
            if len(lote) < TOP:
                return registros
            skip += TOP


def _get_json(url: str) -> dict:
    ultimo_erro = None
    for tentativa in range(1, MAX_TENTATIVAS + 1):
        try:
            # urllib não guarda cookies: cada tentativa cai em qualquer nó do balanceador
            req = urllib.request.Request(url, headers={
                "Accept": "application/json",
                "Accept-Encoding": "gzip",
                "User-Agent": "painel-credito-rural-etl/1.0 (+github.com/Benfluc/Projects)",
            })
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                corpo = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    corpo = gzip.decompress(corpo)
                dados = json.loads(corpo)
                if not isinstance(dados.get("value"), list):
                    raise ValueError("resposta sem lista 'value'")
                return dados
        except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as e:
            ultimo_erro = e
            espera = min(90, 2 ** tentativa) + random.random() * 2
            log(f"  tentativa {tentativa}/{MAX_TENTATIVAS} falhou ({e}); nova tentativa em {espera:.0f}s")
            time.sleep(espera)
    raise RuntimeError(f"falha ao consultar {url}: {ultimo_erro}")


def log(msg: str) -> None:
    print(msg, flush=True)


# --------------------------------------------------------------------------- #
# Agregadores mensais (cada um devolve linhas compactas: chave + métricas)
# --------------------------------------------------------------------------- #
def _somar(acc: dict, chave: tuple, valores: list[float]) -> None:
    if chave in acc:
        a = acc[chave]
        for i, v in enumerate(valores):
            a[i] += v
    else:
        acc[chave] = list(valores)


def _linhas(acc: dict) -> list[list]:
    return [list(k) + [round(v, 2) for v in vals] for k, vals in acc.items()]


def mes_uf(fonte: Fonte, ano: int, mes: int):
    regs = fonte.buscar("RegiaoUF", ano, mes)
    if regs is None:
        return None
    acc: dict = {}
    for r in regs:
        uf = uf_ibge(r)
        if uf:
            _somar(acc, (uf, atividade(r), grupo_programa(r.get("cdPrograma")), grupo_fonte(r.get("cdFonteRecurso"))), metricas8(r))
    return {"rows": _linhas(acc)}


SEL_MUN = ["nomeUF", "cdMunicipio", "Municipio", "codMunicIbge", "Atividade", "cdPrograma",
           "QtdCusteio", "VlCusteio", "QtdInvestimento", "VlInvestimento", "QtdComercializacao",
           "VlComercializacao", "QtdIndustrializacao", "VlIndustrializacao", "AreaCusteio", "AreaInvestimento"]


def mes_mun(fonte: Fonte, ano: int, mes: int):
    regs = fonte.buscar("CusteioInvestimentoComercialIndustrialSemFiltros", ano, mes, SEL_MUN)
    if regs is None:
        return None
    acc: dict = {}
    nomes: dict[str, list] = {}
    for r in regs:
        ibge = str(r.get("codMunicIbge") or "").strip()
        if len(ibge) != 7 or not ibge.isdigit():
            continue
        _somar(acc, (ibge, atividade(r), grupo_programa(r.get("cdPrograma"))),
               metricas8(r) + [_num(r.get("AreaCusteio")), _num(r.get("AreaInvestimento"))])
        if ibge not in nomes and (r.get("Municipio") or r.get("cdMunicipio")):
            nomes[ibge] = [str(r.get("Municipio") or "").strip().title(), str(r.get("cdMunicipio") or "").strip()]
    return {"rows": _linhas(acc), "nomes": nomes}


_PROD_ENT = [  # (entidade, índice da finalidade)
    ("CusteioRegiaoUFProduto", 0), ("InvestRegiaoUFProduto", 1), ("ComercRegiaoUFProduto", 2),
]


def _qva(r: dict) -> list[float]:
    q = next((r[k] for k in r if k.startswith("Qtd")), 0)
    v = next((r[k] for k in r if k.startswith("Vl")), 0)
    a = next((r[k] for k in r if k.startswith("Area")), 0)
    return [_num(q), _num(v), _num(a)]


def mes_prod(fonte: Fonte, ano: int, mes: int):
    acc: dict = {}
    algum = False
    for ent, fin in _PROD_ENT:
        regs = fonte.buscar(ent, ano, mes)
        if regs is None:
            continue
        algum = True
        for r in regs:
            uf = uf_ibge(r)
            if uf:
                _somar(acc, (uf, fin, produto_nome(r), atividade(r), grupo_programa(r.get("cdPrograma"))), _qva(r))
    return {"rows": _linhas(acc)} if algum else None


def mes_if(fonte: Fonte, ano: int, mes: int):
    regs = fonte.buscar("SegmentoIFRegiaoUF", ano, mes)
    if regs is None:
        return None
    acc: dict = {}
    for r in regs:
        uf = uf_ibge(r)
        if not uf:
            continue
        nome = str(r.get("nomeIF") or "").strip() or str(r.get("Cnpj") or "?")
        seg = str(r.get("nomeSegmento") or r.get("Segmento") or "").strip()
        _somar(acc, (uf, nome, seg, atividade(r), grupo_programa(r.get("cdPrograma"))), metricas8(r))
    return {"rows": _linhas(acc)}


def mes_gen(fonte: Fonte, ano: int, mes: int):
    regs = fonte.buscar("RegiaoUFGenero", ano, mes)
    if regs is None:
        return None
    acc: dict = {}
    for r in regs:
        uf = uf_ibge(r)
        if uf:
            sexo = SEXOS.get(str(r.get("cdSexo") or "").strip(), 2)
            _somar(acc, (uf, sexo, atividade(r), grupo_programa(r.get("cdPrograma"))), metricas8(r))
    return {"rows": _linhas(acc)}


AGREGADORES = {"uf": mes_uf, "mun": mes_mun, "prod": mes_prod, "if": mes_if, "gen": mes_gen}


# --------------------------------------------------------------------------- #
# Cache mensal
# --------------------------------------------------------------------------- #
def caminho_cache(cache: Path, chave: str, ano: int, mes: int) -> Path:
    return cache / chave / f"{ano}-{mes:02d}.json.gz"


def ler_cache(p: Path):
    if not p.exists():
        return None
    with gzip.open(p, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def gravar_cache(p: Path, dados) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as fh:
        json.dump(dados, fh, ensure_ascii=False, separators=(",", ":"))
    tmp.replace(p)


def coletar(fonte: Fonte, cache: Path, meses: list[tuple[int, int]], recentes: set, workers: int) -> None:
    tarefas = []
    for chave in AGREGADORES:
        for ano, mes in meses:
            p = caminho_cache(cache, chave, ano, mes)
            if p.exists() and (ano, mes) not in recentes:
                continue
            tarefas.append((chave, ano, mes, p))
    log(f"{len(tarefas)} consultas a fazer ({len(meses)} meses × {len(AGREGADORES)} conjuntos, cache reaproveitado)")

    def rodar(t):
        chave, ano, mes, p = t
        t0 = time.time()
        dados = AGREGADORES[chave](fonte, ano, mes)
        if dados is None:
            return f"{chave} {ano}-{mes:02d}: indisponível"
        dados["fetchedAt"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        gravar_cache(p, dados)
        return f"{chave} {ano}-{mes:02d}: {len(dados['rows'])} linhas ({time.time() - t0:.1f}s)"

    falhas = 0
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for fut in cf.as_completed([ex.submit(rodar, t) for t in tarefas]):
            try:
                log("  " + fut.result())
            except Exception as e:  # um mês com falha não derruba o lote
                falhas += 1
                log(f"  ERRO: {e}")
    if falhas:
        log(f"{falhas} consultas falharam; os meses ficam para a próxima execução")


# --------------------------------------------------------------------------- #
# Geração dos JSONs do dashboard
# --------------------------------------------------------------------------- #
def _dump(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))


def _arred(vals: list[float], casas_area: int | None = None, n_area: int = 0) -> list:
    """Quantidades e valores em inteiros (R$ inteiros); áreas com 1 casa."""
    out = []
    for i, v in enumerate(vals):
        if n_area and i >= len(vals) - n_area:
            out.append(round(v, 1))
        else:
            out.append(int(round(v)))
    return out


def gerar_saidas(cache: Path, out: Path, anos: list[int], amostra: bool) -> None:
    H8 = ["qC", "vC", "qI", "vI", "qM", "vM", "qN", "vN"]
    meses_com_dados: dict[int, list[int]] = defaultdict(list)
    serie_anual: dict = {}
    nomes_mun: dict = {}
    anos_ok = []

    for ano in anos:
        # ---- UF mensal (+ série anual) ----
        acc: dict = {}
        for mes in range(1, 13):
            d = ler_cache(caminho_cache(cache, "uf", ano, mes))
            if not d or not d["rows"]:
                continue
            meses_com_dados[ano].append(mes)
            for row in d["rows"]:
                uf, at, pg, fg = row[:4]
                _somar(acc, (mes, uf, at, pg, fg), row[4:])
                _somar(serie_anual, (ano, uf, at, pg), row[4:])
        if not acc:
            continue
        anos_ok.append(ano)
        _dump(out / f"uf_{ano}.json", {"h": ["mes", "uf", "at", "pg", "fg"] + H8,
                                         "r": [list(k) + _arred(v) for k, v in sorted(acc.items())]})

        # ---- Municípios (anual) ----
        acc = {}
        for mes in range(1, 13):
            d = ler_cache(caminho_cache(cache, "mun", ano, mes))
            if not d:
                continue
            for row in d["rows"]:
                _somar(acc, tuple(row[:3]), row[3:])
            for k, v in d.get("nomes", {}).items():
                nomes_mun[k] = v
        _dump(out / f"mun_{ano}.json", {"h": ["ibge", "at", "pg"] + H8 + ["aC", "aI"],
                                          "r": [list(k) + _arred(v, n_area=2) for k, v in sorted(acc.items())]})

        # ---- Produtos (anual, por UF) ----
        acc = {}
        for mes in range(1, 13):
            d = ler_cache(caminho_cache(cache, "prod", ano, mes))
            if d:
                for row in d["rows"]:
                    _somar(acc, tuple(row[:5]), row[5:])
        produtos = sorted({k[2] for k in acc})
        idx = {p: i for i, p in enumerate(produtos)}
        _dump(out / f"prod_{ano}.json", {"produtos": produtos, "h": ["uf", "fin", "prod", "at", "pg", "q", "v", "a"],
                                           "r": [[k[0], k[1], idx[k[2]], k[3], k[4]] + _arred(v, n_area=1)
                                                 for k, v in sorted(acc.items())]})

        # ---- Instituições financeiras (anual, por UF) ----
        acc = {}
        for mes in range(1, 13):
            d = ler_cache(caminho_cache(cache, "if", ano, mes))
            if d:
                for row in d["rows"]:
                    _somar(acc, tuple(row[:5]), row[5:])
        ifs = sorted({k[1] for k in acc})
        segs = sorted({k[2] for k in acc})
        ii, si = {n: i for i, n in enumerate(ifs)}, {n: i for i, n in enumerate(segs)}
        _dump(out / f"if_{ano}.json", {"ifs": ifs, "segmentos": segs, "h": ["uf", "if", "seg", "at", "pg"] + H8,
                                         "r": [[k[0], ii[k[1]], si[k[2]], k[3], k[4]] + _arred(v) for k, v in sorted(acc.items())]})

        # ---- Gênero (anual, por UF) ----
        acc = {}
        for mes in range(1, 13):
            d = ler_cache(caminho_cache(cache, "gen", ano, mes))
            if d:
                for row in d["rows"]:
                    _somar(acc, tuple(row[:4]), row[4:])
        _dump(out / f"gen_{ano}.json", {"h": ["uf", "sexo", "at", "pg"] + H8,
                                          "r": [list(k) + _arred(v) for k, v in sorted(acc.items())]})
        log(f"{ano}: meses com dados {meses_com_dados[ano]}")

    _dump(out / "serie_anual.json", {"h": ["ano", "uf", "at", "pg"] + H8,
                                      "r": [list(k) + _arred(v) for k, v in sorted(serie_anual.items())]})
    _dump(out / "municipios.json", nomes_mun)

    ultimo = None
    for ano in sorted(meses_com_dados, reverse=True):
        if meses_com_dados[ano]:
            ultimo = f"{ano}-{max(meses_com_dados[ano]):02d}"
            break
    _dump(out / "meta.json", {
        "geradoEm": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "amostra": amostra,
        "fonte": "Banco Central do Brasil — Matriz de Dados do Crédito Rural (SICOR), API OData v2",
        "fonteUrl": "https://dadosabertos.bcb.gov.br/dataset/matrizdadoscreditorural",
        "licenca": "ODbL",
        "anos": anos_ok,
        "mesesPorAno": {str(a): m for a, m in meses_com_dados.items() if m},
        "ultimoMes": ultimo,
        "ufs": {v[0]: {"sigla": s, "nome": v[1], "regiao": v[2]} for s, v in UFS.items()},
        "programas": PROGRAMAS,
        "fontes": FONTES,
        "finalidades": FINALIDADES,
        "sexos": SEXO_NOMES,
    })
    log(f"Saídas gravadas em {out} (último mês com dados: {ultimo})")


# --------------------------------------------------------------------------- #
def main(argv=None) -> int:
    hoje = dt.date.today()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--inicio", type=int, default=int(os.environ.get("SICOR_INICIO", PRIMEIRO_ANO_SICOR)))
    ap.add_argument("--fim", type=int, default=hoje.year)
    ap.add_argument("--refresh", type=int, default=3, help="reconsulta os N meses mais recentes (registros tardios)")
    ap.add_argument("--cache", type=Path, default=Path(".cache/sicor"))
    ap.add_argument("--out", type=Path, default=Path("public/data"))
    ap.add_argument("--fixtures", type=Path, help="diretório com respostas gravadas {Entidade}_{AAAA}_{MM}.json.gz")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--so-gerar", action="store_true", help="não consulta a API; só regenera as saídas do cache")
    a = ap.parse_args(argv)

    meses = [(y, m) for y in range(a.inicio, a.fim + 1) for m in range(1, 13)
             if (y, m) <= (hoje.year, hoje.month)]
    recentes = set(meses[-a.refresh:]) if a.refresh > 0 else set()
    if not a.so_gerar:
        coletar(Fonte(a.fixtures), a.cache, meses, recentes, a.workers)
    gerar_saidas(a.cache, a.out, list(range(a.inicio, a.fim + 1)), amostra=a.fixtures is not None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
