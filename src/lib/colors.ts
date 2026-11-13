// Cores por função (método dataviz): categórica em ordem fixa, sequencial de um só matiz.

/** Finalidades — slots da paleta clara, ordem validada (CVD e visão normal ok entre vizinhos):
 *  custeio verde-água, investimento laranja, comercialização azul, industrialização dourado. */
export const COR_FIN = ["#1baf7a", "#eb6834", "#2a78d6", "#eda100"];

/** Rampa sequencial verde (claro = pouco, escuro = muito). */
export const RAMPA = ["#e6f4ea", "#c4e6cf", "#94d1aa", "#5fb684", "#36985f", "#1e7a45", "#0f5a31"];
export const COR_ZERO = "#d9d8d2";

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
