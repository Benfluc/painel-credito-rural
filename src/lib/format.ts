import type { Metrica } from "./data";

const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** R$ compacto: R$ 1,2 bi · R$ 345,6 mi · R$ 12,3 mil */
export function brl(v: number, compacto = true): string {
  if (!compacto) return "R$ " + nf0.format(v);
  const a = Math.abs(v);
  if (a >= 1e12) return `R$ ${nf1.format(v / 1e12)} tri`;
  if (a >= 1e9) return `R$ ${nf1.format(v / 1e9)} bi`;
  if (a >= 1e6) return `R$ ${nf1.format(v / 1e6)} mi`;
  if (a >= 1e3) return `R$ ${nf1.format(v / 1e3)} mil`;
  return `R$ ${nf0.format(v)}`;
}

export function num(v: number, compacto = false): string {
  if (!compacto) return nf0.format(v);
  const a = Math.abs(v);
  if (a >= 1e6) return `${nf1.format(v / 1e6)} mi`;
  if (a >= 1e3) return `${nf1.format(v / 1e3)} mil`;
  return nf0.format(v);
}

export function ha(v: number): string {
  if (v >= 1e6) return `${nf1.format(v / 1e6)} mi ha`;
  if (v >= 1e3) return `${nf1.format(v / 1e3)} mil ha`;
  return `${nf0.format(v)} ha`;
}

export function pct(v: number): string {
  const s = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: "exceptZero" }).format(v * 100);
  return `${s}%`;
}

export function fmtMetrica(v: number, m: Metrica, compacto = true): string {
  if (m === "contratos") return num(v, compacto);
  return brl(v, compacto);
}

/** Rótulo curto para eixos: 80 bi · 350 mi · 12 mil */
export function eixo(v: number): string {
  const a = Math.abs(v);
  const f = (x: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: x < 10 ? 1 : 0 }).format(x);
  if (a >= 1e9) return `${f(v / 1e9)} bi`;
  if (a >= 1e6) return `${f(v / 1e6)} mi`;
  if (a >= 1e3) return `${f(v / 1e3)} mil`;
  return f(v);
}

export const NOME_METRICA: Record<Metrica, string> = {
  valor: "Valor contratado",
  contratos: "Nº de contratos",
  medio: "Valor médio por contrato",
};

export function mesAno(s: string | null): string {
  if (!s) return "—";
  const [a, m] = s.split("-");
  return `${MESES[Number(m) - 1]}/${a}`;
}

export function dataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
