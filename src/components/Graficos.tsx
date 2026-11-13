import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import type { Metrica, QV } from "../lib/data";
import { COR_FIN } from "../lib/colors";
import { eixo, fmtMetrica, MESES } from "../lib/format";
import { Vazio } from "./ui";

export const FIN_NOMES = ["Custeio", "Investimento", "Comercialização", "Industrialização"];
const CHAVES = ["f0", "f1", "f2", "f3"] as const;

type Linha = { rotulo: string; total: number; f0: number; f1: number; f2: number; f3: number; q: number; v: number };

function linhas(serie: { rotulo: string; fins: QV[] }[], fins: boolean[], metrica: Metrica): Linha[] {
  return serie.map(({ rotulo, fins: fs }) => {
    const l: Linha = { rotulo, total: 0, f0: 0, f1: 0, f2: 0, f3: 0, q: 0, v: 0 };
    fs.forEach((x, k) => {
      if (!fins[k]) return;
      l.q += x.q;
      l.v += x.v;
      const val = metrica === "contratos" ? x.q : x.v;
      l[CHAVES[k]] = val;
    });
    l.total = metrica === "medio" ? (l.q ? l.v / l.q : 0) : l.f0 + l.f1 + l.f2 + l.f3;
    return l;
  });
}

function Dica({ active, payload, label, metrica, fins }: TooltipProps<number, string> & { metrica: Metrica; fins: boolean[] }) {
  if (!active || !payload?.length) return null;
  const l = payload[0].payload as Linha;
  return (
    <div className="rounded-lg border border-stone-200 bg-white/95 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-semibold text-stone-900">{label}</div>
      {metrica !== "medio" &&
        FIN_NOMES.map((n, k) =>
          fins[k] && l[CHAVES[k]] > 0 ? (
            <div key={n} className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-1.5 text-stone-600">
                <i className="h-2 w-2 rounded-sm" style={{ background: COR_FIN[k] }} />
                {n}
              </span>
              <span className="tabular-nums text-stone-800">{fmtMetrica(l[CHAVES[k]], metrica)}</span>
            </div>
          ) : null,
        )}
      <div className="mt-1 flex justify-between gap-6 border-t border-stone-200 pt-1 font-semibold">
        <span className="text-stone-700">{metrica === "medio" ? "Valor médio" : "Total"}</span>
        <span className="tabular-nums text-emerald-700">{fmtMetrica(l.total, metrica)}</span>
      </div>
    </div>
  );
}

export function LegendaFin({ fins }: { fins: boolean[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-600">
      {FIN_NOMES.map((n, k) =>
        fins[k] ? (
          <span key={n} className="flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-sm" style={{ background: COR_FIN[k] }} />
            {n}
          </span>
        ) : null,
      )}
    </div>
  );
}

export function BarrasEmpilhadas({ serie, fins, metrica, altura = 240 }: { serie: { rotulo: string; fins: QV[] }[]; fins: boolean[]; metrica: Metrica; altura?: number }) {
  const dados = linhas(serie, fins, metrica);
  if (!dados.some((d) => d.total > 0)) return <Vazio>Sem operações para os filtros escolhidos.</Vazio>;
  const ativos = CHAVES.filter((_, k) => fins[k]);
  return (
    <div style={{ height: altura }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 6, right: 4, left: 4, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="#e7e6e1" strokeDasharray="0" />
          <XAxis dataKey="rotulo" tick={{ fill: "#6b6a64", fontSize: 11 }} axisLine={{ stroke: "#d4d3cc" }} tickLine={false} />
          <YAxis tick={{ fill: "#6b6a64", fontSize: 11 }} axisLine={false} tickLine={false} width={58} tickFormatter={(v) => eixo(v)} />
          <Tooltip content={<Dica metrica={metrica} fins={fins} />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          {metrica === "medio" ? (
            <Bar dataKey="total" fill="#2f8f57" radius={[4, 4, 0, 0]} maxBarSize={56} />
          ) : (
            ativos.map((c, i) => (
              <Bar
                key={c}
                dataKey={c}
                stackId="s"
                maxBarSize={56}
                fill={COR_FIN[CHAVES.indexOf(c)]}
                stroke="#ffffff"
                strokeWidth={1}
                radius={i === ativos.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              />
            ))
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function serieMensal(m: QV[][], meses: number[] | undefined) {
  const ultimo = meses?.length ? Math.max(...meses) : 12;
  return m.slice(0, ultimo).map((fins, i) => ({ rotulo: MESES[i], fins }));
}
