#!/usr/bin/env python3
"""
ETL de inadimplência do crédito rural para o Painel do Crédito Rural.

Fontes (Banco Central do Brasil):
1. SCR.data — arquivos anuais https://www.bcb.gov.br/pda/desig/scrdata_{ANO}.zip, com um CSV
   mensal (separador ";"). Só a modalidade "Financiamentos rurais e agroindustriais" é usada.
   Medidas: carteira ativa, carteira inadimplida (operações com parcela vencida há mais de 90 dias),
   vencido acima de 90 dias e ativo problemático. Detalhe por UF, PF/PJ, submodalidade, porte,
   origem dos recursos e segmento da instituição.
   Limite: a modalidade junta crédito rural e financiamentos agroindustriais.
2. SGS — séries oficiais de inadimplência do crédito rural (recursos direcionados, > 90 dias),
   nacionais e mensais: 21148 (PF total), 21136 (PJ total), 21146 (PF taxas de mercado),
   21147 (PF taxas reguladas).

Gera em public/data: inad_meta.json, inad_uf.json, inad_dim.json e inad_sgs.json.
Somente biblioteca padrão.

Uso:
    python etl/inadimplencia_etl.py --inicio 2012 --out public/data
    python etl/inadimplencia_etl.py --dir-local PASTA     # usa scrdata_AAAA.zip já baixados
"""
from __future__ import annotations

import argparse
import codecs
import csv
import datetime as dt
import io
import json
import re
import shutil
import sys
import time
import unicodedata
import urllib.request
import zipfile
from pathlib import Path

URL_SCR = "https://www.bcb.gov.br/pda/desig/scrdata_{ano}.zip"
URL_SGS = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.{cod}/dados?formato=json"
SGS = {
    "21148": "PF · crédito rural total",
    "21136": "PJ · crédito rural total",
    "21146": "PF · crédito rural com taxas de mercado",
    "21147": "PF · crédito rural com taxas reguladas",
}
UF_IBGE = {
    "RO": "11", "AC": "12", "AM": "13", "RR": "14", "PA": "15", "AP": "16", "TO": "17", "MA": "21",
    "PI": "22", "CE": "23", "RN": "24", "PB": "25", "PE": "26", "AL": "27", "SE": "28", "BA": "29",
    "MG": "31", "ES": "32", "RJ": "33", "SP": "35", "PR": "41", "SC": "42", "RS": "43", "MS": "50",
    "MT": "51", "GO": "52", "DF": "53",
}
# medidas: carteira ativa, carteira inadimplida, vencido > 90 dias, ativo problemático, nº de operações
MEDIDAS = ["carteira_ativa", "carteira_inadimplencia", "vencido_acima_de_90_dias", "ativo_problematico", "numero_de_operacoes"]
H_MED = ["cart", "inad", "v90", "ap", "ops"]
UA = {"User-Agent": "painel-credito-rural-etl/1.0 (+github.com/Benfluc/painel-credito-rural)"}


def log(msg: str) -> None:
    print(msg, flush=True)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def numero(s: str | None) -> float:
    s = (s or "").strip()
    if not s:
        return 0.0
    if "," in s:  # formato brasileiro 1.234,56
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def data_base(s: str) -> str | None:
    """Converte '2024-01-31', '31/01/2024' ou '202401' em '2024-01'."""
    s = (s or "").strip()
    m = re.match(r"(\d{4})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    m = re.match(r"\d{2}/(\d{2})/(\d{4})", s)
    if m:
        return f"{m.group(2)}-{m.group(1)}"
    m = re.match(r"(\d{4})(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    return None


def _get(url: str, metodo: str = "GET", timeout: int = 300):
    return urllib.request.urlopen(urllib.request.Request(url, method=metodo, headers=UA), timeout=timeout)


def versao(url: str) -> str:
    try:
        with _get(url, "HEAD", 60) as r:
            return r.headers.get("Last-Modified", "") or r.headers.get("ETag", "")
    except Exception:  # noqa: BLE001
        return ""


def baixar(url: str, destino: Path, tentativas: int = 4) -> None:
    for t in range(1, tentativas + 1):
        try:
            t0 = time.time()
            tmp = destino.with_suffix(".part")
            with _get(url) as r, open(tmp, "wb") as fh:
                esperado = int(r.headers.get("Content-Length") or 0)
                shutil.copyfileobj(r, fh, 1 << 20)
            if esperado and tmp.stat().st_size != esperado:
                raise IOError(f"download incompleto ({tmp.stat().st_size} de {esperado} bytes)")
            if not zipfile.is_zipfile(tmp):
                raise IOError("o arquivo recebido não é um zip válido")
            tmp.replace(destino)
            log(f"    {destino.name}: {destino.stat().st_size / 1e6:.1f} MB em {time.time() - t0:.0f}s")
            return
        except Exception as e:  # noqa: BLE001
            if t == tentativas:
                raise
            log(f"    falha ({e}); nova tentativa em {15 * t}s")
            time.sleep(15 * t)


# --------------------------------------------------------------------------- #
# SCR.data
# --------------------------------------------------------------------------- #
def linhas_csv(zf: zipfile.ZipFile, nome: str):
    """Lê um CSV de dentro do zip, tentando UTF-8 e caindo para Latin-1."""
    with zf.open(nome) as fh:
        amostra = fh.read(1 << 16)
    try:
        # o corte da amostra pode cair no meio de um caractere multibyte: o decodificador
        # incremental ignora o pedaço incompleto do fim em vez de acusar erro
        codecs.getincrementaldecoder("utf-8")().decode(amostra, final=False)
        enc = "utf-8-sig"
    except UnicodeDecodeError:
        enc = "latin-1"
    fh = io.TextIOWrapper(zf.open(nome), encoding=enc, errors="replace", newline="")
    cab = next(csv.reader([fh.readline()], delimiter=";"))
    # remove marcador BOM mesmo quando ele chega como texto ("\ufeff" ou "ï»¿")
    if cab:
        cab[0] = cab[0].lstrip("\ufeff").replace("ï»¿", "")
    yield cab
    for linha in fh:
        # filtro barato antes do parse: só linhas da modalidade rural interessam
        if "rura" not in linha and "RURA" not in linha and "Rura" not in linha:
            continue
        yield next(csv.reader([linha], delimiter=";"))


def eh_rural(modalidade: str) -> bool:
    n = norm(modalidade)
    return "rurais" in n or "rural" in n  # "Financiamentos rurais e agroindustriais"


def processar_zip(caminho: Path, dic: dict) -> tuple[dict, dict, dict]:
    """Agrega um ano. Devolve (uf, dim, diagnóstico)."""
    acc_uf: dict = {}
    acc_dim: dict = {}
    diag = {"arquivos": [], "submodalidades": {}, "cabecalho": None, "linhasRurais": 0}
    with zipfile.ZipFile(caminho) as zf:
        nomes = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        for nome in sorted(nomes):
            leitor = linhas_csv(zf, nome)
            cab = [norm(c) for c in next(leitor)]
            diag["cabecalho"] = diag["cabecalho"] or cab
            ix = {c: i for i, c in enumerate(cab)}
            col = lambda *alts: next((ix[a] for a in alts if a in ix), None)  # noqa: E731
            i_db, i_uf, i_cli = col("data_base", "database"), col("uf"), col("cliente")
            i_mod, i_sub = col("modalidade"), col("submodalidade")
            i_porte, i_orig, i_seg = col("porte"), col("origem"), col("segmento")
            i_med = [col(m) for m in MEDIDAS]
            if None in (i_db, i_uf, i_cli, i_mod) or i_med[0] is None or i_med[1] is None:
                log(f"    {nome}: cabeçalho inesperado {cab}; arquivo ignorado")
                diag.setdefault("ignorados", []).append(nome)
                continue
            n_rural = 0
            for row in leitor:
                if len(row) <= i_mod or not eh_rural(row[i_mod]):
                    continue
                ym = data_base(row[i_db])
                uf = UF_IBGE.get(row[i_uf].strip().upper())
                if not ym or not uf:
                    continue
                n_rural += 1
                cli = 1 if row[i_cli].strip().upper().startswith("PJ") else 0
                sub = row[i_sub].strip() if i_sub is not None else "—"
                si = dic["sub"].setdefault(sub, len(dic["sub"]))
                diag["submodalidades"][sub] = diag["submodalidades"].get(sub, 0) + 1
                vals = [numero(row[i]) if i is not None and i < len(row) else 0.0 for i in i_med]
                k = (ym, uf, cli, si)
                a = acc_uf.get(k)
                if a is None:
                    acc_uf[k] = vals
                else:
                    for j, v in enumerate(vals):
                        a[j] += v
                for dim, i in (("porte", i_porte), ("origem", i_orig), ("segmento", i_seg)):
                    if i is None:
                        continue
                    cat = row[i].strip() or "Não informado"
                    ci = dic[dim].setdefault(cat, len(dic[dim]))
                    kd = (ym, cli, si, dim, ci)
                    a = acc_dim.get(kd)
                    if a is None:
                        acc_dim[kd] = list(vals)
                    else:
                        for j, v in enumerate(vals):
                            a[j] += v
            diag["arquivos"].append([nome, n_rural])
            diag["linhasRurais"] += n_rural
            log(f"    {nome}: {n_rural} linhas da modalidade rural")
    return acc_uf, acc_dim, diag


# --------------------------------------------------------------------------- #
# SGS
# --------------------------------------------------------------------------- #
def baixar_sgs() -> dict:
    out = {}
    for cod, nome in SGS.items():
        for t in range(1, 5):
            try:
                with _get(URL_SGS.format(cod=cod), timeout=60) as r:
                    dados = json.loads(r.read())
                serie = []
                for p in dados:
                    m = re.match(r"\d{2}/(\d{2})/(\d{4})", p.get("data", ""))
                    if m and p.get("valor") not in (None, ""):
                        serie.append([f"{m.group(2)}-{m.group(1)}", round(float(str(p["valor"]).replace(",", ".")), 3)])
                out[cod] = {"nome": nome, "serie": serie}
                log(f"  SGS {cod}: {len(serie)} meses, último {serie[-1] if serie else '—'}")
                break
            except Exception as e:  # noqa: BLE001
                if t == 4:
                    log(f"  SGS {cod}: falhou ({e})")
                else:
                    time.sleep(5 * t)
    return out


# --------------------------------------------------------------------------- #
def _dump(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")


def main(argv=None) -> int:
    hoje = dt.date.today()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--inicio", type=int, default=2012)
    ap.add_argument("--fim", type=int, default=hoje.year)
    ap.add_argument("--out", type=Path, default=Path("public/data"))
    ap.add_argument("--cache", type=Path, default=Path(".cache/scrdata"))
    ap.add_argument("--dir-local", type=Path)
    ap.add_argument("--sem-sgs", action="store_true")
    a = ap.parse_args(argv)

    pasta = a.dir_local or a.cache
    pasta.mkdir(parents=True, exist_ok=True)
    meta_p = a.out / "inad_meta.json"
    meta_ant = json.loads(meta_p.read_text("utf-8")) if meta_p.exists() else {}

    # dicionários estáveis entre execuções (índices não mudam de significado)
    dic = {k: {n: i for i, n in enumerate(meta_ant.get("dic", {}).get(k, []))} for k in ("sub", "porte", "origem", "segmento")}
    versoes = dict(meta_ant.get("versoes", {}))
    diagnostico = dict(meta_ant.get("diagnostico", {}))

    for ano in range(a.inicio, a.fim + 1):
        zipp = pasta / f"scrdata_{ano}.zip"
        agg_p = pasta / f"agregado_{ano}.json"
        if not a.dir_local:
            v = versao(URL_SCR.format(ano=ano))
            if not v:
                log(f"{ano}: arquivo não encontrado no BCB")
                continue
            if versoes.get(str(ano)) == v and agg_p.exists():
                log(f"{ano}: sem mudança no BCB, reaproveitando o agregado")
                continue
            log(f"{ano}: baixando…")
            try:
                baixar(URL_SCR.format(ano=ano), zipp)
            except Exception as e:  # noqa: BLE001
                log(f"::warning::{ano}: não foi possível baixar ({e}); o ano fica para a próxima execução")
                continue
            versoes[str(ano)] = v
        elif not zipp.exists():
            continue
        log(f"{ano}: processando…")
        try:
            acc_uf, acc_dim, diag = processar_zip(zipp, dic)
        except zipfile.BadZipFile as e:
            log(f"::warning::{ano}: zip inválido ({e}); o ano fica para a próxima execução")
            versoes.pop(str(ano), None)
            continue
        _dump(agg_p, {"uf": [list(k) + v for k, v in acc_uf.items()], "dim": [list(k) + v for k, v in acc_dim.items()]})
        diagnostico[str(ano)] = diag
        if diag.get("ignorados"):
            versoes.pop(str(ano), None)  # força reprocessar o ano na próxima execução
        if not a.dir_local:
            zipp.unlink(missing_ok=True)  # o agregado basta; libera disco no runner

    # junta os agregados de todos os anos
    linhas_uf, linhas_dim = [], []
    for p in sorted(pasta.glob("agregado_*.json")):
        d = json.loads(p.read_text("utf-8"))
        linhas_uf += d["uf"]
        linhas_dim += d["dim"]
    if not linhas_uf:
        log("Nenhum dado do SCR.data processado.")
        return 1
    arred = lambda v: [round(x) for x in v]  # noqa: E731
    linhas_uf.sort()
    linhas_dim.sort(key=lambda r: (r[0], r[1], r[2], r[3], r[4]))
    meses = sorted({r[0] for r in linhas_uf})
    _dump(a.out / "inad_uf.json", {"h": ["ym", "uf", "cli", "sub"] + H_MED, "r": [r[:4] + arred(r[4:]) for r in linhas_uf]})
    _dump(a.out / "inad_dim.json", {"h": ["ym", "cli", "sub", "dim", "cat"] + H_MED, "r": [r[:5] + arred(r[5:]) for r in linhas_dim]})

    if not a.sem_sgs:
        log("Séries do SGS…")
        novo = baixar_sgs()
        if novo:
            _dump(a.out / "inad_sgs.json", novo)

    inv = lambda d: [n for n, _ in sorted(d.items(), key=lambda kv: kv[1])]  # noqa: E731
    _dump(meta_p, {
        "geradoEm": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "fonte": "Banco Central do Brasil — SCR.data (modalidade Financiamentos rurais e agroindustriais) e SGS",
        "fonteUrl": "https://dadosabertos.bcb.gov.br/dataset/scr_data",
        "meses": meses,
        "ultimoMes": meses[-1],
        "dic": {k: inv(v) for k, v in dic.items()},
        "sgs": SGS,
        "versoes": versoes,
        "diagnostico": diagnostico,
    })
    log(f"Pronto: {len(meses)} meses ({meses[0]} a {meses[-1]}); submodalidades: {inv(dic['sub'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
