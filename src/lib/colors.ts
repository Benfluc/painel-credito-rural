// Cores por função (método dataviz): categórica em ordem fixa, sequencial de um só matiz.

/** Finalidades — slots categóricos 1–4 do modo claro (validados: CVD ΔE ≥ 9,1 entre vizinhos). */
export const COR_FIN = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];

/** Rampa sequencial azul (claro = pouco, escuro = muito), passos 100–700 da paleta de referência. */
export const RAMPA = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
export const COR_ZERO = "#e2e1db";

/** Quebras por quantis (n classes) dos valores positivos. */
export function quebrasQuantis(valores: number[], n = RAMPA.length): number[] {
  const v = valores.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length === 0) return [];
  const q: number[] = [];
  for (let i = 1; i < n; i++) q.push(v[Math.min(v.length - 1, Math.floor((i / n) * v.length))]);
  return [...new Set(q)];
}

export function corDe(valor: number, quebras: number[]): string {
  if (!(valor > 0)) return COR_ZERO;
  let i = 0;
  while (i < quebras.length && valor >= quebras[i]) i++;
  // espalha as classes na rampa quando há menos quebras que cores
  const passo = (RAMPA.length - 1) / Math.max(1, quebras.length);
  return RAMPA[Math.round(i * passo)];
}
