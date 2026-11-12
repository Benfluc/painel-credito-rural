// Integração com a Produção Agrícola Municipal (PAM/IBGE): crédito agrícola × valor da produção.
import { carregar, type Filtros, type Tabela, type TabelaProd } from "./data";

export interface PamMeta {
  geradoEm: string;
  fonte: string;
  fonteUrl: string;
  anos: number[];
  amostra: boolean;
  culturas: { nome: string; pam: string[]; sicor: string[] }[];
}

export interface PamAno {
  ano: number;
  produtos: string[];
  h: string[];
  r: [string, number, number, number][]; // ibge, produto, área colhida (ha), valor (R$)
  ht: string[];
  t: [string, number, number][]; // ibge, área, valor — total do município
}

export async function carregarPamMeta(): Promise<PamMeta | null> {
  try {
    return await carregar<PamMeta>("pam_meta.json");
  } catch {
    return null;
  }
}

export function carregarPam(ano: number): Promise<PamAno> {
  return carregar<PamAno>(`pam_${ano}.json`);
}

/** Ano da PAM a comparar: o mesmo do crédito ou o seguinte (custeio antecede a colheita). */
export function anoPam(meta: PamMeta, anoCredito: number, defasagem: 0 | 1): { ano: number | null; exato: boolean } {
  const alvo = anoCredito + defasagem;
  if (meta.anos.includes(alvo)) return { ano: alvo, exato: true };
  const antes = meta.anos.filter((a) => a <= alvo);
  return { ano: antes.length ? Math.max(...antes) : null, exato: false };
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const basePam = (nome: string) => norm(nome.split(" (")[0].replace("*", ""));

export interface Par {
  c: number; // crédito agrícola (R$)
  p: number; // valor da produção (R$)
  ql: number; // quociente de localização (NaN sem crédito e sem produção)
}

/** Crédito agrícola por município (atividade agrícola, finalidades e programa do filtro). */
export function creditoAgricolaMun(mun: Tabela, f: Filtros, uf: string | null): Map<string, number> {
  const ix = (c: string) => mun.h.indexOf(c);
  const iI = ix("ibge"),
    iAt = ix("at"),
    iPg = ix("pg");
  const iv = ["vC", "vI", "vM", "vN"].map(ix);
  const m = new Map<string, number>();
  for (const r of mun.r) {
    const id = r[iI] as string;
    if (uf && !id.startsWith(uf)) continue;
    if (r[iAt] !== 1) continue;
    if (f.pg >= 0 && r[iPg] !== f.pg) continue;
    let v = 0;
    for (let k = 0; k < 4; k++) if (f.fins[k]) v += r[iv[k]] as number;
    m.set(id, (m.get(id) ?? 0) + v);
  }
  return m;
}

export function producaoMun(pam: PamAno, uf: string | null): Map<string, { a: number; v: number }> {
  const m = new Map<string, { a: number; v: number }>();
  for (const [id, a, v] of pam.t) if (!uf || id.startsWith(uf)) m.set(id, { a, v });
  return m;
}

/** Pares crédito × produção com QL relativo ao recorte (Brasil ou UF). */
export function pares(cred: Map<string, number>, prod: Map<string, { v: number }>): { pares: Map<string, Par>; C: number; P: number } {
  let C = 0,
    P = 0;
  const ids = new Set([...cred.keys(), ...prod.keys()]);
  for (const id of ids) {
    C += cred.get(id) ?? 0;
    P += prod.get(id)?.v ?? 0;
  }
  const out = new Map<string, Par>();
  for (const id of ids) {
    const c = cred.get(id) ?? 0;
    const p = prod.get(id)?.v ?? 0;
    const ql = p > 0 ? c / C / (p / P) : c > 0 ? Infinity : NaN;
    out.set(id, { c, p, ql });
  }
  return { pares: out, C, P };
}

/** Agrega pares municipais por UF. */
export function paresUF(m: Map<string, Par>): { pares: Map<string, Par>; C: number; P: number } {
  const cred = new Map<string, number>();
  const prod = new Map<string, { v: number }>();
  for (const [id, x] of m) {
    const uf = id.slice(0, 2);
    cred.set(uf, (cred.get(uf) ?? 0) + x.c);
    const p = prod.get(uf) ?? { v: 0 };
    p.v += x.p;
    prod.set(uf, p);
  }
  return pares(cred, prod);
}

/** Correlação de postos de Spearman. */
export function spearman(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const postos = (v: number[]) => {
    const o = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(n);
    for (let i = 0; i < n; ) {
      let j = i;
      while (j + 1 < n && o[j + 1][0] === o[i][0]) j++;
      const media = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[o[k][1]] = media;
      i = j + 1;
    }
    return r;
  };
  const rx = postos(xs),
    ry = postos(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n,
    my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

export interface LinhaCultura {
  nome: string;
  credito: number; // custeio agrícola (R$)
  producao: number; // valor da produção (R$)
  shareC: number;
  shareP: number;
}

/** Fatia de cada cultura no custeio agrícola × no valor da produção (Brasil ou UF). */
export function porCultura(meta: PamMeta, pam: PamAno, prod: TabelaProd, f: Filtros, uf: string | null): { linhas: LinhaCultura[]; Ctot: number; Ptot: number } {
  // produção
  const grupoPam = new Map<string, string>();
  for (const c of meta.culturas) for (const b of c.pam) grupoPam.set(b, c.nome);
  const prodIdxGrupo = pam.produtos.map((n) => grupoPam.get(basePam(n)) ?? null);
  const P = new Map<string, number>();
  let Ptot = 0;
  for (const [id, pi, , v] of pam.r) {
    if (uf && !id.startsWith(uf)) continue;
    Ptot += v;
    const g = prodIdxGrupo[pi];
    if (g) P.set(g, (P.get(g) ?? 0) + v);
  }
  // crédito de custeio agrícola por produto
  const grupoSicor = new Map<string, string>();
  for (const c of meta.culturas) for (const s of c.sicor) grupoSicor.set(s, c.nome);
  const ix = (c: string) => prod.h.indexOf(c);
  const [iUf, iFin, iP, iAt, iPg, iV] = ["uf", "fin", "prod", "at", "pg", "v"].map(ix);
  const C = new Map<string, number>();
  let Ctot = 0;
  for (const r of prod.r) {
    if (r[iFin] !== 0 || r[iAt] !== 1) continue;
    if (uf && r[iUf] !== uf) continue;
    if (f.pg >= 0 && r[iPg] !== f.pg) continue;
    const v = r[iV] as number;
    Ctot += v;
    const g = grupoSicor.get(prod.produtos[r[iP] as number]);
    if (g) C.set(g, (C.get(g) ?? 0) + v);
  }
  const linhas = meta.culturas
    .map((c) => {
      const credito = C.get(c.nome) ?? 0;
      const producao = P.get(c.nome) ?? 0;
      return { nome: c.nome, credito, producao, shareC: Ctot ? credito / Ctot : 0, shareP: Ptot ? producao / Ptot : 0 };
    })
    .filter((l) => l.credito > 0 || l.producao > 0)
    .sort((a, b) => Math.max(b.shareC, b.shareP) - Math.max(a.shareC, a.shareP));
  return { linhas, Ctot, Ptot };
}

/** Principais culturas de um município na PAM. */
export function culturasMun(pam: PamAno, ibge: string, n = 6): { k: string; nome: string; v: number; a: number }[] {
  return pam.r
    .filter((r) => r[0] === ibge)
    .sort((a, b) => b[3] - a[3])
    .slice(0, n)
    .map(([, pi, a, v]) => ({ k: String(pi), nome: pam.produtos[pi].replace(/\*/g, "").replace(/\s*\(.*?\)\s*/g, " ").trim(), v, a }));
}

// ---------------------------------------------------------------- cores do QL
// Divergente azul ↔ vermelho com meio neutro (dataviz): azul = crédito abaixo da fatia na produção.
export const CLASSES_QL = [
  { ate: 0.25, cor: "#86b6ef", rotulo: "< 0,25" },
  { ate: 0.5, cor: "#3987e5", rotulo: "0,25–0,5" },
  { ate: 0.8, cor: "#1c5cab", rotulo: "0,5–0,8" },
  { ate: 1.25, cor: "#4a4a46", rotulo: "0,8–1,25" },
  { ate: 2, cor: "#a8403a", rotulo: "1,25–2" },
  { ate: 4, cor: "#d95353", rotulo: "2–4" },
  { ate: Infinity, cor: "#f19a8f", rotulo: "> 4" },
];

export function corQL(x: Par | undefined, zero: string): string {
  if (!x || Number.isNaN(x.ql)) return zero;
  for (const c of CLASSES_QL) if (x.ql < c.ate) return c.cor;
  return CLASSES_QL[CLASSES_QL.length - 1].cor;
}
