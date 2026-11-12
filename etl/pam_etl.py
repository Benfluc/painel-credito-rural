#!/usr/bin/env python3
"""
ETL da Produção Agrícola Municipal (PAM/IBGE) para o Painel do Crédito Rural.

Fonte: SIDRA, tabela 5457 — lavouras temporárias e permanentes (substitui a 1612, que
cobre só as temporárias e deixa de fora café, laranja, banana, cacau etc.).
Variáveis: 215 = valor da produção (mil R$), 216 = área colhida (ha).

Gera public/data/pam_AAAA.json (município × cultura) e public/data/pam_meta.json.
Somente biblioteca padrão.

Uso:
    python etl/pam_etl.py --inicio 2013            # anos faltantes + os 2 mais recentes
    python etl/pam_etl.py --fixtures DIR           # lê respostas gravadas (testes/offline)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import random
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://apisidra.ibge.gov.br/values"
TABELA = "5457"
CLASSIF = "c782"  # Produto das lavouras temporárias e permanentes
V_VALOR, V_AREA = "215", "216"
TIMEOUT = 120
MAX_TENTATIVAS = 5
UFS_IBGE = ["11", "12", "13", "14", "15", "16", "17", "21", "22", "23", "24", "25", "26", "27", "28",
            "29", "31", "32", "33", "35", "41", "42", "43", "50", "51", "52", "53"]

_LIMITE = re.compile(r"Quantidade de valores solicitados:\s*(\d+)\s*excedeu o limite:\s*(\d+)", re.I)


def log(msg: str) -> None:
    print(msg, flush=True)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()


# --------------------------------------------------------------------------- #
# Correspondência cultura PAM  <->  produto do SICOR (custeio)
# chave = nome-base da PAM normalizado (texto antes do primeiro " (", sem o "*" das notas)
# (uma cultura pode juntar mais de um produto da PAM, ex.: algodão herbáceo + arbóreo)
# --------------------------------------------------------------------------- #
CULTURAS = [
    # (rótulo, base PAM, nomes no SICOR)
    ("Soja", "soja", ["SOJA"]),
    ("Milho", "milho", ["MILHO"]),
    ("Café", "cafe", ["CAFÉ"]),
    ("Cana-de-açúcar", "cana-de-acucar", ["CANA-DE-AÇUCAR"]),
    ("Algodão", ["algodao herbaceo", "algodao arboreo"], ["ALGODÃO"]),
    ("Arroz", "arroz", ["ARROZ"]),
    ("Feijão", "feijao", ["FEIJÃO"]),
    ("Trigo", "trigo", ["TRIGO"]),
    ("Laranja", "laranja", ["LARANJA"]),
    ("Mandioca", "mandioca", ["MANDIOCA (AIPIM, MACAXEIRA)"]),
    ("Banana", "banana", ["BANANA"]),
    ("Sorgo", "sorgo", ["SORGO"]),
    ("Batata-inglesa", "batata-inglesa", ["BATATA-INGLESA"]),
    ("Tomate", "tomate", ["TOMATE"]),
    ("Fumo", "fumo", ["FUMO"]),
    ("Cacau", "cacau", ["CACAU"]),
    ("Uva", "uva", ["UVA"]),
    ("Maçã", "maca", ["MAÇÃ"]),
    ("Aveia", "aveia", ["AVEIA"]),
    ("Cevada", "cevada", ["CEVADA"]),
    ("Cebola", "cebola", ["CEBOLA"]),
    ("Alho", "alho", ["ALHO"]),
    ("Amendoim", "amendoim", ["AMENDOIM"]),
    ("Girassol", "girassol", ["GIRASSOL"]),
    ("Mamão", "mamao", ["MAMÃO"]),
    ("Melancia", "melancia", ["MELANCIA"]),
    ("Melão", "melao", ["MELÃO"]),
    ("Abacaxi", "abacaxi", ["ABACAXI"]),
    ("Coco-da-baía", "coco-da-baia", ["COCO-DA-BAIA", "COCO"]),
    ("Açaí", "acai", ["AÇAÍ"]),
    ("Erva-mate", "erva-mate", ["ERVA-MATE"]),
    ("Borracha (seringueira)", "borracha", ["SERINGUEIRA"]),
    ("Pimenta-do-reino", "pimenta-do-reino", ["PIMENTA-DO-REINO"]),
    ("Dendê", "dende", ["DENDÊ"]),
    ("Guaraná", "guarana", ["GUARANÁ"]),
    ("Tangerina", "tangerina", ["TANGERINA"]),
    ("Limão", "limao", ["LIMÃO"]),
    ("Manga", "manga", ["MANGA"]),
    ("Maracujá", "maracuja", ["MARACUJÁ"]),
    ("Goiaba", "goiaba", ["GOIABA"]),
    ("Caju", ["castanha de caju", "caju"], ["CAJU"]),
    ("Mamona", "mamona", ["MAMONA"]),
    ("Triticale", "triticale", ["TRITICALE"]),
    ("Batata-doce", "batata-doce", ["BATATA-DOCE"]),
    ("Pêssego", "pessego", ["PÊSSEGO"]),
]


def base_pam(nome: str) -> str:
    return norm(nome.split(" (")[0].replace("*", ""))


def eh_subtotal(nome: str) -> bool:
    """Café (em grão) Arábica / Canephora são parcelas do 'Café (em grão) Total' — evita dupla contagem."""
    n = norm(nome)
    return n.startswith("cafe (em grao)") and not n.endswith("total")


def eh_total(nome: str) -> bool:
    return norm(nome) == "total"


# --------------------------------------------------------------------------- #
# Acesso ao SIDRA
# --------------------------------------------------------------------------- #
class LimiteExcedido(Exception):
    def __init__(self, solicitados: int, limite: int):
        super().__init__(f"{solicitados} valores > limite {limite}")
        self.solicitados, self.limite = solicitados, limite


class Fonte:
    def __init__(self, fixtures: Path | None = None):
        self.fixtures = fixtures

    def get(self, caminho: str) -> list[dict]:
        if self.fixtures:
            f = self.fixtures / (re.sub(r"[^0-9A-Za-z]+", "_", caminho).strip("_") + ".json")
            return json.loads(f.read_text("utf-8")) if f.exists() else []
        url = BASE + urllib.parse.quote(caminho, safe="/,")
        erro = None
        for t in range(1, MAX_TENTATIVAS + 1):
            try:
                req = urllib.request.Request(url, headers={"Accept": "application/json",
                                                           "User-Agent": "painel-credito-rural-etl/1.0"})
                with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                    dados = json.loads(r.read())
                if not isinstance(dados, list):
                    raise ValueError("resposta inesperada do SIDRA")
                return dados
            except urllib.error.HTTPError as e:
                corpo = e.read().decode("utf-8", "replace")
                m = _LIMITE.search(corpo)
                if m:
                    raise LimiteExcedido(int(m.group(1)), int(m.group(2)))
                if e.code == 400:  # pedido inválido: repetir não adianta
                    raise RuntimeError(f"SIDRA 400 em {url}: {corpo[:200]}")
                erro = e
            except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as e:
                erro = e
            if t < MAX_TENTATIVAS:
                espera = min(60, 2 ** t) + random.random()
                log(f"  tentativa {t}/{MAX_TENTATIVAS} falhou ({erro}); nova em {espera:.0f}s")
                time.sleep(espera)
        raise RuntimeError(f"falha no SIDRA: {url}: {erro}")


def linhas(resp: list[dict]) -> list[dict]:
    """Converte a resposta SIDRA (com linha de cabeçalho) em dicts com chaves estáveis."""
    if not resp:
        return []
    cab = resp[0]
    papel = {}
    for k, rot in cab.items():
        if not rot or not k.endswith("C") or not k.startswith("D"):
            continue
        r = norm(rot)
        if r.startswith("municipio") or r.startswith("unidade da federacao") or r.startswith("brasil"):
            papel["loc"] = k
        elif r.startswith("variavel"):
            papel["var"] = k
        elif r.startswith("ano"):
            papel["ano"] = k
        elif r.startswith("produto"):
            papel["prod"] = k
    out = []
    for row in resp[1:]:
        out.append({
            "loc": row.get(papel.get("loc", "D1C")),
            "var": row.get(papel.get("var", "D2C")),
            "ano": row.get(papel.get("ano", "D3C")),
            "prod": row.get(papel.get("prod", "D4C")),
            "prodNome": row.get(papel.get("prod", "D4C")[:-1] + "N", ""),
            "un": row.get("MN", ""),
            "V": row.get("V"),
        })
    return out


def valor(v) -> float | None:
    """'-' = zero absoluto; '..', '...', 'X' = não disponível / sigilo."""
    if v is None:
        return None
    s = str(v).strip()
    if s == "-":
        return 0.0
    try:
        return float(s)
    except ValueError:
        return None


# --------------------------------------------------------------------------- #
def produtos_do_ano(fonte: Fonte, ano: int) -> list[tuple[str, str]]:
    resp = linhas(fonte.get(f"/t/{TABELA}/n1/all/v/{V_VALOR}/p/{ano}/{CLASSIF}/all"))
    vistos = {}
    for r in resp:
        if r["prod"] and r["prod"] not in vistos:
            vistos[r["prod"]] = r["prodNome"]
    return list(vistos.items())


def coletar_uf(fonte: Fonte, ano: int, uf: str, var: str, codigos: list[str]) -> list[dict]:
    """Baixa uma UF/variável, dividindo a lista de produtos se passar do limite do SIDRA."""
    tamanho = len(codigos)
    out: list[dict] = []
    i = 0
    while i < len(codigos):
        grupo = codigos[i:i + tamanho]
        try:
            out += linhas(fonte.get(f"/t/{TABELA}/n6/in n3 {uf}/v/{var}/p/{ano}/{CLASSIF}/{','.join(grupo)}"))
            i += len(grupo)
        except LimiteExcedido as e:
            novo = max(1, math.floor(len(grupo) * e.limite / e.solicitados * 0.95))
            if novo >= tamanho:
                novo = tamanho - 1
            if novo < 1:
                raise
            log(f"    limite do SIDRA ({e.limite}): dividindo em grupos de {novo} produtos")
            tamanho = novo
    return out


def processar_ano(fonte: Fonte, ano: int) -> dict | None:
    prods = produtos_do_ano(fonte, ano)
    if not prods:
        return None
    nomes = {c: n for c, n in prods}
    codigos = [c for c, n in prods if not eh_subtotal(n)]
    log(f"PAM {ano}: {len(codigos)} categorias (inclui Total)")
    acc: dict[tuple[str, str], list[float]] = {}
    sem_info = 0
    for uf in UFS_IBGE:
        for var, pos in ((V_VALOR, 1), (V_AREA, 0)):
            for r in coletar_uf(fonte, ano, uf, var, codigos):
                x = valor(r["V"])
                if x is None:
                    sem_info += 1
                    continue
                if pos == 1:
                    x *= 1000.0  # mil R$ -> R$
                k = (r["loc"], r["prod"])
                acc.setdefault(k, [0.0, 0.0])[pos] += x
        log(f"  UF {uf} ok")

    total_cod = next((c for c, n in prods if eh_total(n)), None)
    lista = sorted({nomes[p] for (_, p) in acc if p != total_cod})
    idx = {n: i for i, n in enumerate(lista)}
    r_prod, r_tot = [], []
    for (ibge, p), (area, val) in sorted(acc.items()):
        if not ibge or len(ibge) != 7:
            continue
        if p == total_cod:
            r_tot.append([ibge, round(area), round(val)])
        elif area > 0 or val > 0:
            r_prod.append([ibge, idx[nomes[p]], round(area), round(val)])
    if not r_tot:  # sem categoria Total: soma as culturas
        soma: dict[str, list[float]] = {}
        for ibge, _, a, v in r_prod:
            s = soma.setdefault(ibge, [0, 0])
            s[0] += a
            s[1] += v
        r_tot = [[k, *v] for k, v in sorted(soma.items())]
    log(f"  {len(r_tot)} municípios, {len(r_prod)} linhas município×cultura, {sem_info} valores sem informação ('...', 'X')")
    return {"ano": ano, "produtos": lista, "h": ["ibge", "prod", "area", "valor"], "r": r_prod,
            "ht": ["ibge", "area", "valor"], "t": r_tot}


def main(argv=None) -> int:
    hoje = dt.date.today()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--inicio", type=int, default=2013)
    ap.add_argument("--fim", type=int, default=hoje.year)
    ap.add_argument("--refresh", type=int, default=2, help="reprocessa os N anos mais recentes publicados (revisões)")
    ap.add_argument("--out", type=Path, default=Path("public/data"))
    ap.add_argument("--fixtures", type=Path)
    a = ap.parse_args(argv)

    fonte = Fonte(a.fixtures)
    a.out.mkdir(parents=True, exist_ok=True)
    existentes = sorted(int(p.stem.split("_")[1]) for p in a.out.glob("pam_[0-9]*.json"))
    recentes = set(existentes[-a.refresh:]) if a.refresh else set()
    for ano in range(a.fim, a.inicio - 1, -1):
        if ano in existentes and ano not in recentes:
            continue
        try:
            res = processar_ano(fonte, ano)
        except Exception as e:  # um ano com falha não derruba os demais
            log(f"PAM {ano}: ERRO {e}")
            continue
        if res is None:
            log(f"PAM {ano}: ainda não publicada")
            continue
        (a.out / f"pam_{ano}.json").write_text(json.dumps(res, ensure_ascii=False, separators=(",", ":")), "utf-8")

    anos = sorted(int(p.stem.split("_")[1]) for p in a.out.glob("pam_[0-9]*.json"))
    meta = {
        "geradoEm": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "fonte": "IBGE — Produção Agrícola Municipal (PAM), SIDRA tabela 5457",
        "fonteUrl": "https://sidra.ibge.gov.br/tabela/5457",
        "anos": anos,
        "amostra": a.fixtures is not None,
        "culturas": [{"nome": r, "pam": b if isinstance(b, list) else [b], "sicor": s} for r, b, s in CULTURAS],
    }
    (a.out / "pam_meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), "utf-8")
    log(f"PAM: anos disponíveis {anos}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
