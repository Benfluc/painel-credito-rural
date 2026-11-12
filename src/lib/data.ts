// Camada de dados: carrega os JSONs gerados pelo ETL e agrega conforme os filtros.

export type Cell = string | number;
export interface Tabela {
  h: string[];
  r: Cell[][];
}
export interface TabelaProd extends Tabela {
  produtos: string[];
}
export interface TabelaIF extends Tabela {
  ifs: string[];
  segmentos: string[];
}

export interface Meta {
  geradoEm: string;
  amostra: boolean;
  fonte: string;
  fonteUrl: string;
  licenca: string;
  anos: number[];
  mesesPorAno: Record<string, number[]>;
  ultimoMes: string | null;
  ufs: Record<string, { sigla: string; nome: string; regiao: string }>;
  programas: string[];
  fontes: string[];
  finalidades: string[];
  sexos: string[];
  /** "microdados" quando a base veio dos arquivos .gz do BCB (API fora do ar). */
  origem?: "api" | "microdados";
  /** Fração do valor (v) e dos contratos (q) com município publicado, por ano. */
  munCobertura?: Record<string, { v: number; q: number }>;
  generoDisponivel?: boolean;
}

export type Metrica = "valor" | "contratos" | "medio";

export interface Filtros {
  ano: number;
  fins: [boolean, boolean, boolean, boolean]; // custeio, investimento, comercialização, industrialização
  at: 0 | 1 | 2; // 0 = todas, 1 = agrícola, 2 = pecuária
  pg: number; // -1 = todos
  metrica: Metrica;
}

export interface Geo {
  uf: string | null; // código IBGE (2 dígitos)
  mun: string | null; // código IBGE (7 dígitos)
}

export interface QV {
  q: number;
  v: number;
}

const cache = new Map<string, Promise<unknown>>();
export function carregar<T>(arquivo: string): Promise<T> {
  if (!cache.has(arquivo)) {
    const p = fetch(`/data/${arquivo}`).then((r) => {
      if (!r.ok) throw new Error(`${arquivo}: HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(arquivo));
    cache.set(arquivo, p);
  }
  return cache.get(arquivo) as Promise<T>;
}

export interface DadosAno {
  uf: Tabela;
  mun: Tabela;
  prod: TabelaProd;
  ifs: TabelaIF;
  gen: Tabela;
}

export async function carregarAno(ano: number): Promise<DadosAno> {
  const [uf, mun, prod, ifs, gen] = await Promise.all([
    carregar<Tabela>(`uf_${ano}.json`),
    carregar<Tabela>(`mun_${ano}.json`),
    carregar<TabelaProd>(`prod_${ano}.json`),
    carregar<TabelaIF>(`if_${ano}.json`),
    carregar<Tabela>(`gen_${ano}.json`),
  ]);
  return { uf, mun, prod, ifs, gen };
}

// --------------------------------------------------------------------------
// Utilitários de agregação
// --------------------------------------------------------------------------
const PARES = [
  ["qC", "vC"],
  ["qI", "vI"],
  ["qM", "vM"],
  ["qN", "vN"],
] as const;

interface Leitor {
  idx: (c: string) => number;
  qv: (row: Cell[]) => QV;
  porFin: (row: Cell[]) => QV[];
  passa: (row: Cell[], ignorarPg?: boolean) => boolean;
}

function leitor(t: Tabela, f: Filtros): Leitor {
  const ix = new Map(t.h.map((c, i) => [c, i]));
  const idx = (c: string) => ix.get(c) ?? -1;
  const pares = PARES.map(([q, v]) => [idx(q), idx(v)] as const);
  const iAt = idx("at");
  const iPg = idx("pg");
  return {
    idx,
    qv(row) {
      let q = 0,
        v = 0;
      for (let k = 0; k < 4; k++) {
        if (!f.fins[k]) continue;
        q += row[pares[k][0]] as number;
        v += row[pares[k][1]] as number;
      }
      return { q, v };
    },
    porFin(row) {
      return pares.map(([iq, iv]) => ({ q: row[iq] as number, v: row[iv] as number }));
    },
    passa(row, ignorarPg) {
      if (f.at && iAt >= 0 && row[iAt] !== f.at) return false;
      if (!ignorarPg && f.pg >= 0 && iPg >= 0 && row[iPg] !== f.pg) return false;
      return true;
    },
  };
}

function somaQV(m: Map<string | number, QV>, k: string | number, x: QV) {
  const a = m.get(k);
  if (a) {
    a.q += x.q;
    a.v += x.v;
  } else m.set(k, { ...x });
}

export function valorMetrica(x: QV | undefined, metrica: Metrica): number {
  if (!x) return 0;
  if (metrica === "valor") return x.v;
  if (metrica === "contratos") return x.q;
  return x.q > 0 ? x.v / x.q : 0;
}

/** Totais por UF (tabela UF mensal). */
export function porUF(t: Tabela, f: Filtros): Map<string, QV> {
  const L = leitor(t, f);
  const iUf = L.idx("uf");
  const m = new Map<string, QV>();
  for (const r of t.r) if (L.passa(r)) somaQV(m as Map<string | number, QV>, r[iUf] as string, L.qv(r));
  return m;
}

export interface QVMun extends QV {
  aC: number;
  aI: number;
}

/** Totais por município (tabela municipal anual). */
export function porMun(t: Tabela, f: Filtros, uf: string | null): Map<string, QVMun> {
  const L = leitor(t, f);
  const iIbge = L.idx("ibge");
  const iaC = L.idx("aC");
  const iaI = L.idx("aI");
  const m = new Map<string, QVMun>();
  for (const r of t.r) {
    const ibge = r[iIbge] as string;
    if (uf && !ibge.startsWith(uf)) continue;
    if (!L.passa(r)) continue;
    const x = L.qv(r);
    const aC = f.fins[0] ? (r[iaC] as number) : 0;
    const aI = f.fins[1] ? (r[iaI] as number) : 0;
    const a = m.get(ibge);
    if (a) {
      a.q += x.q;
      a.v += x.v;
      a.aC += aC;
      a.aI += aI;
    } else m.set(ibge, { ...x, aC, aI });
  }
  return m;
}

export function total(m: Map<string, QV>): QV {
  let q = 0,
    v = 0;
  for (const x of m.values()) {
    q += x.q;
    v += x.v;
  }
  return { q, v };
}

/** Série mensal por finalidade (12 meses × 4 finalidades) para Brasil ou uma UF. */
export function mensal(t: Tabela, f: Filtros, uf: string | null): QV[][] {
  const L = leitor(t, f);
  const iUf = L.idx("uf");
  const iMes = L.idx("mes");
  const out = Array.from({ length: 12 }, () => Array.from({ length: 4 }, () => ({ q: 0, v: 0 })));
  for (const r of t.r) {
    if (uf && r[iUf] !== uf) continue;
    if (!L.passa(r)) continue;
    const pf = L.porFin(r);
    const mes = (r[iMes] as number) - 1;
    for (let k = 0; k < 4; k++) {
      out[mes][k].q += pf[k].q;
      out[mes][k].v += pf[k].v;
    }
  }
  return out;
}

/** Quebra por uma dimensão categórica (pg ou fg), respeitando os demais filtros. */
export function porDimensao(t: Tabela, f: Filtros, dim: "pg" | "fg", uf: string | null, mun: string | null = null): Map<number, QV> {
  const L = leitor(t, f);
  const iD = L.idx(dim);
  const iUf = L.idx("uf");
  const iIbge = L.idx("ibge");
  const m = new Map<number, QV>();
  for (const r of t.r) {
    if (mun && r[iIbge] !== mun) continue;
    if (!mun && uf && iUf >= 0 && r[iUf] !== uf) continue;
    if (!mun && uf && iIbge >= 0 && !(r[iIbge] as string).startsWith(uf)) continue;
    if (!L.passa(r, dim === "pg")) continue;
    somaQV(m as Map<string | number, QV>, r[iD] as number, L.qv(r));
  }
  return m;
}

/** Série histórica anual por finalidade. */
export function historico(t: Tabela, f: Filtros, uf: string | null): { ano: number; fins: QV[] }[] {
  const L = leitor(t, f);
  const iAno = L.idx("ano");
  const iUf = L.idx("uf");
  const m = new Map<number, QV[]>();
  for (const r of t.r) {
    if (uf && r[iUf] !== uf) continue;
    if (!L.passa(r)) continue;
    const ano = r[iAno] as number;
    if (!m.has(ano)) m.set(ano, Array.from({ length: 4 }, () => ({ q: 0, v: 0 })));
    const acc = m.get(ano)!;
    const pf = L.porFin(r);
    for (let k = 0; k < 4; k++) {
      acc[k].q += pf[k].q;
      acc[k].v += pf[k].v;
    }
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([ano, fins]) => ({ ano, fins }));
}

export interface LinhaProduto {
  nome: string;
  fin: number;
  q: number;
  v: number;
  a: number;
}

/** Top produtos (custeio, investimento, comercialização) para Brasil ou UF. */
export function produtos(t: TabelaProd, f: Filtros, uf: string | null, n = 12): LinhaProduto[] {
  const ix = (c: string) => t.h.indexOf(c);
  const [iUf, iFin, iP, iAt, iPg, iQ, iV, iA] = ["uf", "fin", "prod", "at", "pg", "q", "v", "a"].map(ix);
  const m = new Map<string, LinhaProduto>();
  for (const r of t.r) {
    const fin = r[iFin] as number;
    if (!f.fins[fin]) continue;
    if (uf && r[iUf] !== uf) continue;
    if (f.at && r[iAt] !== f.at) continue;
    if (f.pg >= 0 && r[iPg] !== f.pg) continue;
    const nome = t.produtos[r[iP] as number];
    const k = `${fin}|${nome}`;
    const a = m.get(k) ?? { nome, fin, q: 0, v: 0, a: 0 };
    a.q += r[iQ] as number;
    a.v += r[iV] as number;
    a.a += r[iA] as number;
    m.set(k, a);
  }
  const chave = (x: LinhaProduto) => (f.metrica === "contratos" ? x.q : x.v);
  return [...m.values()].sort((a, b) => chave(b) - chave(a)).slice(0, n);
}

export interface LinhaIF {
  nome: string;
  segmento: string;
  q: number;
  v: number;
}

export function instituicoes(t: TabelaIF, f: Filtros, uf: string | null, n = 10): { top: LinhaIF[]; segmentos: { nome: string; q: number; v: number }[] } {
  const L = leitor(t, f);
  const [iUf, iIf, iSeg] = ["uf", "if", "seg"].map(L.idx);
  const m = new Map<number, LinhaIF>();
  const s = new Map<number, QV>();
  for (const r of t.r) {
    if (uf && r[iUf] !== uf) continue;
    if (!L.passa(r)) continue;
    const x = L.qv(r);
    const k = r[iIf] as number;
    const a = m.get(k) ?? { nome: t.ifs[k], segmento: t.segmentos[r[iSeg] as number] ?? "", q: 0, v: 0 };
    a.q += x.q;
    a.v += x.v;
    m.set(k, a);
    somaQV(s as Map<string | number, QV>, r[iSeg] as number, x);
  }
  const chave = (x: QV) => (f.metrica === "contratos" ? x.q : x.v);
  return {
    top: [...m.values()].sort((a, b) => chave(b) - chave(a)).slice(0, n),
    segmentos: [...s.entries()]
      .map(([k, x]) => ({ nome: t.segmentos[k] || "Não informado", ...x }))
      .sort((a, b) => chave(b) - chave(a)),
  };
}

export function genero(t: Tabela, f: Filtros, uf: string | null): Map<number, QV> {
  const L = leitor(t, f);
  const iUf = L.idx("uf");
  const iS = L.idx("sexo");
  const m = new Map<number, QV>();
  for (const r of t.r) {
    if (uf && r[iUf] !== uf) continue;
    if (!L.passa(r)) continue;
    somaQV(m as Map<string | number, QV>, r[iS] as number, L.qv(r));
  }
  return m;
}
