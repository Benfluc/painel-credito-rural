// Inadimplência do crédito rural: SCR.data (por UF) + séries oficiais do SGS (nacionais).
import { carregar } from "./data";

export interface InadMeta {
  geradoEm: string;
  fonte: string;
  fonteUrl: string;
  meses: string[]; // "AAAA-MM"
  ultimoMes: string;
  dic: { sub: string[]; porte: string[]; origem: string[]; segmento: string[] };
  sgs: Record<string, string>;
}

/** [ym, uf, cli, sub, cart, inad, v90, ap, ops] */
export type LinhaUF = [string, string, number, number, number, number, number, number, number];
/** [ym, cli, sub, dim, cat, cart, inad, v90, ap, ops] */
export type LinhaDim = [string, number, number, string, number, number, number, number, number, number];

export interface InadDados {
  meta: InadMeta;
  uf: LinhaUF[];
  dim: LinhaDim[];
  sgs: Record<string, { nome: string; serie: [string, number][] }>;
}

export async function carregarInad(): Promise<InadDados | null> {
  try {
    const [meta, uf, dim] = await Promise.all([
      carregar<InadMeta>("inad_meta.json"),
      carregar<{ r: LinhaUF[] }>("inad_uf.json"),
      carregar<{ r: LinhaDim[] }>("inad_dim.json"),
    ]);
    const sgs = await carregar<InadDados["sgs"]>("inad_sgs.json").catch(() => ({}));
    return { meta, uf: uf.r, dim: dim.r, sgs };
  } catch {
    return null;
  }
}

export type Indicador = "inad" | "ap" | "v90";
export const NOME_IND: Record<Indicador, string> = {
  inad: "Taxa de inadimplência",
  ap: "Ativo problemático",
  v90: "Vencido há mais de 90 dias",
};
const COL: Record<Indicador, number> = { inad: 5, v90: 6, ap: 7 };

export interface FiltroInad {
  ym: string;
  cli: -1 | 0 | 1;
  sub: number; // -1 = todas
  ind: Indicador;
}

export interface Taxa {
  cart: number;
  num: number;
  inad: number;
  ap: number;
  ops: number;
}

const vazia = (): Taxa => ({ cart: 0, num: 0, inad: 0, ap: 0, ops: 0 });
export const taxa = (t: Taxa | undefined) => (t && t.cart > 0 ? t.num / t.cart : NaN);

function passa(cli: number, sub: number, f: FiltroInad) {
  return (f.cli < 0 || cli === f.cli) && (f.sub < 0 || sub === f.sub);
}

function soma(t: Taxa, r: (string | number)[], off: number, ind: Indicador) {
  t.cart += r[off] as number;
  t.num += r[off + (COL[ind] - 4)] as number;
  t.inad += r[off + 1] as number;
  t.ap += r[off + 3] as number;
  t.ops += r[off + 4] as number;
}

/** Totais por UF numa data-base. */
export function porUF(d: InadDados, f: FiltroInad): Map<string, Taxa> {
  const m = new Map<string, Taxa>();
  for (const r of d.uf) {
    if (r[0] !== f.ym || !passa(r[2], r[3], f)) continue;
    const t = m.get(r[1]) ?? vazia();
    soma(t, r, 4, f.ind);
    m.set(r[1], t);
  }
  return m;
}

export function totalDe(m: Map<string, Taxa>, uf: string | null): Taxa {
  if (uf) return m.get(uf) ?? vazia();
  const t = vazia();
  for (const x of m.values()) {
    t.cart += x.cart;
    t.num += x.num;
    t.inad += x.inad;
    t.ap += x.ap;
    t.ops += x.ops;
  }
  return t;
}

/** Série mensal da taxa (Brasil ou UF). */
export function serie(d: InadDados, f: FiltroInad, uf: string | null): Map<string, Taxa> {
  const m = new Map<string, Taxa>();
  for (const r of d.uf) {
    if (uf && r[1] !== uf) continue;
    if (!passa(r[2], r[3], f)) continue;
    const t = m.get(r[0]) ?? vazia();
    soma(t, r, 4, f.ind);
    m.set(r[0], t);
  }
  return m;
}

/** Quebra nacional por porte, origem ou segmento numa data-base. */
export function porDim(d: InadDados, f: FiltroInad, dim: "porte" | "origem" | "segmento"): { nome: string; t: Taxa }[] {
  const m = new Map<number, Taxa>();
  for (const r of d.dim) {
    if (r[0] !== f.ym || r[3] !== dim || !passa(r[1], r[2], f)) continue;
    const t = m.get(r[4]) ?? vazia();
    soma(t, r, 5, f.ind);
    m.set(r[4], t);
  }
  return [...m.entries()].map(([k, t]) => ({ nome: d.meta.dic[dim][k] ?? "—", t })).filter((x) => x.t.cart > 0);
}

export function ymMenos12(ym: string): string {
  const [a, m] = ym.split("-");
  return `${Number(a) - 1}-${m}`;
}

// Rampa sequencial laranja (claro = baixo risco, escuro = alto).
export const RAMPA_RISCO = ["#fde3d3", "#fbc6a8", "#f6a47c", "#ee8152", "#eb6834", "#c9521f", "#9e3f17"];
