// Cores por função (método dataviz): categórica em ordem fixa, sequencial de um só matiz.

/** Finalidades — slots categóricos 1–4 (passos para fundo escuro, validados para pares adjacentes). */
export const COR_FIN = ["#3987e5", "#d95926", "#199e70", "#c98500"];

/** Rampa sequencial verde para o mapa (escuro = pouco, claro = muito, sobre fundo escuro). */
export const RAMPA = ["#173a2c", "#1b5038", "#1f6844", "#258152", "#2e9b61", "#45b675", "#74d394"];
export const COR_ZERO = "#232826";

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
