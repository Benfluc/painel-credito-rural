import { useMemo } from "react";
import { CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import type { Filtros, Geo, Meta, TabelaProd } from "../lib/data";
import { CLASSES_QL, corQL, porCultura, spearman, type Par, type PamAno, type PamMeta } from "../lib/pam";
import { brl, eixo } from "../lib/format";
import { COR_ZERO } from "../lib/colors";
import { Card, Segmentado, Vazio } from "./ui";
import { FIN_NOMES } from "./Graficos";

const nfQ = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
export const fmtQL = (q: number) => (Number.isNaN(q) ? "—" : q === Infinity ? "∞" : nfQ.format(q));
const pctS = (x: number) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(x * 100)}%`;

export function LegendaQL({ ref_ }: { ref_: string }) {
  return (
    <div>
      <div className="mb-1.5 font-medium text-white/85">Quociente de localização · ref. {ref_}</div>
      <div className="flex items-center gap-[2px]">
        <span className="mr-1 h-2.5 w-4 rounded-sm" style={{ background: COR_ZERO }} title="Sem crédito e sem produção" />
        {CLASSES_QL.map((c) => (
          <span key={c.rotulo} className="h-2.5 w-7 first:rounded-l-sm last:rounded-r-sm" style={{ background: c.cor }} title={c.rotulo} />
        ))}
      </div>
      <div className="mt-1 flex justify-between gap-3">
        <span>menos crédito que produção</span>
        <span>equilíbrio</span>
        <span>mais crédito</span>
      </div>
    </div>
  );
}

interface Ponto {
  id: string;
  nome: string;
  x: number;
  y: number;
  ql: number;
  par: Par;
}

function DicaPonto({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Ponto;
  return (
    <div className="rounded-lg border border-white/10 bg-[#0b100e]/95 px-3 py-2 text-xs shadow-xl">
      <div className="font-semibold text-white">{p.nome}</div>
      <div className="mt-1 grid grid-cols-[auto_auto] gap-x-4 tabular-nums text-white/70">
        <span>Produção (PAM)</span>
        <span className="text-right text-white">{brl(p.par.p)}</span>
        <span>Crédito agrícola</span>
        <span className="text-right text-white">{brl(p.par.c)}</span>
        <span>QL</span>
        <span className="text-right font-semibold text-emerald-300">{fmtQL(p.ql)}</span>
      </div>
    </div>
  );
}

interface Props {
  meta: Meta;
  pamMeta: PamMeta;
  pam: PamAno | null;
  anoPam: { ano: number | null; exato: boolean };
  defasagem: 0 | 1;
  setDefasagem: (d: 0 | 1) => void;
  escopo: { pares: Map<string, Par>; C: number; P: number } | null;
  prod: TabelaProd | null;
  f: Filtros;
  geo: Geo;
  nomeMun: Map<string, string>;
  onMun: (id: string) => void;
  avisoMun?: string;
}

export default function CreditoProducao({ meta, pamMeta, pam, anoPam, defasagem, setDefasagem, escopo, prod, f, geo, nomeMun, onMun, avisoMun }: Props) {
  const nomeEscopo = geo.uf ? meta.ufs[geo.uf]?.nome : "Brasil";
  const fins = FIN_NOMES.filter((_, k) => f.fins[k]).join(", ").toLowerCase();

  const ind = useMemo(() => {
    if (!escopo) return null;
    const xs: number[] = [],
      ys: number[] = [];
    let pSemCred = 0,
      nSemCred = 0,
      acima = 0,
      abaixo = 0;
    const pontos: Ponto[] = [];
    for (const [id, par] of escopo.pares) {
      if (par.p > 0) {
        xs.push(par.p);
        ys.push(par.c);
        if (par.c === 0) {
          pSemCred += par.p;
          nSemCred++;
        }
        if (par.ql >= 2) acima++;
        if (par.ql < 0.5) abaixo++;
      }
      if (par.p > 0 && par.c > 0) pontos.push({ id, nome: nomeMun.get(id) ?? id, x: par.p, y: par.c, ql: par.ql, par });
    }
    return { rho: spearman(xs, ys), n: xs.length, pSemCred, nSemCred, acima, abaixo, pontos, razao: escopo.P ? escopo.C / escopo.P : 0 };
  }, [escopo, nomeMun]);

  const culturas = useMemo(() => (pam && prod ? porCultura(pamMeta, pam, prod, f, geo.uf).linhas.slice(0, 10) : []), [pam, prod, pamMeta, f, geo.uf]);
  const maxShare = Math.max(0.01, ...culturas.map((c) => Math.max(c.shareC, c.shareP)));
  const sel = geo.mun ? escopo?.pares.get(geo.mun) : undefined;

  const acao = (
    <Segmentado
      rotulo="Ano da produção comparada"
      valor={defasagem}
      onChange={setDefasagem}
      opcoes={[
        { v: 0, t: "PAM do mesmo ano" },
        { v: 1, t: "PAM do ano seguinte" },
      ]}
    />
  );

  if (!anoPam.ano || !pam || !escopo || !ind)
    return (
      <Card titulo="Crédito × produção agrícola" sub="Integração com a Produção Agrícola Municipal (IBGE)" acao={acao}>
        <Vazio>{anoPam.ano ? "Carregando a PAM…" : `A PAM de ${f.ano + defasagem} ainda não foi publicada pelo IBGE.`}</Vazio>
      </Card>
    );

  const xs = ind.pontos.map((p) => p.x);
  const xMin = Math.min(...xs, 1e5),
    xMax = Math.max(...xs, 1e6);

  return (
    <Card
      titulo="Crédito × produção agrícola"
      sub={`Crédito agrícola (${fins}) de ${f.ano} × valor da produção da PAM ${anoPam.ano}${anoPam.exato ? "" : " (mais recente publicada)"} · ${nomeEscopo}`}
      acao={acao}
      nota={
        <>
          QL = (crédito do município ÷ crédito de {nomeEscopo}) ÷ (produção do município ÷ produção de {nomeEscopo}). Considera só o crédito de atividade agrícola, porque a PAM não cobre pecuária. O crédito é
          registrado no município do empreendimento; a produção, onde foi colhida. Valores nominais do mesmo período. A comparação por cultura usa só o custeio, que é publicado por produto e por UF.
          {pamMeta.amostra && " Modo amostra: a PAM carregada tem só os municípios de MG (2023)."}
        </>
      }
    >
      {avisoMun && (
        <div className="mb-4 rounded-lg border border-amber-400/20 bg-amber-400/[0.07] px-3 py-2 text-xs text-amber-100/85">
          <b>Atenção:</b> {avisoMun} Como o crédito com recursos livres e LCA não equalizada fica de fora, o QL municipal subestima o crédito em regiões de agricultura empresarial. Os indicadores
          por cultura e por estado usam a base completa.
        </div>
      )}
      {/* indicadores */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { r: "Crédito por R$ 100 produzidos", v: `R$ ${nfQ.format(ind.razao * 100)}`, d: `${brl(escopo.C)} ÷ ${brl(escopo.P)}` },
          { r: "Correlação de postos (Spearman)", v: Number.isNaN(ind.rho) ? "—" : `ρ = ${nfQ.format(ind.rho)}`, d: `${ind.n.toLocaleString("pt-BR")} municípios com produção` },
          { r: "Produção sem crédito agrícola", v: pctS(escopo.P ? ind.pSemCred / escopo.P : 0), d: `${ind.nSemCred.toLocaleString("pt-BR")} municípios sem nenhum contrato` },
          sel
            ? { r: `QL de ${nomeMun.get(geo.mun!) ?? geo.mun}`, v: fmtQL(sel.ql), d: `${brl(sel.c)} de crédito · ${brl(sel.p)} produzidos` }
            : { r: "Municípios fora do equilíbrio", v: `${ind.acima.toLocaleString("pt-BR")} ↑ · ${ind.abaixo.toLocaleString("pt-BR")} ↓`, d: "QL ≥ 2 (↑) e QL < 0,5 (↓)" },
        ].map((k) => (
          <div key={k.r} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-white/45">{k.r}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-white">{k.v}</div>
            <div className="mt-0.5 text-[11px] text-white/40">{k.d}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* dispersão */}
        <div className="lg:col-span-3">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-white/50">Cada ponto é um município · eixo y: crédito agrícola · escala log</h3>
          <p className="mb-2 text-[11px] text-white/40">
            A linha marca a proporção de {nomeEscopo} (QL = 1). Acima dela, o município recebe mais crédito do que sua fatia na produção. Fora do gráfico: {ind.nSemCred.toLocaleString("pt-BR")} municípios com produção e sem crédito.
          </p>
          {ind.pontos.length ? (
            <div className="h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 4 }}>
                  <CartesianGrid stroke="#2c2c2a" />
                  <XAxis type="number" dataKey="x" scale="log" domain={["auto", "auto"]} tickFormatter={eixo} tick={{ fill: "#898781", fontSize: 11 }} axisLine={{ stroke: "#383835" }} tickLine={false} name="Produção" label={{ value: "Valor da produção (R$)", position: "insideBottom", offset: -10, fill: "#898781", fontSize: 11 }} />
                  <YAxis type="number" dataKey="y" scale="log" domain={["auto", "auto"]} tickFormatter={eixo} tick={{ fill: "#898781", fontSize: 11 }} axisLine={false} tickLine={false} width={52} name="Crédito" />
                  <Tooltip content={<DicaPonto />} cursor={{ stroke: "#555", strokeDasharray: "3 3" }} />
                  <ReferenceLine segment={[{ x: xMin, y: xMin * ind.razao }, { x: xMax, y: xMax * ind.razao }]} stroke="#c3c2b7" strokeDasharray="5 4" ifOverflow="hidden" />
                  <Scatter data={ind.pontos} isAnimationActive={false} onClick={(p) => onMun((p as unknown as Ponto).id)}>
                    {ind.pontos.map((p) => (
                      <Cell key={p.id} fill={corQL(p.par, COR_ZERO)} fillOpacity={geo.mun && p.id !== geo.mun ? 0.35 : 0.85} stroke={p.id === geo.mun ? "#fff" : "none"} strokeWidth={2} r={p.id === geo.mun ? 7 : 3} cursor="pointer" />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Vazio>Sem municípios com crédito e produção neste recorte.</Vazio>
          )}
        </div>

        {/* culturas */}
        <div className="lg:col-span-2">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-white/50">Fatia de cada cultura · {nomeEscopo}</h3>
          <div className="mb-3 flex gap-4 text-[11px] text-white/60">
            <span className="flex items-center gap-1.5">
              <i className="h-2 w-2 rounded-sm bg-[#45b675]" /> no valor da produção
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-2 w-2 rounded-sm bg-[#3987e5]" /> no custeio agrícola
            </span>
          </div>
          {culturas.length ? (
            <ul className="space-y-2.5">
              {culturas.map((c) => (
                <li key={c.nome} className="text-[13px]">
                  <div className="mb-1 flex justify-between">
                    <span className="text-white/85">{c.nome}</span>
                    <span className="tabular-nums text-[12px] text-white/55">
                      {pctS(c.shareP)} · <span className="text-white/80">{pctS(c.shareC)}</span>
                    </span>
                  </div>
                  <div className="space-y-[2px]">
                    <div className="h-1.5 rounded-full bg-white/[0.04]">
                      <div className="h-full rounded-full bg-[#45b675]" style={{ width: `${(c.shareP / maxShare) * 100}%` }} />
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.04]">
                      <div className="h-full rounded-full bg-[#3987e5]" style={{ width: `${(c.shareC / maxShare) * 100}%` }} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Vazio>Sem culturas comparáveis neste recorte.</Vazio>
          )}
        </div>
      </div>
    </Card>
  );
}
