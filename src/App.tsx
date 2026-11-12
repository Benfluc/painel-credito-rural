import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Database, Radio, Sprout, TriangleAlert, ExternalLink } from "lucide-react";
import {
  carregar,
  carregarAno,
  genero,
  historico,
  instituicoes,
  mensal,
  porDimensao,
  porMun,
  porUF,
  produtos,
  total,
  valorMetrica,
  type DadosAno,
  type Filtros,
  type Geo,
  type Meta,
  type QV,
  type Tabela,
} from "./lib/data";
import { useGeo } from "./lib/geo";
import { brl, dataHora, fmtMetrica, ha, mesAno, MESES, NOME_METRICA, num, pct } from "./lib/format";
import { COR_FIN } from "./lib/colors";
import MapaBrasil from "./components/MapaBrasil";
import MunicipioAoVivo from "./components/MunicipioAoVivo";
import { BarraFiltros } from "./components/Filtros";
import { BarrasEmpilhadas, FIN_NOMES, LegendaFin, serieMensal } from "./components/Graficos";
import { BarrasH, Card, Segmentado, Skeleton } from "./components/ui";

// ---------------------------------------------------------------- URL <-> estado
function lerURL(): { f: Partial<Filtros>; geo: Geo } {
  const p = new URLSearchParams(location.search);
  const fins = p.get("fin");
  return {
    f: {
      ...(p.get("ano") ? { ano: Number(p.get("ano")) } : {}),
      ...(fins && /^[01]{4}$/.test(fins) ? { fins: fins.split("").map((c) => c === "1") as Filtros["fins"] } : {}),
      ...(p.get("at") ? { at: Number(p.get("at")) as Filtros["at"] } : {}),
      ...(p.get("pg") ? { pg: Number(p.get("pg")) } : {}),
      ...(p.get("m") && ["valor", "contratos", "medio"].includes(p.get("m")!) ? { metrica: p.get("m") as Filtros["metrica"] } : {}),
    },
    geo: { uf: p.get("uf"), mun: p.get("mun") },
  };
}
function gravarURL(f: Filtros, geo: Geo) {
  const p = new URLSearchParams();
  p.set("ano", String(f.ano));
  if (!f.fins.every(Boolean)) p.set("fin", f.fins.map((b) => (b ? 1 : 0)).join(""));
  if (f.at) p.set("at", String(f.at));
  if (f.pg >= 0) p.set("pg", String(f.pg));
  if (f.metrica !== "valor") p.set("m", f.metrica);
  if (geo.uf) p.set("uf", geo.uf);
  if (geo.mun) p.set("mun", geo.mun);
  history.replaceState(null, "", `?${p}`);
}

function partic(x: number) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: x < 0.01 ? 3 : 1, minimumFractionDigits: x < 0.01 ? 2 : 1 }).format(x * 100)}%`;
}

// ---------------------------------------------------------------- componentes locais
function Github({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

function Kpi({ rotulo, valor, detalhe, delta, i }: { rotulo: string; valor: string; detalhe?: string; delta?: number | null; i: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-white/45">{rotulo}</div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight text-white">{valor}</div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {delta != null && Number.isFinite(delta) && (
          <span className={`font-medium tabular-nums ${delta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
            {delta >= 0 ? "▲" : "▼"} {pct(delta)}
          </span>
        )}
        {detalhe && <span className="text-white/40">{detalhe}</span>}
      </div>
    </motion.div>
  );
}

function StatusFonte({ meta }: { meta: Meta }) {
  const [s, setS] = useState<{ online: boolean; ultimoMes: string | null } | null>(null);
  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok && (r.headers.get("content-type") ?? "").includes("json") ? r.json() : null))
      .then(setS)
      .catch(() => setS(null));
  }, []);
  const novo = s?.ultimoMes && meta.ultimoMes && s.ultimoMes > meta.ultimoMes;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-white/70">
        <Database size={12} /> Dados até <b className="font-semibold text-white">{mesAno(meta.ultimoMes)}</b> · sincronizado em {dataHora(meta.geradoEm)}
      </span>
      {s && (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${s.online ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : "border-amber-400/25 bg-amber-400/10 text-amber-200"}`}
          title="Verificação ao vivo da API do Banco Central"
        >
          <Radio size={12} className={s.online ? "animate-pulse" : ""} />
          {s.online ? (novo ? `BCB já tem dados de ${mesAno(s.ultimoMes)} — sincronização em breve` : "API do BCB no ar") : "API do BCB instável agora"}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- App
export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [serieAnual, setSerieAnual] = useState<Tabela | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const inicial = useMemo(lerURL, []);
  const [f, setF] = useState<Filtros>({ ano: 0, fins: [true, true, true, true], at: 0, pg: -1, metrica: "valor", ...inicial.f });
  const [geo, setGeo] = useState<Geo>(inicial.geo);
  const [nivelMun, setNivelMun] = useState(false);
  const [dados, setDados] = useState<DadosAno | null>(null);
  const [anterior, setAnterior] = useState<Tabela | null>(null);
  const base = useGeo();

  useEffect(() => {
    Promise.all([carregar<Meta>("meta.json"), carregar<Tabela>("serie_anual.json")])
      .then(([m, s]) => {
        setMeta(m);
        setSerieAnual(s);
        setF((x) => (m.anos.includes(x.ano) ? x : { ...x, ano: m.anos[m.anos.length - 1] }));
      })
      .catch((e) => setErro(String(e)));
  }, []);

  useEffect(() => {
    if (!meta || !f.ano) return;
    setDados(null);
    carregarAno(f.ano).then(setDados).catch((e) => setErro(String(e)));
    if (meta.anos.includes(f.ano - 1)) carregar<Tabela>(`uf_${f.ano - 1}.json`).then(setAnterior).catch(() => setAnterior(null));
    else setAnterior(null);
  }, [meta, f.ano]);

  useEffect(() => {
    if (f.ano) gravarURL(f, geo);
  }, [f, geo]);

  // ---------- agregações ----------
  const vUF = useMemo(() => (dados ? porUF(dados.uf, f) : new Map<string, QV>()), [dados, f]);
  const vMunTodos = useMemo(() => (dados ? porMun(dados.mun, f, null) : null), [dados, f]);
  const meses = meta?.mesesPorAno[String(f.ano)];

  const kpi = useMemo(() => {
    if (!dados || !meta) return null;
    let atual: QV;
    let area = 0;
    if (geo.mun) {
      const x = vMunTodos?.get(geo.mun);
      atual = { q: x?.q ?? 0, v: x?.v ?? 0 };
      area = (x?.aC ?? 0) + (x?.aI ?? 0);
    } else {
      atual = geo.uf ? vUF.get(geo.uf) ?? { q: 0, v: 0 } : total(vUF);
      if (vMunTodos) for (const [id, x] of vMunTodos) if (!geo.uf || id.startsWith(geo.uf)) area += x.aC + x.aI;
    }
    // comparação com o mesmo período (meses com dados) do ano anterior
    let prev: QV | null = null;
    if (anterior && !geo.mun) {
      const iMes = anterior.h.indexOf("mes");
      const ms = new Set(meses ?? []);
      const recorte = { ...anterior, r: anterior.r.filter((r) => ms.has(r[iMes] as number)) };
      const m = porUF(recorte, f);
      prev = geo.uf ? m.get(geo.uf) ?? { q: 0, v: 0 } : total(m);
    }
    const br = total(vUF);
    return { atual, prev, area, br };
  }, [dados, meta, geo, vUF, vMunTodos, anterior, f, meses]);

  const ranking = useMemo(() => {
    if (!dados || !meta) return [];
    if (!geo.uf && !nivelMun) {
      return [...vUF.entries()].map(([uf, x]) => ({ k: uf, nome: meta.ufs[uf]?.nome ?? uf, v: valorMetrica(x, f.metrica), extra: meta.ufs[uf]?.sigla }));
    }
    if (!vMunTodos) return [];
    const out: { k: string; nome: string; v: number; extra?: string }[] = [];
    for (const [id, x] of vMunTodos) {
      if (geo.uf && !id.startsWith(geo.uf)) continue;
      if (f.metrica === "medio" && x.q < 5) continue; // evita médias de 1–4 contratos no topo
      out.push({ k: id, nome: base?.nomeMun.get(id) ?? id, v: valorMetrica(x, f.metrica), extra: geo.uf ? undefined : meta.ufs[id.slice(0, 2)]?.sigla });
    }
    return out;
  }, [dados, meta, geo.uf, nivelMun, vUF, vMunTodos, f.metrica, base]);
  const top = useMemo(() => [...ranking].sort((a, b) => b.v - a.v).slice(0, 12), [ranking]);

  const contextoUF = geo.uf; // gráficos de BR/UF usam a UF mesmo com município selecionado
  const serieM = useMemo(() => (dados ? serieMensal(mensal(dados.uf, f, contextoUF), meses) : []), [dados, f, contextoUF, meses]);
  const hist = useMemo(() => (serieAnual ? historico(serieAnual, f, contextoUF).map((h) => ({ rotulo: String(h.ano), fins: h.fins })) : []), [serieAnual, f, contextoUF]);
  const programas = useMemo(() => {
    if (!dados || !meta) return [];
    const m = geo.mun ? porDimensao(dados.mun, f, "pg", null, geo.mun) : porDimensao(dados.uf, f, "pg", contextoUF);
    return meta.programas.map((n, i) => ({ k: String(i), nome: n, v: valorMetrica(m.get(i), f.metrica) })).sort((a, b) => b.v - a.v);
  }, [dados, meta, f, geo.mun, contextoUF]);
  const fontes = useMemo(() => {
    if (!dados || !meta) return [];
    const m = porDimensao(dados.uf, f, "fg", contextoUF);
    return meta.fontes.map((n, i) => ({ k: String(i), nome: n, v: valorMetrica(m.get(i), f.metrica) })).sort((a, b) => b.v - a.v);
  }, [dados, meta, f, contextoUF]);
  const prods = useMemo(() => (dados ? produtos(dados.prod, f, contextoUF, 12) : []), [dados, f, contextoUF]);
  const ifs = useMemo(() => (dados ? instituicoes(dados.ifs, f, contextoUF, 10) : null), [dados, f, contextoUF]);
  const gen = useMemo(() => (dados ? genero(dados.gen, f, contextoUF) : null), [dados, f, contextoUF]);

  const nomeGeo = geo.mun ? base?.nomeMun.get(geo.mun) ?? geo.mun : geo.uf ? meta?.ufs[geo.uf]?.nome : "Brasil";
  const nomeContexto = contextoUF ? meta?.ufs[contextoUF]?.nome : "Brasil";
  const fmt = (v: number) => fmtMetrica(v, f.metrica);
  const periodo = meses && meses.length < 12 ? `${MESES[0]}–${MESES[Math.max(...meses) - 1]}/${f.ano}` : String(f.ano);

  if (erro)
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center text-white/70">
        <div>
          <TriangleAlert className="mx-auto mb-3 text-amber-300" />
          <p>Não foi possível carregar os dados.</p>
          <p className="mt-1 text-xs text-white/40">{erro}</p>
          <p className="mt-3 text-xs text-white/40">Rode o ETL (<code>npm run etl</code>) para gerar a pasta <code>public/data</code>.</p>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen px-4 pb-10 sm:px-6">
      {/* topo */}
      <header className="mx-auto flex max-w-[1400px] flex-col gap-4 py-6 md:flex-row md:items-end md:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400/25 to-lime-300/10 ring-1 ring-emerald-300/25">
            <Sprout className="text-emerald-300" size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">Painel do Crédito Rural</h1>
            <p className="text-sm text-white/50">Contratações de crédito rural no Brasil por estado e município · SICOR / Banco Central</p>
          </div>
        </div>
        {meta && <StatusFonte meta={meta} />}
      </header>

      {meta?.amostra && (
        <div className="mx-auto mb-3 flex max-w-[1400px] items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.07] px-4 py-2.5 text-xs text-amber-100/85">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span>
            <b>Modo amostra:</b> estes dados são respostas reais do BCB gravadas para teste. Estados e Brasil têm 2022–2023 completos; municípios e produtos têm só jan/2023. Rode o ETL (GitHub Actions ou{" "}
            <code>npm run etl</code>) para carregar a série completa desde 2013.
          </span>
        </div>
      )}

      {meta && <BarraFiltros meta={meta} f={f} setF={setF} geo={geo} setGeo={setGeo} nomeMun={base?.nomeMun ?? new Map()} />}

      <main className="mx-auto mt-5 max-w-[1400px] space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {kpi ? (
            <>
              <Kpi i={0} rotulo={`Valor contratado · ${periodo}`} valor={brl(kpi.atual.v)} delta={kpi.prev && kpi.prev.v ? kpi.atual.v / kpi.prev.v - 1 : null} detalhe={kpi.prev ? "vs. ano anterior" : nomeGeo} />
              <Kpi i={1} rotulo="Contratos" valor={num(kpi.atual.q)} delta={kpi.prev && kpi.prev.q ? kpi.atual.q / kpi.prev.q - 1 : null} detalhe={kpi.prev ? "vs. ano anterior" : undefined} />
              <Kpi i={2} rotulo="Valor médio por contrato" valor={kpi.atual.q ? brl(kpi.atual.v / kpi.atual.q) : "—"} />
              <Kpi i={3} rotulo="Área financiada" valor={kpi.area ? ha(kpi.area) : "—"} detalhe={f.fins[0] || f.fins[1] ? "custeio + investimento" : "só custeio e investimento"} />
              <Kpi i={4} rotulo="Participação no Brasil" valor={geo.uf || geo.mun ? partic(kpi.br.v ? kpi.atual.v / kpi.br.v : 0) : "100%"} detalhe="do valor contratado" />
            </>
          ) : (
            Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
          )}
        </div>

        {/* mapa + ranking */}
        <div className="grid gap-5 lg:grid-cols-3">
          <Card
            className="lg:col-span-2"
            titulo={`${NOME_METRICA[f.metrica]} · ${nomeGeo}`}
            sub={geo.uf ? "Clique num município para a consulta ao vivo no BCB" : "Clique num estado para ver seus municípios"}
            acao={
              !geo.uf ? (
                <Segmentado
                  rotulo="Nível do mapa"
                  valor={nivelMun ? "m" : "e"}
                  onChange={(v) => setNivelMun(v === "m")}
                  opcoes={[
                    { v: "e", t: "Estados" },
                    { v: "m", t: "Municípios" },
                  ]}
                />
              ) : undefined
            }
          >
            <div className="h-[460px] sm:h-[540px]">
              {base && dados ? (
                <MapaBrasil
                  geo={base}
                  sel={geo}
                  nivelMun={nivelMun}
                  valoresUF={vUF}
                  valoresMun={vMunTodos}
                  metrica={f.metrica}
                  nomesUF={meta!.ufs}
                  onUF={(uf) => setGeo({ uf, mun: null })}
                  onMun={(mun, uf) => setGeo({ uf, mun })}
                />
              ) : (
                <Skeleton className="h-full" />
              )}
            </div>
          </Card>
          <Card
            titulo={!geo.uf && !nivelMun ? "Ranking dos estados" : `Ranking dos municípios${geo.uf ? ` · ${meta?.ufs[geo.uf]?.sigla}` : ""}`}
            sub={`${NOME_METRICA[f.metrica]} · ${periodo}${f.metrica === "medio" && (geo.uf || nivelMun) ? " · mín. 5 contratos" : ""}`}
            nota={ranking.length > 12 ? `Mostrando 12 de ${ranking.length.toLocaleString("pt-BR")}.` : undefined}
          >
            {dados ? (
              <BarrasH
                itens={top}
                fmt={fmt}
                ativo={geo.mun ?? geo.uf}
                onClick={(k) => (k.length === 2 ? setGeo({ uf: k, mun: null }) : setGeo({ uf: k.slice(0, 2), mun: k }))}
              />
            ) : (
              <Skeleton className="h-96" />
            )}
          </Card>
        </div>

        {/* município ao vivo */}
        {geo.mun && dados && <MunicipioAoVivo key={geo.mun} ibge={geo.mun} nome={nomeGeo ?? ""} uf={meta!.ufs[geo.mun.slice(0, 2)]?.sigla ?? ""} filtros={f} />}

        {/* séries */}
        <div className="grid gap-5 lg:grid-cols-2">
          <Card titulo={`Evolução mensal · ${nomeContexto}`} sub={`${NOME_METRICA[f.metrica]} por mês de emissão · ${f.ano}`} acao={<LegendaFin fins={f.fins} />}>
            {dados ? <BarrasEmpilhadas serie={serieM} fins={f.fins} metrica={f.metrica} /> : <Skeleton className="h-60" />}
          </Card>
          <Card
            titulo={`Série histórica · ${nomeContexto}`}
            sub={`${NOME_METRICA[f.metrica]} por ano de emissão`}
            acao={<LegendaFin fins={f.fins} />}
            nota={meta?.ultimoMes && Number(meta.ultimoMes.slice(5)) < 12 ? `${meta.ultimoMes.slice(0, 4)} está incompleto (dados até ${mesAno(meta.ultimoMes)}).` : undefined}
          >
            {serieAnual ? <BarrasEmpilhadas serie={hist} fins={f.fins} metrica={f.metrica} /> : <Skeleton className="h-60" />}
          </Card>
        </div>

        {/* quebras */}
        <div className="grid gap-5 lg:grid-cols-3">
          <Card titulo="Programas" sub={`${NOME_METRICA[f.metrica]} · ${nomeGeo}`} nota={f.pg >= 0 ? "O filtro de programa não se aplica a este gráfico." : undefined}>
            {dados ? <BarrasH itens={programas.filter((p) => p.v > 0)} fmt={fmt} cor="#45b675" ativo={f.pg >= 0 ? String(f.pg) : null} onClick={(k) => setF({ ...f, pg: f.pg === Number(k) ? -1 : Number(k) })} /> : <Skeleton className="h-48" />}
          </Card>
          <Card titulo="Fontes de recursos" sub={`${NOME_METRICA[f.metrica]} · ${nomeContexto}`} nota={geo.mun ? "A fonte de recursos é publicada por UF; o gráfico mostra o estado do município." : undefined}>
            {dados ? <BarrasH itens={fontes.filter((p) => p.v > 0)} fmt={fmt} cor="#45b675" /> : <Skeleton className="h-48" />}
          </Card>
          <Card titulo="Quem toma o crédito" sub={`Sexo do beneficiário · ${nomeContexto}`} nota="Pessoas jurídicas e registros sem sexo informado aparecem separados.">
            {gen && meta ? (
              <BarrasH
                itens={meta.sexos.map((n, i) => ({ k: String(i), nome: n, v: valorMetrica(gen.get(i), f.metrica) })).filter((x) => x.v > 0)}
                fmt={fmt}
                cor="#45b675"
              />
            ) : (
              <Skeleton className="h-32" />
            )}
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card titulo="O que é financiado" sub={`Principais produtos · ${nomeContexto} · ${periodo}`} nota="Produtos são publicados para custeio, investimento e comercialização. A cor indica a finalidade.">
            {dados ? (
              <BarrasH
                itens={prods.map((p) => ({ k: `${p.fin}${p.nome}`, nome: p.nome.charAt(0) + p.nome.slice(1).toLowerCase(), v: f.metrica === "contratos" ? p.q : p.v, extra: FIN_NOMES[p.fin] }))}
                fmt={(v) => (f.metrica === "contratos" ? num(v) : brl(v))}
                cor="#3987e5"
              />
            ) : (
              <Skeleton className="h-72" />
            )}
          </Card>
          <Card titulo="Instituições financeiras" sub={`Maiores concedentes · ${nomeContexto} · ${periodo}`}>
            {ifs ? (
              <>
                <BarrasH itens={ifs.top.map((x, i) => ({ k: String(i) + x.nome, nome: x.nome, v: f.metrica === "contratos" ? x.q : f.metrica === "medio" ? (x.q ? x.v / x.q : 0) : x.v, extra: x.segmento }))} fmt={fmt} cor="#45b675" />
                {ifs.segmentos.length > 0 && (
                  <div className="mt-4 border-t border-white/[0.06] pt-3">
                    <div className="mb-2 text-[11px] uppercase tracking-wide text-white/45">Por segmento</div>
                    <div className="flex h-2.5 overflow-hidden rounded-full">
                      {ifs.segmentos.map((s, i) => {
                        const tot = ifs.segmentos.reduce((a, b) => a + (f.metrica === "contratos" ? b.q : b.v), 0) || 1;
                        return <span key={s.nome} title={`${s.nome}: ${pct((f.metrica === "contratos" ? s.q : s.v) / tot).replace("+", "")}`} style={{ width: `${((f.metrica === "contratos" ? s.q : s.v) / tot) * 100}%`, background: COR_FIN[i % 4], opacity: i < 4 ? 1 : 0.5 }} className="border-r-2 border-[#121816] last:border-0" />;
                      })}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/60">
                      {ifs.segmentos.slice(0, 6).map((s, i) => (
                        <span key={s.nome} className="flex items-center gap-1.5">
                          <i className="h-2 w-2 rounded-sm" style={{ background: COR_FIN[i % 4], opacity: i < 4 ? 1 : 0.5 }} />
                          {s.nome}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <Skeleton className="h-72" />
            )}
          </Card>
        </div>

        {/* metodologia */}
        <Card titulo="Sobre os dados">
          <div className="grid gap-4 text-[13px] leading-relaxed text-white/60 md:grid-cols-3">
            <p>
              <b className="text-white/85">Fonte.</b> Matriz de Dados do Crédito Rural (MDCR), extraída do SICOR e publicada pelo Banco Central do Brasil em API OData aberta (licença ODbL). Os valores são nominais, em reais, pela data de emissão do contrato.
            </p>
            <p>
              <b className="text-white/85">Atualização.</b> Uma rotina diária consulta a API, reprocessa os meses mais recentes (que recebem registros tardios) e publica os agregados. No nível municipal, os detalhes mensais e por produto são consultados ao vivo no BCB quando você escolhe um município.
            </p>
            <p>
              <b className="text-white/85">Limites.</b> Programas e fontes foram agrupados para leitura. Municípios criados após 2020 podem aparecer no ranking sem polígono no mapa. Comparações entre anos não descontam a inflação. Os totais por UF conferem com a soma municipal publicada pelo BCB.
            </p>
          </div>
        </Card>
      </main>

      <footer className="mx-auto mt-8 flex max-w-[1400px] flex-col items-center justify-between gap-3 border-t border-white/[0.06] pt-5 text-xs text-white/40 sm:flex-row">
        <span>
          Feito por <b className="text-white/70">Lúcio Benfica</b> · dados abertos do{" "}
          <a className="underline decoration-white/20 hover:text-white" href={meta?.fonteUrl} target="_blank" rel="noreferrer">
            Banco Central do Brasil <ExternalLink size={10} className="inline" />
          </a>
        </span>
        <a href="https://github.com/Benfluc" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-white">
          <Github size={14} /> github.com/Benfluc
        </a>
      </footer>
    </div>
  );
}
