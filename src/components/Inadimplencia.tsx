import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { TriangleAlert } from "lucide-react";
import MapaBrasil, { type Pintura } from "./MapaBrasil";
import { BarrasH, Card, Segmentado, Skeleton, Vazio } from "./ui";
import type { GeoBase } from "../lib/geo";
import type { Meta } from "../lib/data";
import { COR_ZERO, quebrasQuantis } from "../lib/colors";
import { brl, mesAno, num } from "../lib/format";
import { carregarInad, NOME_IND, porDim, porUF, RAMPA_RISCO, serie, taxa, totalDe, ymMenos12, type FiltroInad, type Indicador, type InadDados, type Taxa } from "../lib/inad";

const pctT = (x: number, casas = 2) => (Number.isFinite(x) ? `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(x * 100)}%` : "—");
const pp = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x * 100)} p.p.` : "—");

function corRisco(v: number, quebras: number[]) {
  if (!Number.isFinite(v)) return COR_ZERO;
  let i = 0;
  while (i < quebras.length && v >= quebras[i]) i++;
  const passo = (RAMPA_RISCO.length - 1) / Math.max(1, quebras.length);
  return RAMPA_RISCO[Math.round(i * passo)];
}

const CORES_SERIE = { scr: "#2a78d6", pf: "#eb6834", pj: "#1baf7a" };

function DicaSerie({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-stone-200 bg-white/95 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-semibold text-stone-900">{label}</div>
      {payload.map((p) =>
        p.value != null ? (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-1.5 text-stone-600">
              <i className="h-0.5 w-3 rounded" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="tabular-nums text-stone-900">{pctT(Number(p.value) / 100)}</span>
          </div>
        ) : null,
      )}
    </div>
  );
}

interface Props {
  meta: Meta;
  base: GeoBase | null;
  uf: string | null;
  setUf: (uf: string | null) => void;
  mobile?: boolean;
}

export default function Inadimplencia({ meta, base, uf, setUf, mobile }: Props) {
  const [d, setD] = useState<InadDados | null | undefined>(undefined);
  const [f, setF] = useState<FiltroInad>({ ym: "", cli: -1, sub: -1, ind: "inad" });

  useEffect(() => {
    carregarInad().then((x) => {
      setD(x);
      if (x) setF((p) => ({ ...p, ym: x.meta.ultimoMes }));
    });
  }, []);

  const m = useMemo(() => (d && f.ym ? porUF(d, f) : new Map<string, Taxa>()), [d, f]);
  const mAnt = useMemo(() => (d && f.ym ? porUF(d, { ...f, ym: ymMenos12(f.ym) }) : new Map<string, Taxa>()), [d, f]);
  const atual = useMemo(() => totalDe(m, uf), [m, uf]);
  const ant = useMemo(() => totalDe(mAnt, uf), [mAnt, uf]);

  const quebras = useMemo(() => quebrasQuantis([...m.values()].map(taxa).filter(Number.isFinite), RAMPA_RISCO.length), [m]);
  const nomeEscopo = uf ? meta.ufs[uf]?.nome : "Brasil";

  const pintura = useMemo<Pintura>(
    () => ({
      uf: (u) => corRisco(taxa(m.get(u)), quebras),
      mun: () => COR_ZERO,
      dica: (u) => {
        const t = m.get(u);
        return { valor: pctT(taxa(t)), rotulo: t ? `${NOME_IND[f.ind]} · carteira ${brl(t.cart)}` : "sem carteira" };
      },
      legenda: (
        <div>
          <div className="mb-1.5 font-medium text-stone-800">
            {NOME_IND[f.ind]} · {mesAno(f.ym)}
          </div>
          <div className="flex items-center gap-[2px]">
            {RAMPA_RISCO.map((c) => (
              <span key={c} className="h-2.5 w-7 first:rounded-l-sm last:rounded-r-sm" style={{ background: c }} />
            ))}
          </div>
          <div className="mt-1 flex justify-between gap-4 tabular-nums">
            <span>{pctT(quebras[0] ?? NaN, 1)}</span>
            <span>{pctT(quebras[quebras.length - 1] ?? NaN, 1)}+</span>
          </div>
        </div>
      ),
    }),
    [m, quebras, f.ind, f.ym],
  );

  const ranking = useMemo(
    () =>
      [...m.entries()]
        .map(([u, t]) => ({ k: u, nome: meta.ufs[u]?.nome ?? u, v: taxa(t), extra: brl(t.cart) }))
        .filter((x) => Number.isFinite(x.v))
        .sort((a, b) => b.v - a.v),
    [m, meta],
  );

  const dadosSerie = useMemo(() => {
    if (!d) return [];
    const s = serie(d, f, uf);
    const pf = new Map(d.sgs["21148"]?.serie ?? []);
    const pj = new Map(d.sgs["21136"]?.serie ?? []);
    const meses = [...new Set([...s.keys()])].sort();
    return meses.map((ym) => ({
      ym,
      rotulo: mesAno(ym),
      scr: Number.isFinite(taxa(s.get(ym))) ? taxa(s.get(ym)) * 100 : null,
      pf: !uf && f.ind === "inad" ? pf.get(ym) ?? null : null,
      pj: !uf && f.ind === "inad" ? pj.get(ym) ?? null : null,
    }));
  }, [d, f, uf]);

  const dims = useMemo(
    () =>
      d && f.ym
        ? (["porte", "origem", "segmento"] as const).map((k) => ({
            k,
            itens: porDim(d, f, k)
              .map((x) => ({ k: x.nome, nome: x.nome, v: taxa(x.t), extra: brl(x.t.cart) }))
              .filter((x) => Number.isFinite(x.v))
              .sort((a, b) => b.v - a.v),
          }))
        : [],
    [d, f],
  );

  if (d === undefined) return <Skeleton className="h-96" />;
  if (d === null)
    return (
      <Card titulo="Risco e inadimplência">
        <Vazio>
          Os dados de inadimplência ainda não foram gerados. Rode o workflow <b className="mx-1">Atualizar inadimplência (SCR.data + SGS)</b> no GitHub Actions.
        </Vazio>
      </Card>
    );

  const sel = "h-9 rounded-lg border border-stone-200 bg-stone-100 px-2.5 text-sm text-stone-900 focus:border-emerald-600/40 focus:outline-none";
  const delta = taxa(atual) - taxa(ant);
  const fmtTaxa = (v: number) => pctT(v);

  return (
    <div className="space-y-5">
      {/* filtros da aba */}
      <div className={mobile ? "rolagem-x -mx-4 flex items-center gap-2 px-4 [&>*]:shrink-0" : "flex flex-wrap items-center gap-2"}>
        <label className="sr-only" htmlFor="i-ym">Data-base</label>
        <select id="i-ym" className={sel} value={f.ym} onChange={(e) => setF({ ...f, ym: e.target.value })}>
          {[...d.meta.meses].reverse().map((ym) => (
            <option key={ym} value={ym} className="bg-white">
              Data-base {mesAno(ym)}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="i-sub">Submodalidade</label>
        <select id="i-sub" className={sel} value={f.sub} onChange={(e) => setF({ ...f, sub: Number(e.target.value) })}>
          <option value={-1} className="bg-white">Todas as submodalidades</option>
          {d.meta.dic.sub.map((s, i) => (
            <option key={s} value={i} className="bg-white">{s}</option>
          ))}
        </select>
        <Segmentado
          rotulo="Tipo de cliente"
          valor={f.cli}
          onChange={(cli) => setF({ ...f, cli })}
          opcoes={[
            { v: -1, t: "PF + PJ" },
            { v: 0, t: "Pessoa física" },
            { v: 1, t: "Pessoa jurídica" },
          ]}
        />
        <Segmentado<Indicador>
          rotulo="Indicador"
          valor={f.ind}
          onChange={(ind) => setF({ ...f, ind })}
          opcoes={[
            { v: "inad", t: "Inadimplência" },
            { v: "v90", t: "Vencido > 90 dias" },
            { v: "ap", t: "Ativo problemático" },
          ]}
        />
      </div>

      {/* aviso de limitações */}
      <details open={!mobile} className="group rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-900">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
          <TriangleAlert size={14} className="shrink-0" /> Limitações destes dados
          <span className="ml-auto text-[11px] font-normal text-amber-700 group-open:hidden">ver</span>
        </summary>
        <p className="mt-1.5">
          O mapa e os recortes vêm do SCR.data, modalidade <i>Financiamentos rurais e agroindustriais</i>, que junta o crédito rural e financiamentos agroindustriais; use o filtro de
          submodalidade para isolar as linhas rurais. Não há dado por município. A série oficial do crédito rural (SGS, recursos direcionados, atraso &gt; 90 dias) existe só para o Brasil. O
          SCR.data sai com cerca de 2 meses de defasagem e pode divergir de outras publicações do BCB. O conceito de ativo problemático mudou em jan/2025.
        </p>
      </details>

      {/* KPIs */}
      <div className={mobile ? "rolagem-x -mx-4 flex gap-3 px-4 pb-1 [&>*]:min-w-[72%]" : "grid grid-cols-2 gap-3 lg:grid-cols-5"}>
        {[
          { r: `${NOME_IND[f.ind]} · ${nomeEscopo}`, v: pctT(taxa(atual)), d: Number.isFinite(delta) ? `${pp(delta)} em 12 meses` : mesAno(f.ym), cor: delta > 0 ? "text-rose-600" : "text-emerald-700" },
          { r: "Carteira ativa", v: brl(atual.cart), d: `${num(atual.ops, true)} operações` },
          { r: "Carteira inadimplida", v: brl(atual.inad), d: "operações com atraso > 90 dias" },
          { r: "Ativo problemático", v: pctT(atual.cart ? atual.ap / atual.cart : NaN), d: brl(atual.ap) },
          {
            r: "Oficial · crédito rural PF (SGS 21148)",
            v: (() => {
              const s = d.sgs["21148"]?.serie;
              const p = s?.find((x) => x[0] === f.ym) ?? s?.[s.length - 1];
              return p ? pctT(p[1] / 100) : "—";
            })(),
            d: "Brasil · recursos direcionados",
          },
        ].map((k, i) => (
          <div key={i} className="card p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">{k.r}</div>
            <div className="mt-1.5 text-2xl font-semibold tracking-tight text-stone-900">{k.v}</div>
            <div className={`mt-1 text-xs ${k.cor ?? "text-stone-500"}`}>{k.d}</div>
          </div>
        ))}
      </div>

      {/* mapa + ranking */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" titulo={`${NOME_IND[f.ind]} por UF · ${mesAno(f.ym)}`} sub="Clique num estado para ver a série dele">
          <div className={mobile ? "h-[52vh]" : "h-[460px] sm:h-[520px]"}>
            {base ? (
              <MapaBrasil
                geo={base}
                sel={{ uf, mun: null }}
                nivelMun={false}
                valoresUF={new Map()}
                valoresMun={null}
                metrica="valor"
                nomesUF={meta.ufs}
                onUF={(u) => setUf(u === uf ? null : u)}
                onMun={() => undefined}
                pintura={pintura}
              />
            ) : (
              <Skeleton className="h-full" />
            )}
          </div>
        </Card>
        <Card titulo="Ranking dos estados" sub={`${NOME_IND[f.ind]} · maior para menor`}>
          <div className="max-h-[520px] overflow-y-auto pr-1">
            <BarrasH itens={ranking} fmt={fmtTaxa} cor="#eb6834" ativo={uf} max={Math.max(1e-9, ...ranking.map((x) => x.v))} onClick={(k) => setUf(k === uf ? null : k)} />
          </div>
        </Card>
      </div>

      {/* série */}
      <Card
        titulo={`Evolução mensal · ${nomeEscopo}`}
        sub={!uf && f.ind === "inad" ? "SCR.data (modalidade rural e agroindustrial) e séries oficiais do crédito rural (SGS)" : "SCR.data (modalidade rural e agroindustrial)"}
        nota={uf ? "As séries oficiais do SGS são nacionais; selecione Brasil para compará-las." : f.ind !== "inad" ? "As séries do SGS medem inadimplência (> 90 dias); aparecem com o indicador Inadimplência." : undefined}
      >
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dadosSerie} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e7e6e1" />
              <XAxis dataKey="rotulo" tick={{ fill: "#6b6a64", fontSize: 11 }} axisLine={{ stroke: "#d4d3cc" }} tickLine={false} minTickGap={40} />
              <YAxis tick={{ fill: "#6b6a64", fontSize: 11 }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<DicaSerie />} cursor={{ stroke: "#555" }} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#52514e" }} iconType="plainline" />
              <Line type="monotone" dataKey="scr" name={`SCR.data · ${nomeEscopo}`} stroke={CORES_SERIE.scr} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              {!uf && f.ind === "inad" && <Line type="monotone" dataKey="pf" name="Oficial · PF (SGS 21148)" stroke={CORES_SERIE.pf} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
              {!uf && f.ind === "inad" && <Line type="monotone" dataKey="pj" name="Oficial · PJ (SGS 21136)" stroke={CORES_SERIE.pj} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* recortes */}
      <div className="grid gap-5 lg:grid-cols-3">
        {dims.map(({ k, itens }) => (
          <Card key={k} titulo={k === "porte" ? "Por porte / renda do cliente" : k === "origem" ? "Por origem dos recursos" : "Por segmento da instituição"} sub={`${NOME_IND[f.ind]} · Brasil · ${mesAno(f.ym)}`} nota="Recorte nacional; o filtro de UF não se aplica.">
            <BarrasH itens={itens.slice(0, 10)} fmt={fmtTaxa} cor="#eb6834" max={Math.max(1e-9, ...itens.map((x) => x.v))} />
          </Card>
        ))}
      </div>

      <p className="text-[11px] text-stone-400">
        Fontes: Banco Central do Brasil — SCR.data (dados abertos) e Sistema Gerenciador de Séries Temporais (séries 21148, 21136, 21146 e 21147). Dados até {mesAno(d.meta.ultimoMes)}.
      </p>
    </div>
  );
}
