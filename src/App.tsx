import { useEffect, useMemo, useRef, useState } from "react";
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
import MapaBrasil, { type Pintura } from "./components/MapaBrasil";
import CreditoProducao, { fmtQL, LegendaQL } from "./components/CreditoProducao";
import Inadimplencia from "./components/Inadimplencia";
import FichaMunicipio from "./components/FichaMunicipio";
import { BarChart3, Map as MapaIcone, ListOrdered, LayoutDashboard, ShieldAlert, SlidersHorizontal, X as Fechar } from "lucide-react";
import { anoPam as escolherAnoPam, carregarPam, carregarPamMeta, corQL, creditoAgricolaMun, culturasMun, pares, paresUF, producaoMun, type PamAno, type PamMeta } from "./lib/pam";
import { COR_ZERO } from "./lib/colors";
import MunicipioAoVivo from "./components/MunicipioAoVivo";
import { BarraFiltros } from "./components/Filtros";
import { BarrasEmpilhadas, FIN_NOMES, LegendaFin, serieMensal } from "./components/Graficos";
import { BarrasH, Card, Segmentado, Skeleton, Vazio } from "./components/ui";

// ---------------------------------------------------------------- URL <-> estado
type Aba = "credito" | "risco";
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
function gravarURL(f: Filtros, geo: Geo, aba: Aba) {
  const p = new URLSearchParams();
  p.set("ano", String(f.ano));
  if (!f.fins.every(Boolean)) p.set("fin", f.fins.map((b) => (b ? 1 : 0)).join(""));
  if (f.at) p.set("at", String(f.at));
  if (f.pg >= 0) p.set("pg", String(f.pg));
  if (f.metrica !== "valor") p.set("m", f.metrica);
  if (geo.uf) p.set("uf", geo.uf);
  if (geo.mun) p.set("mun", geo.mun);
  if (aba !== "credito") p.set("aba", aba);
  history.replaceState(null, "", `?${p}`);
}

function partic(x: number) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: x < 0.01 ? 3 : 1, minimumFractionDigits: x < 0.01 ? 2 : 1 }).format(x * 100)}%`;
}

function useMobile() {
  const q = "(max-width: 767px)";
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return m;
}
type SubAba = "resumo" | "mapa" | "ranking" | "analises";

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
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card px-4 py-3 md:p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">{rotulo}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-stone-900 md:mt-1.5 md:text-2xl">{valor}</div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {delta != null && Number.isFinite(delta) && (
          <span className={`font-medium tabular-nums ${delta >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
            {delta >= 0 ? "▲" : "▼"} {pct(delta)}
          </span>
        )}
        {detalhe && <span className="text-stone-500">{detalhe}</span>}
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
      <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-100 px-2.5 py-1 text-stone-700">
        <Database size={12} /> Dados até <b className="font-semibold text-stone-900">{mesAno(meta.ultimoMes)}</b>
        <span className="hidden sm:inline">· sincronizado em {dataHora(meta.geradoEm)}</span>
      </span>
      {s && (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${s.online ? "border-emerald-600/25 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}
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
  const [aba, setAba] = useState<Aba>(() => (new URLSearchParams(location.search).get("aba") === "risco" ? "risco" : "credito"));
  const mobile = useMobile();
  const [subAba, setSubAba] = useState<SubAba>("resumo");
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const rolarParaFicha = useRef(false);
  const vis = (s_: SubAba) => !mobile || subAba === s_;
  const selecionarMun = (id: string) => {
    setGeo({ uf: id.slice(0, 2), mun: id });
    if (mobile) {
      setSubAba("resumo");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else rolarParaFicha.current = true;
  };
  const [dados, setDados] = useState<DadosAno | null>(null);
  const [anterior, setAnterior] = useState<Tabela | null>(null);
  const base = useGeo();
  const [pamMeta, setPamMeta] = useState<PamMeta | null>(null);
  const [pam, setPam] = useState<PamAno | null>(null);
  const [defasagem, setDefasagem] = useState<0 | 1>(0);
  const [modoMapa, setModoMapa] = useState<"credito" | "ql">("credito");

  useEffect(() => {
    carregarPamMeta().then(setPamMeta);
  }, []);
  const anoP = useMemo(() => (pamMeta && f.ano ? escolherAnoPam(pamMeta, f.ano, defasagem) : { ano: null, exato: false }), [pamMeta, f.ano, defasagem]);
  useEffect(() => {
    setPam(null);
    if (anoP.ano) carregarPam(anoP.ano).then(setPam).catch(() => setPam(null));
  }, [anoP.ano]);

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
    if (f.ano) gravarURL(f, geo, aba);
  }, [f, geo, aba]);

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
      // área por UF vem da tabela de produtos (completa); a municipal pode ser parcial
      const pr = dados.prod;
      const [iUf, iFin, iAt, iPg, iA] = ["uf", "fin", "at", "pg", "a"].map((c) => pr.h.indexOf(c));
      for (const r of pr.r) {
        const fin = r[iFin] as number;
        if (fin > 1 || !f.fins[fin]) continue;
        if (geo.uf && r[iUf] !== geo.uf) continue;
        if (f.at && r[iAt] !== f.at) continue;
        if (f.pg >= 0 && r[iPg] !== f.pg) continue;
        area += r[iA] as number;
      }
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

  // ---------- crédito × produção (PAM) ----------
  const cp = useMemo(() => {
    if (!dados || !pam) return null;
    const cred = creditoAgricolaMun(dados.mun, f, null);
    const prodM = producaoMun(pam, null);
    const br = pares(cred, prodM);
    // estados: crédito da tabela por UF (completa mesmo quando o municipal é parcial)
    const credUF = new Map<string, number>();
    for (const [uf, x] of porUF(dados.uf, { ...f, at: 1 })) credUF.set(uf, x.v);
    const prodUF = new Map<string, { v: number }>();
    for (const [id, x] of paresUF(br.pares).pares) prodUF.set(id, { v: x.p });
    const ufs = pares(credUF, prodUF);
    const escopo = geo.uf
      ? pares(
          new Map([...cred].filter(([id]) => id.startsWith(geo.uf!))),
          new Map([...prodM].filter(([id]) => id.startsWith(geo.uf!))),
        )
      : br;
    return { br, ufs, escopo };
  }, [dados, pam, f, geo.uf]);

  const pintura = useMemo<Pintura | null>(() => {
    if (modoMapa !== "ql" || !cp) return null;
    const munRef = geo.uf ? cp.escopo.pares : cp.br.pares;
    const par = (id: string) => (id.length === 2 ? cp.ufs.pares.get(id) : munRef.get(id));
    return {
      uf: (uf) => corQL(cp.ufs.pares.get(uf), COR_ZERO),
      mun: (id) => corQL(munRef.get(id), COR_ZERO),
      dica: (id) => {
        const x = par(id);
        return x ? { valor: `QL ${fmtQL(x.ql)}`, rotulo: `crédito ${brl(x.c)} · produção ${brl(x.p)}` } : { valor: "—", rotulo: "sem crédito e sem produção" };
      },
      legenda: <LegendaQL ref_={geo.uf ? meta?.ufs[geo.uf]?.sigla ?? "UF" : "Brasil"} />,
    };
  }, [modoMapa, cp, geo.uf, meta]);

  // ---------- cobertura municipal (microdados só publicam município do crédito público) ----------
  const cobMun = meta?.munCobertura?.[String(f.ano)];
  const munParcial = !!cobMun && cobMun.v < 0.999;
  const pct0 = (x: number) => `${Math.round(x * 100)}%`;
  const avisoMun = munParcial
    ? `Municípios: só operações com recursos públicos ou Proagro (${pct0(cobMun!.q)} dos contratos e ${pct0(cobMun!.v)} do valor de ${f.ano}).`
    : undefined;
  const mostrandoMun = !!(geo.uf || nivelMun || geo.mun);

  // ---------- ficha do município ----------
  const ficha = useMemo(() => {
    if (!geo.mun || !dados || !meta || !vMunTodos) return null;
    const id = geo.mun;
    const uf = id.slice(0, 2);
    const val = (x: QV) => valorMetrica(x, f.metrica);
    const lista = [...vMunTodos].filter(([, x]) => f.metrica !== "medio" || x.q >= 5).sort((a, b) => val(b[1]) - val(a[1]));
    const iBR = lista.findIndex(([k]) => k === id);
    const lUF = lista.filter(([k]) => k.startsWith(uf));
    const iUF = lUF.findIndex(([k]) => k === id);
    const ag = porMun(dados.mun, { ...f, at: 1 }, uf).get(id);
    const pe = porMun(dados.mun, { ...f, at: 2 }, uf).get(id);
    return {
      x: vMunTodos.get(id),
      ufTot: vUF.get(uf),
      posUF: iUF >= 0 ? { pos: iUF + 1, n: lUF.length } : null,
      posBR: iBR >= 0 ? { pos: iBR + 1, n: lista.length } : null,
      atividades: [
        { k: "1", nome: "Agrícola", v: ag ? val(ag) : 0 },
        { k: "2", nome: "Pecuária", v: pe ? val(pe) : 0 },
      ],
    };
  }, [geo.mun, dados, meta, vMunTodos, vUF, f]);

  useEffect(() => {
    if (rolarParaFicha.current && geo.mun) {
      rolarParaFicha.current = false;
      setTimeout(() => document.getElementById("ficha-municipio")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    }
  }, [geo.mun]);

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
  const periodoAnterior = meses && meses.length < 12 ? `${MESES[0]}–${MESES[Math.max(...meses) - 1]}/${f.ano - 1}` : String(f.ano - 1);

  if (erro)
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center text-stone-700">
        <div>
          <TriangleAlert className="mx-auto mb-3 text-amber-600" />
          <p>Não foi possível carregar os dados.</p>
          <p className="mt-1 text-xs text-stone-500">{erro}</p>
          <p className="mt-3 text-xs text-stone-500">Rode o ETL (<code>npm run etl</code>) para gerar a pasta <code>public/data</code>.</p>
        </div>
      </div>
    );

  return (
    <div className={`min-h-screen px-4 sm:px-6 ${mobile ? "pb-36" : "pb-10"}`}>
      {/* topo */}
      <header className="mx-auto flex max-w-[1400px] flex-col gap-3 py-4 md:flex-row md:items-end md:justify-between md:gap-4 md:py-6">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-100 to-lime-50 ring-1 ring-emerald-600/20">
            <Sprout className="text-emerald-700" size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-stone-900 sm:text-2xl">Painel do Crédito Rural</h1>
            <p className="hidden text-sm text-stone-500 sm:block">Contratações de crédito rural no Brasil por estado e município · SICOR / Banco Central</p>
          </div>
        </div>
        {meta && <StatusFonte meta={meta} />}
      </header>

      {meta?.amostra && (
        <div className="mx-auto mb-3 flex max-w-[1400px] items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span>
            <b>Modo amostra:</b> estes dados são respostas reais do BCB gravadas para teste. Estados e Brasil têm 2022–2023 completos; municípios e produtos têm só jan/2023. Rode o ETL (GitHub Actions ou{" "}
            <code>npm run etl</code>) para carregar a série completa desde 2013.
          </span>
        </div>
      )}

      {/* abas */}
      <nav aria-label="Seções do painel" className="mx-auto mb-4 hidden max-w-[1400px] gap-1 border-b border-stone-200 md:flex">
        {(
          [
            ["credito", "Contratações"],
            ["risco", "Risco e inadimplência"],
          ] as [Aba, string][]
        ).map(([k, t]) => (
          <button
            key={k}
            onClick={() => setAba(k)}
            aria-current={aba === k ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${aba === k ? "border-emerald-600 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-700"}`}
          >
            {t}
          </button>
        ))}
      </nav>

      {aba === "risco" && meta && (
        <main className="mx-auto max-w-[1400px]">
          <Inadimplencia meta={meta} base={base} uf={geo.uf} setUf={(uf) => setGeo({ uf, mun: null })} mobile={mobile} />
        </main>
      )}

      {aba === "credito" && meta && !mobile && <BarraFiltros meta={meta} f={f} setF={setF} geo={geo} setGeo={setGeo} nomeMun={base?.nomeMun ?? new Map()} />}

      {/* celular: contexto do recorte */}
      {aba === "credito" && meta && mobile && (
        <button
          onClick={() => setFiltrosAbertos(true)}
          className="sticky top-0 z-20 -mx-4 mb-3 flex w-[calc(100%+2rem)] items-center gap-2 border-b border-stone-200 bg-[#f7f7f4]/95 px-4 py-2.5 text-left text-sm backdrop-blur"
        >
          <SlidersHorizontal size={15} className="shrink-0 text-emerald-700" />
          <span className="truncate text-stone-700">
            <b className="text-stone-900">{f.ano}</b> · {nomeGeo} · {f.at === 1 ? "Agrícola" : f.at === 2 ? "Pecuária" : "Todas as atividades"}
            {f.pg >= 0 ? ` · ${meta.programas[f.pg]}` : ""}
          </span>
          <span className="ml-auto shrink-0 text-xs font-medium text-emerald-700">Filtros</span>
        </button>
      )}

      {aba === "credito" && (
      <main className="mx-auto max-w-[1400px] space-y-5 md:mt-5">
        {/* KPIs */}
        {vis("resumo") && !(mobile && geo.mun) && (
        <div className={mobile ? "grid grid-cols-1 gap-2.5" : "grid grid-cols-2 gap-3 lg:grid-cols-5"}>
          {kpi ? (
            <>
              <Kpi i={0} rotulo={`Valor contratado · ${periodo}`} valor={brl(kpi.atual.v)} delta={kpi.prev && kpi.prev.v ? kpi.atual.v / kpi.prev.v - 1 : null} detalhe={kpi.prev ? `vs. ${periodoAnterior}` : geo.mun && munParcial ? "só crédito público/Proagro" : nomeGeo} />
              <Kpi i={1} rotulo="Contratos" valor={num(kpi.atual.q)} delta={kpi.prev && kpi.prev.q ? kpi.atual.q / kpi.prev.q - 1 : null} detalhe={kpi.prev ? `vs. ${periodoAnterior}` : undefined} />
              <Kpi i={2} rotulo="Valor médio por contrato" valor={kpi.atual.q ? brl(kpi.atual.v / kpi.atual.q) : "—"} />
              <Kpi i={3} rotulo="Área financiada" valor={kpi.area ? ha(kpi.area) : "—"} detalhe={f.fins[0] || f.fins[1] ? "custeio + investimento" : "só custeio e investimento"} />
              <Kpi i={4} rotulo="Participação no Brasil" valor={geo.uf || geo.mun ? partic(kpi.br.v ? kpi.atual.v / kpi.br.v : 0) : "100%"} detalhe="do valor contratado" />
            </>
          ) : (
            Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
          )}
        </div>
        )}

        {mobile && vis("resumo") && !geo.mun && (
          <div className="card p-4 text-sm text-stone-600">
            Toque em <b>Mapa</b> ou <b>Ranking</b> para escolher um estado ou município, ou use a busca em <b>Filtros</b>. A ficha do município aparece aqui.
          </div>
        )}

        {/* mapa + ranking */}
        <div className="grid gap-5 lg:grid-cols-3">
          {vis("mapa") && (
          <Card
            className="lg:col-span-2"
            titulo={modoMapa === "ql" ? `Crédito agrícola × produção · ${nomeGeo}` : `${NOME_METRICA[f.metrica]} · ${nomeGeo}`}
            sub={geo.uf ? "Clique num município para abrir a ficha · para voltar, afaste o zoom, clique fora do mapa ou use ← Brasil" : "Clique num estado para ver seus municípios"}
            nota={mostrandoMun ? avisoMun : undefined}
            acao={
              <div className="flex flex-wrap justify-end gap-2">
                {pamMeta && pamMeta.anos.length > 0 && (
                  <Segmentado
                    rotulo="O que o mapa mostra"
                    valor={modoMapa}
                    onChange={setModoMapa}
                    opcoes={[
                      { v: "credito", t: "Crédito" },
                      { v: "ql", t: "Crédito × Produção" },
                    ]}
                  />
                )}
                {!geo.uf && (
                  <Segmentado
                    rotulo="Nível do mapa"
                    valor={nivelMun ? "m" : "e"}
                    onChange={(v) => setNivelMun(v === "m")}
                    opcoes={[
                      { v: "e", t: "Estados" },
                      { v: "m", t: "Municípios" },
                    ]}
                  />
                )}
              </div>
            }
          >
            <div className={mobile ? "h-[62vh]" : "h-[460px] sm:h-[540px]"}>
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
                  onMun={(mun, uf) => (mun && mobile ? selecionarMun(mun) : setGeo({ uf, mun }))}
                  pintura={pintura}
                />
              ) : (
                <Skeleton className="h-full" />
              )}
            </div>
          </Card>
          )}
          {vis("ranking") && (
          <Card
            titulo={!geo.uf && !nivelMun ? "Ranking dos estados" : `Ranking dos municípios${geo.uf ? ` · ${meta?.ufs[geo.uf]?.sigla}` : ""}`}
            sub={`${NOME_METRICA[f.metrica]} · ${periodo}${f.metrica === "medio" && (geo.uf || nivelMun) ? " · mín. 5 contratos" : ""}`}
            nota={
              [ranking.length > 12 ? `Mostrando 12 de ${ranking.length.toLocaleString("pt-BR")}.` : "", (geo.uf || nivelMun) && avisoMun ? avisoMun : ""].filter(Boolean).join(" ") || undefined
            }
          >
            {dados ? (
              <BarrasH
                itens={top}
                fmt={fmt}
                ativo={geo.mun ?? geo.uf}
                onClick={(k) => (k.length === 2 ? setGeo({ uf: k, mun: null }) : selecionarMun(k))}
              />
            ) : (
              <Skeleton className="h-96" />
            )}
          </Card>
          )}
        </div>

        {/* ficha do município */}
        {vis("resumo") && geo.mun && dados && ficha && (
          <div id="ficha-municipio" className="scroll-mt-28 space-y-5">
            <FichaMunicipio
              nome={nomeGeo ?? ""}
              ufSigla={meta!.ufs[geo.mun.slice(0, 2)]?.sigla ?? ""}
              ufNome={meta!.ufs[geo.mun.slice(0, 2)]?.nome ?? ""}
              ano={f.ano}
              periodo={periodo}
              metrica={f.metrica}
              x={ficha.x}
              ufTot={ficha.ufTot}
              posUF={ficha.posUF}
              posBR={ficha.posBR}
              programas={programas}
              atividades={ficha.atividades}
              ql={cp?.escopo.pares.get(geo.mun)}
              pam={pam && anoP.ano ? { ano: anoP.ano, culturas: culturasMun(pam, geo.mun) } : null}
              aviso={avisoMun}
              onFechar={() => setGeo({ uf: geo.uf, mun: null })}
            />
            <MunicipioAoVivo key={geo.mun} ibge={geo.mun} nome={nomeGeo ?? ""} uf={meta!.ufs[geo.mun.slice(0, 2)]?.sigla ?? ""} filtros={f} pam={null} />
          </div>
        )}

        {vis("analises") && (
        <>
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

        {/* crédito × produção */}
        {meta && pamMeta && pamMeta.anos.length > 0 && (
          <CreditoProducao
            meta={meta}
            pamMeta={pamMeta}
            pam={pam}
            anoPam={anoP}
            defasagem={defasagem}
            setDefasagem={setDefasagem}
            escopo={cp?.escopo ?? null}
            prod={dados?.prod ?? null}
            f={f}
            geo={geo}
            nomeMun={base?.nomeMun ?? new Map()}
            onMun={selecionarMun}
            avisoMun={avisoMun}
          />
        )}

        {/* quebras */}
        <div className="grid gap-5 lg:grid-cols-3">
          <Card titulo="Programas" sub={`${NOME_METRICA[f.metrica]} · ${nomeGeo}`} nota={f.pg >= 0 ? "O filtro de programa não se aplica a este gráfico." : undefined}>
            {dados ? <BarrasH itens={programas.filter((p) => p.v > 0)} fmt={fmt} cor="#2f8f57" ativo={f.pg >= 0 ? String(f.pg) : null} onClick={(k) => setF({ ...f, pg: f.pg === Number(k) ? -1 : Number(k) })} /> : <Skeleton className="h-48" />}
          </Card>
          <Card titulo="Fontes de recursos" sub={`${NOME_METRICA[f.metrica]} · ${nomeContexto}`} nota={geo.mun ? "A fonte de recursos é publicada por UF; o gráfico mostra o estado do município." : undefined}>
            {dados ? <BarrasH itens={fontes.filter((p) => p.v > 0)} fmt={fmt} cor="#2f8f57" /> : <Skeleton className="h-48" />}
          </Card>
          <Card titulo="Quem toma o crédito" sub={`Sexo do beneficiário · ${nomeContexto}`} nota="Pessoas jurídicas e registros sem sexo informado aparecem separados.">
            {meta?.generoDisponivel === false ? (
              <Vazio>O sexo do beneficiário não é publicado nos microdados do BCB. Volta a aparecer quando a API do SICOR estiver no ar.</Vazio>
            ) : gen && meta ? (
              <BarrasH
                itens={meta.sexos.map((n, i) => ({ k: String(i), nome: n, v: valorMetrica(gen.get(i), f.metrica) })).filter((x) => x.v > 0)}
                fmt={fmt}
                cor="#2f8f57"
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
                cor="#2f8f57"
              />
            ) : (
              <Skeleton className="h-72" />
            )}
          </Card>
          <Card titulo="Instituições financeiras" sub={`Maiores concedentes · ${nomeContexto} · ${periodo}`}>
            {ifs ? (
              <>
                <BarrasH itens={ifs.top.map((x, i) => ({ k: String(i) + x.nome, nome: x.nome, v: f.metrica === "contratos" ? x.q : f.metrica === "medio" ? (x.q ? x.v / x.q : 0) : x.v, extra: x.segmento }))} fmt={fmt} cor="#2f8f57" />
                {ifs.segmentos.length > 0 && (
                  <div className="mt-4 border-t border-stone-200 pt-3">
                    <div className="mb-2 text-[11px] uppercase tracking-wide text-stone-500">Por segmento</div>
                    <div className="flex h-2.5 overflow-hidden rounded-full">
                      {ifs.segmentos.map((s, i) => {
                        const tot = ifs.segmentos.reduce((a, b) => a + (f.metrica === "contratos" ? b.q : b.v), 0) || 1;
                        return <span key={s.nome} title={`${s.nome}: ${pct((f.metrica === "contratos" ? s.q : s.v) / tot).replace("+", "")}`} style={{ width: `${((f.metrica === "contratos" ? s.q : s.v) / tot) * 100}%`, background: COR_FIN[i % 4], opacity: i < 4 ? 1 : 0.5 }} className="border-r-2 border-[#ffffff] last:border-0" />;
                      })}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-600">
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
          <div className="grid gap-4 text-[13px] leading-relaxed text-stone-600 md:grid-cols-3">
            <p>
              <b className="text-stone-800">Fonte.</b> Matriz de Dados do Crédito Rural (MDCR), extraída do SICOR e publicada pelo Banco Central do Brasil em API OData aberta (licença ODbL). Os valores são nominais, em reais, pela data de emissão do contrato.
            </p>
            <p>
              <b className="text-stone-800">Atualização.</b> Uma rotina diária consulta a API, reprocessa os meses mais recentes (que recebem registros tardios) e publica os agregados. No nível municipal, os detalhes mensais e por produto são consultados ao vivo no BCB quando você escolhe um município.
            </p>
            <p>
              <b className="text-stone-800">Limites.</b> Programas e fontes foram agrupados para leitura. Municípios criados após 2020 podem aparecer no ranking sem polígono no mapa. Comparações entre anos não descontam a inflação. Os totais por UF conferem com a soma municipal publicada pelo BCB.
            </p>
            <p className="md:col-span-3">
              <b className="text-stone-800">Crédito × produção.</b> O valor da produção vem da Produção Agrícola Municipal (PAM/IBGE, SIDRA tabela 5457, lavouras temporárias e permanentes). A comparação usa só o crédito de atividade agrícola e o quociente de localização (QL): QL acima de 1 indica que o município recebe uma fatia do crédito maior que sua fatia na produção. O QL mede proporção, não necessidade: municípios com muita lavoura de alto valor e pouco crédito podem se financiar com recursos próprios, cooperativas ou crédito fora do SNCR.
            </p>
          </div>
        </Card>
        </>
        )}
      </main>
      )}

      {mobile && meta && (
        <>
          {filtrosAbertos && aba === "credito" && (
            <div className="fixed inset-0 z-40 flex flex-col justify-end bg-stone-900/30" onClick={() => setFiltrosAbertos(false)}>
              <div className="pb-seguro max-h-[85vh] overflow-y-auto rounded-t-2xl bg-[#f7f7f4] px-4 pt-3 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Filtros">
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-300" />
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-stone-900">Filtros</h2>
                  <button onClick={() => setFiltrosAbertos(false)} aria-label="Fechar filtros" className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100">
                    <Fechar size={18} />
                  </button>
                </div>
                <BarraFiltros meta={meta} f={f} setF={setF} geo={geo} setGeo={(g) => { setGeo(g); if (g.mun) { setSubAba("resumo"); setFiltrosAbertos(false); } }} nomeMun={base?.nomeMun ?? new Map()} emPainel />
                <button onClick={() => setFiltrosAbertos(false)} className="mt-4 mb-2 w-full rounded-xl bg-emerald-700 py-3 text-sm font-semibold text-white">
                  Ver resultados
                </button>
              </div>
            </div>
          )}
          {aba === "credito" && !filtrosAbertos && (
            <button
              onClick={() => setFiltrosAbertos(true)}
              aria-label="Abrir filtros"
              className="fixed bottom-20 right-4 z-30 flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/20"
            >
              <SlidersHorizontal size={16} /> Filtros
            </button>
          )}
          <nav aria-label="Navegação" className="pb-seguro fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-stone-200 bg-white/95 backdrop-blur">
            {(
              [
                ["resumo", "Resumo", LayoutDashboard],
                ["mapa", "Mapa", MapaIcone],
                ["ranking", "Ranking", ListOrdered],
                ["analises", "Análises", BarChart3],
              ] as [SubAba, string, typeof MapaIcone][]
            ).map(([k, t, Icone]) => {
              const ativo = aba === "credito" && subAba === k;
              return (
                <button
                  key={k}
                  onClick={() => {
                    setAba("credito");
                    setSubAba(k);
                    window.scrollTo({ top: 0 });
                  }}
                  aria-current={ativo ? "page" : undefined}
                  className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${ativo ? "text-emerald-700" : "text-stone-500"}`}
                >
                  <Icone size={20} />
                  {t}
                </button>
              );
            })}
            <button
              onClick={() => {
                setAba("risco");
                window.scrollTo({ top: 0 });
              }}
              aria-current={aba === "risco" ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${aba === "risco" ? "text-emerald-700" : "text-stone-500"}`}
            >
              <ShieldAlert size={20} />
              Risco
            </button>
          </nav>
        </>
      )}

      <footer className="mx-auto mt-8 flex max-w-[1400px] flex-col items-center justify-between gap-3 border-t border-stone-200 pt-5 text-xs text-stone-500 sm:flex-row">
        <span>
          Feito por <b className="text-stone-700">Lúcio Benfica</b> · dados abertos do{" "}
          <a className="underline decoration-stone-300 hover:text-stone-900" href={meta?.fonteUrl} target="_blank" rel="noreferrer">
            Banco Central do Brasil <ExternalLink size={10} className="inline" />
          </a>{" "}
          e do{" "}
          <a className="underline decoration-stone-300 hover:text-stone-900" href="https://sidra.ibge.gov.br/tabela/5457" target="_blank" rel="noreferrer">
            IBGE (PAM) <ExternalLink size={10} className="inline" />
          </a>
        </span>
        <a href="https://github.com/Benfluc" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-stone-900">
          <Github size={14} /> github.com/Benfluc
        </a>
      </footer>
    </div>
  );
}
