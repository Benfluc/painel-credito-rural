// Contratações (SICOR, fluxo) × inadimplência (SCR.data, estoque), por UF e no tempo.
import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, type TooltipProps,
} from "recharts";
import { carregar, type Meta, type Tabela } from "../lib/data";
import { serie, porUF, taxa, totalDe, NOME_IND, type FiltroInad, type InadDados } from "../lib/inad";
import { brl, eixo, mesAno } from "../lib/format";
import { Card, Segmentado, Skeleton, Vazio } from "./ui";

const VERDE = "#2f8f57";
const LARANJA = "#eb6834";
const pct = (x: number, c = 1) => (Number.isFinite(x) ? `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c }).format(x)}%` : "—");

function addMeses(ym: string, n: number) {
  const [a, m] = ym.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** Valor contratado por mês e UF (todas as finalidades e atividades) a partir das tabelas uf_AAAA. */
function contratadoMensal(tabs: Record<number, Tabela>, cols: string[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const [ano, t] of Object.entries(tabs)) {
    const ix = (c: string) => t.h.indexOf(c);
    const iMes = ix("mes"), iUf = ix("uf");
    const iv = cols.map(ix);
    for (const r of t.r) {
      const ym = `${ano}-${String(r[iMes]).padStart(2, "0")}`;
      const uf = r[iUf] as string;
      const v = iv.reduce((s, i) => s + (r[i] as number), 0);
      const m = out.get(ym) ?? new Map<string, number>();
      m.set(uf, (m.get(uf) ?? 0) + v);
      out.set(ym, m);
    }
  }
  return out;
}

function soma12(c: Map<string, Map<string, number>>, fim: string, uf: string | null): number | null {
  let s = 0;
  for (let k = 0; k < 12; k++) {
    const m = c.get(addMeses(fim, -k));
    if (!m) return null; // período incompleto
    s += uf ? m.get(uf) ?? 0 : [...m.values()].reduce((a, b) => a + b, 0);
  }
  return s;
}

interface Ponto {
  uf: string;
  sigla: string;
  x: number; // crescimento das contratações em 12 meses (%)
  y: number; // taxa (%)
  z: number; // carteira (R$)
  c12: number;
}

function DicaPonto({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Ponto;
  return (
    <div className="rounded-lg border border-stone-200 bg-white/95 px-3 py-2 text-xs shadow-xl">
      <div className="font-semibold text-stone-900">{p.sigla}</div>
      <div className="mt-1 grid grid-cols-[auto_auto] gap-x-4 tabular-nums text-stone-600">
        <span>Contratado em 12 meses</span>
        <span className="text-right text-stone-900">{brl(p.c12)}</span>
        <span>Variação em 12 meses</span>
        <span className="text-right text-stone-900">{pct(p.x)}</span>
        <span>Taxa</span>
        <span className="text-right font-semibold text-stone-900">{pct(p.y, 2)}</span>
        <span>Carteira</span>
        <span className="text-right text-stone-900">{brl(p.z)}</span>
      </div>
    </div>
  );
}

interface Props {
  meta: Meta;
  d: InadDados;
  f: FiltroInad;
  uf: string | null;
  setUf: (uf: string | null) => void;
  mobile?: boolean;
}

export default function ContratacoesInad({ meta, d, f, uf, setUf, mobile }: Props) {
  const [tabs, setTabs] = useState<Record<number, Tabela> | null>(null);
  const [janela, setJanela] = useState<36 | 60>(36);
  const anoFim = Number((f.ym || d.meta.ultimoMes).slice(0, 4));

  // carrega só os anos necessários (janela + 12 meses para a variação)
  useEffect(() => {
    const precisa = Math.ceil((janela + 12) / 12) + 1;
    const anos = meta.anos.filter((a) => a <= Math.max(...meta.anos) && a >= anoFim - precisa);
    let vivo = true;
    Promise.all(anos.map((a) => carregar<Tabela>(`uf_${a}.json`).then((t) => [a, t] as const)))
      .then((xs) => vivo && setTabs(Object.fromEntries(xs)))
      .catch(() => vivo && setTabs({}));
    return () => {
      vivo = false;
    };
  }, [meta.anos, anoFim, janela]);

  // finalidade do SICOR equivalente à submodalidade escolhida no SCR
  const nomeSub = f.sub >= 0 ? d.meta.dic.sub[f.sub] ?? "" : "";
  const cols = useMemo(() => {
    const n = nomeSub.toLowerCase();
    if (n.startsWith("custeio")) return ["vC"];
    if (n.startsWith("invest") || n.startsWith("financiamento")) return ["vI"];
    if (n.startsWith("comerc")) return ["vM"];
    if (n.startsWith("indus")) return ["vN"];
    return ["vC", "vI", "vM", "vN"];
  }, [nomeSub]);
  const contr = useMemo(() => (tabs ? contratadoMensal(tabs, cols) : null), [tabs, cols]);
  const rotuloContr = cols.length === 1 ? `Contratado por mês · ${{ vC: "custeio", vI: "investimento", vM: "comercialização", vN: "industrialização" }[cols[0]]} (R$)` : "Contratado por mês · todas as finalidades (R$)";

  // ---- séries no tempo (mesmo eixo de meses, dois gráficos) ----
  const serieT = useMemo(() => {
    if (!contr) return [];
    const ultimoSicor = [...contr.keys()].sort().pop()!;
    const fim = ultimoSicor > d.meta.ultimoMes ? ultimoSicor : d.meta.ultimoMes;
    const sInad = serie(d, f, uf);
    const out = [];
    for (let k = janela - 1; k >= 0; k--) {
      const ym = addMeses(fim, -k);
      const m = contr.get(ym);
      const c = m ? (uf ? m.get(uf) ?? 0 : [...m.values()].reduce((a, b) => a + b, 0)) : null;
      const t = taxa(sInad.get(ym));
      out.push({ ym, rotulo: mesAno(ym), contratado: c, taxa: Number.isFinite(t) ? t * 100 : null });
    }
    return out;
  }, [contr, d, f, uf, janela]);

  // ---- dispersão por UF: crescimento das contratações × taxa ----
  const pontos = useMemo<Ponto[]>(() => {
    if (!contr || !f.ym) return [];
    const m = porUF(d, f);
    const out: Ponto[] = [];
    for (const [u, t] of m) {
      const a = soma12(contr, f.ym, u);
      const b = soma12(contr, addMeses(f.ym, -12), u);
      const tx = taxa(t);
      if (a == null || b == null || !b || !Number.isFinite(tx)) continue;
      out.push({ uf: u, sigla: meta.ufs[u]?.sigla ?? u, x: (a / b - 1) * 100, y: tx * 100, z: t.cart, c12: a });
    }
    return out;
  }, [contr, d, f, meta]);

  const ref = useMemo(() => {
    if (!contr || !f.ym) return null;
    const a = soma12(contr, f.ym, null);
    const b = soma12(contr, addMeses(f.ym, -12), null);
    const t = taxa(totalDe(porUF(d, f), null));
    return a && b ? { x: (a / b - 1) * 100, y: t * 100 } : null;
  }, [contr, d, f]);

  const nomeEscopo = uf ? meta.ufs[uf]?.nome : "Brasil";
  const semSicor = !!f.ym && contr && !contr.has(f.ym);

  return (
    <Card
      titulo="Contratações × inadimplência"
      sub={`Crédito rural contratado (SICOR) e ${NOME_IND[f.ind].toLowerCase()} (SCR.data) · ${nomeEscopo}`}
      acao={
        <Segmentado
          rotulo="Janela"
          valor={janela}
          onChange={setJanela}
          opcoes={[
            { v: 36, t: "3 anos" },
            { v: 60, t: "5 anos" },
          ]}
        />
      }
      nota="Contratação é fluxo (o que foi concedido no mês); inadimplência é estoque (a carteira em atraso numa data-base), e o atraso aparece meses ou anos depois da concessão. A comparação mostra associação, não causa. As contratações são do SICOR (todas as atividades e programas, sem separar pessoa física e jurídica; a finalidade acompanha a submodalidade escolhida); a carteira, do SCR.data."
    >
      {!contr ? (
        <Skeleton className="h-80" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          {/* tempo: dois gráficos empilhados com o mesmo eixo de meses */}
          <div className="lg:col-span-3">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-500">{rotuloContr}</h3>
            <div className={mobile ? "h-[140px]" : "h-[170px]"}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serieT} syncId="ci" margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#e7e6e1" />
                  <XAxis dataKey="rotulo" hide scale="band" />
                  <YAxis tick={{ fill: "#6b6a64", fontSize: 11 }} axisLine={false} tickLine={false} width={58} tickFormatter={eixo} />
                  <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} formatter={(v: number) => [brl(v), "Contratado"]} labelStyle={{ color: "#1c1b19", fontWeight: 600 }} contentStyle={{ borderRadius: 8, borderColor: "#e7e5e0", fontSize: 12 }} />
                  <Bar dataKey="contratado" fill={VERDE} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <h3 className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-stone-500">{NOME_IND[f.ind]} (%)</h3>
            <div className={mobile ? "h-[140px]" : "h-[170px]"}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={serieT} syncId="ci" margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#e7e6e1" />
                  <XAxis dataKey="rotulo" scale="band" tick={{ fill: "#6b6a64", fontSize: 11 }} axisLine={{ stroke: "#d4d3cc" }} tickLine={false} minTickGap={36} />
                  <YAxis tick={{ fill: "#6b6a64", fontSize: 11 }} axisLine={false} tickLine={false} width={58} tickFormatter={(v) => `${v}%`} domain={["auto", "auto"]} />
                  <Tooltip formatter={(v: number) => [pct(v, 2), NOME_IND[f.ind]]} labelStyle={{ color: "#1c1b19", fontWeight: 600 }} contentStyle={{ borderRadius: 8, borderColor: "#e7e5e0", fontSize: 12 }} />
                  <Line type="monotone" dataKey="taxa" stroke={LARANJA} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] text-stone-500">Os dois gráficos compartilham o eixo de meses: passe o mouse ou toque para ver o mesmo mês nos dois.</p>
          </div>

          {/* dispersão por UF */}
          <div className="lg:col-span-2">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-500">Por UF · {mesAno(f.ym)}</h3>
            <p className="mb-2 text-[11px] text-stone-500">
              Eixo x: variação do valor contratado nos últimos 12 meses contra os 12 anteriores. Eixo y: {NOME_IND[f.ind].toLowerCase()}. Tamanho: carteira. As linhas tracejadas marcam o Brasil.
            </p>
            {semSicor || !pontos.length ? (
              <Vazio>Sem contratações do SICOR suficientes para esta data-base.</Vazio>
            ) : (
              <div className={mobile ? "h-[340px]" : "h-[360px]"}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 20, right: 16, bottom: 16, left: 0 }}>
                    <CartesianGrid stroke="#e7e6e1" />
                    <XAxis type="number" dataKey="x" name="Variação" tickFormatter={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}%`} tick={{ fill: "#6b6a64", fontSize: 11 }} axisLine={{ stroke: "#d4d3cc" }} tickLine={false} domain={["auto", "auto"]} />
                    <YAxis type="number" dataKey="y" name="Taxa" tickFormatter={(v) => `${v}%`} tick={{ fill: "#6b6a64", fontSize: 11 }} axisLine={false} tickLine={false} width={44} domain={[0, (max: number) => Math.ceil((max * 1.08) / 4) * 4]} tickCount={5} />
                    <ZAxis type="number" dataKey="z" range={mobile ? [24, 320] : [40, 600]} />
                    {ref && <ReferenceLine x={ref.x} stroke="#a9a89f" strokeDasharray="4 4" />}
                    {ref && <ReferenceLine y={ref.y} stroke="#a9a89f" strokeDasharray="4 4" />}
                    <Tooltip content={<DicaPonto />} cursor={{ strokeDasharray: "3 3" }} />
                    <Scatter
                      data={pontos}
                      fill={VERDE}
                      fillOpacity={0.55}
                      stroke="#1f6b41"
                      isAnimationActive={false}
                      onClick={(p) => setUf((p as unknown as Ponto).uf === uf ? null : (p as unknown as Ponto).uf)}
                      shape={(props: { cx?: number; cy?: number; size?: number; payload?: Ponto }) => {
                        const r = Math.sqrt((props.size ?? 64) / Math.PI);
                        const sel = props.payload?.uf === uf;
                        return <circle cx={props.cx} cy={props.cy} r={r} fill={sel ? LARANJA : VERDE} fillOpacity={sel ? 0.9 : 0.5} stroke={sel ? "#9e3f17" : "#1f6b41"} strokeWidth={sel ? 2 : 1} cursor="pointer" />;
                      }}
                    >
                      <LabelList dataKey="sigla" position="top" style={{ fill: "#3f3e3a", fontSize: mobile ? 9 : 10, fontWeight: 600 }} />
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
            {ref && (
              <p className="mt-1 text-[11px] text-stone-500">
                Brasil: contratações {ref.x >= 0 ? "+" : ""}
                {pct(ref.x)} em 12 meses · {NOME_IND[f.ind].toLowerCase()} {pct(ref.y, 2)}. Quadrante de cima à direita: crédito crescendo e inadimplência acima da média.
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
