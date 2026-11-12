import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import maplibregl, { type Map as MLMap, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoBase } from "../lib/geo";
import type { Geo, Metrica, QV } from "../lib/data";
import { valorMetrica } from "../lib/data";
import { COR_ZERO, RAMPA, corDe, quebrasQuantis } from "../lib/colors";
import { fmtMetrica, NOME_METRICA } from "../lib/format";
import { Minus, Plus, RotateCcw } from "lucide-react";

const BR: [number, number, number, number] = [-74.5, -34.2, -32.5, 5.6];

interface Props {
  geo: GeoBase;
  sel: Geo;
  nivelMun: boolean; // mostrar municípios (no Brasil inteiro ou dentro da UF)
  valoresUF: Map<string, QV>;
  valoresMun: Map<string, QV> | null;
  metrica: Metrica;
  nomesUF: Record<string, { sigla: string; nome: string }>;
  onUF: (uf: string | null) => void;
  onMun: (mun: string | null, uf: string) => void;
  /** Pintura alternativa (ex.: crédito × produção) — substitui cores, dica e legenda. */
  pintura?: Pintura | null;
}

export interface Pintura {
  uf: (uf: string) => string;
  mun: (id: string) => string;
  dica: (id: string) => { valor: string; rotulo: string };
  legenda: ReactNode;
}

interface Hover {
  x: number;
  y: number;
  titulo: string;
  sub: string;
  valor: string;
  rotulo?: string;
}

export default function MapaBrasil({ geo, sel, nivelMun, valoresUF, valoresMun, metrica, nomesUF, onUF, onMun, pintura }: Props) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<MLMap | null>(null);
  const [pronto, setPronto] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const cb = useRef({ onUF, onMun, sel, nivelMun, valoresUF, valoresMun, metrica, nomesUF, geo, pintura });
  cb.current = { onUF, onMun, sel, nivelMun, valoresUF, valoresMun, metrica, nomesUF, geo, pintura };

  const mostrarMun = (nivelMun || !!sel.uf) && !!geo.mun && !!valoresMun;

  // -------- criação do mapa --------
  useEffect(() => {
    if (!div.current) return;
    const m = new maplibregl.Map({
      container: div.current,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0d1412" } }] },
      bounds: BR,
      fitBoundsOptions: { padding: 16 },
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      maxZoom: 11,
      minZoom: 2.5,
    });
    m.touchZoomRotate.disableRotation();
    m.on("load", () => {
      m.addSource("uf", { type: "geojson", data: geo.uf, promoteId: "uf" });
      m.addLayer({
        id: "uf-fill",
        type: "fill",
        source: "uf",
        paint: { "fill-color": ["coalesce", ["feature-state", "c"], COR_ZERO], "fill-opacity": ["coalesce", ["feature-state", "o"], 1] },
      });
      m.addLayer({ id: "uf-line", type: "line", source: "uf", paint: { "line-color": "#0d1412", "line-width": 1.2 } });
      m.addLayer({
        id: "uf-hover",
        type: "line",
        source: "uf",
        filter: ["==", ["get", "uf"], ""],
        paint: { "line-color": "#e8f5ec", "line-width": 2 },
      });
      setPronto(true);
    });

    const nomeUF = (uf: string) => cb.current.nomesUF[uf]?.nome ?? uf;

    m.on("mousemove", "uf-fill", (e) => {
      const c = cb.current;
      if ((c.nivelMun || c.sel.uf) && m.getLayer("mun-fill") && m.getLayoutProperty("mun-fill", "visibility") !== "none") {
        // municípios têm prioridade quando visíveis
        const sob = m.queryRenderedFeatures(e.point, { layers: ["mun-fill"] });
        if (sob.length) return;
      }
      const f = e.features?.[0];
      if (!f) return;
      const uf = f.properties.uf as string;
      m.getCanvas().style.cursor = "pointer";
      m.setFilter("uf-hover", ["==", ["get", "uf"], uf]);
      const x = c.valoresUF.get(uf);
      const d = c.pintura?.dica(uf);
      setHover({
        x: e.point.x,
        y: e.point.y,
        titulo: nomeUF(uf),
        sub: c.sel.uf === uf ? "Estado selecionado" : "Clique para detalhar os municípios",
        valor: d ? d.valor : fmtMetrica(valorMetrica(x, c.metrica), c.metrica),
        rotulo: d?.rotulo,
      });
    });
    m.on("mouseleave", "uf-fill", () => {
      m.getCanvas().style.cursor = "";
      m.setFilter("uf-hover", ["==", ["get", "uf"], ""]);
      setHover(null);
    });
    m.on("click", (e) => {
      const c = cb.current;
      const munF = m.getLayer("mun-fill") && m.getLayoutProperty("mun-fill", "visibility") !== "none"
        ? m.queryRenderedFeatures(e.point, { layers: ["mun-fill"] })
        : [];
      if (munF.length) {
        const id = munF[0].properties.id as string;
        c.onMun(c.sel.mun === id ? null : id, id.slice(0, 2));
        return;
      }
      const ufF = m.queryRenderedFeatures(e.point, { layers: ["uf-fill"] });
      if (ufF.length) c.onUF(ufF[0].properties.uf as string);
    });

    mapa.current = m;
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(div.current);
    return () => {
      ro.disconnect();
      m.remove();
      mapa.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------- camada de municípios (quando a malha chega) --------
  useEffect(() => {
    const m = mapa.current;
    if (!m || !pronto || !geo.mun || m.getSource("mun")) return;
    m.addSource("mun", { type: "geojson", data: geo.mun, promoteId: "id" });
    m.addLayer(
      {
        id: "mun-fill",
        type: "fill",
        source: "mun",
        layout: { visibility: "none" },
        paint: { "fill-color": ["coalesce", ["feature-state", "c"], COR_ZERO] },
      },
      "uf-line",
    );
    m.addLayer(
      {
        id: "mun-line",
        type: "line",
        source: "mun",
        layout: { visibility: "none" },
        paint: { "line-color": "#0d1412", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.1, 6, 0.5, 9, 1] },
      },
      "uf-line",
    );
    m.addLayer({
      id: "mun-hover",
      type: "line",
      source: "mun",
      filter: ["==", ["get", "id"], ""],
      paint: { "line-color": "#e8f5ec", "line-width": 1.5 },
    });
    m.addLayer({
      id: "mun-sel",
      type: "line",
      source: "mun",
      filter: ["==", ["get", "id"], ""],
      paint: { "line-color": "#ffffff", "line-width": 2.5 },
    });

    m.on("mousemove", "mun-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const c = cb.current;
      const id = f.properties.id as string;
      m.getCanvas().style.cursor = "pointer";
      m.setFilter("mun-hover", ["==", ["get", "id"], id]);
      m.setFilter("uf-hover", ["==", ["get", "uf"], ""]);
      const x = c.valoresMun?.get(id);
      const d = c.pintura?.dica(id);
      setHover({
        x: e.point.x,
        y: e.point.y,
        titulo: f.properties.name as string,
        sub: c.nomesUF[id.slice(0, 2)]?.sigla ?? "",
        valor: d ? d.valor : fmtMetrica(valorMetrica(x, c.metrica), c.metrica),
        rotulo: d?.rotulo,
      });
    });
    m.on("mouseleave", "mun-fill", () => {
      m.setFilter("mun-hover", ["==", ["get", "id"], ""]);
      setHover(null);
    });
    (m.getSource("uf") as GeoJSONSource | undefined)?.setData(geo.uf);
  }, [pronto, geo.mun, geo.uf]);

  // -------- quebras e cores --------
  const quebras = useMemo(() => {
    if (mostrarMun && valoresMun) {
      const vals: number[] = [];
      for (const [id, x] of valoresMun) if (!sel.uf || id.startsWith(sel.uf)) vals.push(valorMetrica(x, metrica));
      return quebrasQuantis(vals);
    }
    return quebrasQuantis([...valoresUF.values()].map((x) => valorMetrica(x, metrica)));
  }, [mostrarMun, valoresMun, valoresUF, metrica, sel.uf]);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !pronto) return;
    for (const f of geo.uf.features) {
      const uf = f.properties.uf;
      const dentro = !sel.uf || sel.uf === uf;
      const cor = mostrarMun ? "#151b19" : pintura ? pintura.uf(uf) : corDe(valorMetrica(valoresUF.get(uf), metrica), quebras);
      m.setFeatureState({ source: "uf", id: uf }, { c: cor, o: dentro ? 1 : 0.35 });
    }
    if (m.getSource("mun") && geo.mun) {
      const vis = mostrarMun ? "visible" : "none";
      m.setLayoutProperty("mun-fill", "visibility", vis);
      m.setLayoutProperty("mun-line", "visibility", vis);
      const filtro: maplibregl.FilterSpecification = sel.uf ? ["==", ["get", "uf"], sel.uf] : ["has", "id"];
      m.setFilter("mun-fill", filtro);
      m.setFilter("mun-line", filtro);
      m.setFilter("mun-sel", ["==", ["get", "id"], sel.mun ?? ""]);
      if (mostrarMun && valoresMun) {
        for (const f of geo.mun.features) {
          const id = f.properties.id;
          if (sel.uf && !id.startsWith(sel.uf)) continue;
          m.setFeatureState({ source: "mun", id }, { c: pintura ? pintura.mun(id) : corDe(valorMetrica(valoresMun.get(id), metrica), quebras) });
        }
      }
    }
  }, [pronto, geo, sel.uf, sel.mun, mostrarMun, valoresUF, valoresMun, metrica, quebras, pintura]);

  // -------- enquadramento --------
  useEffect(() => {
    const m = mapa.current;
    if (!m || !pronto) return;
    const b = sel.mun ? geo.bboxMun.get(sel.mun) : sel.uf ? geo.bboxUF.get(sel.uf) : BR;
    if (!b) return;
    m.fitBounds(b, { padding: sel.mun ? 120 : 28, duration: 900, maxZoom: sel.mun ? 7.2 : 7.5 });
  }, [pronto, sel.uf, sel.mun, geo.bboxUF, geo.bboxMun]);

  const legenda = { quebras };

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl">
      <div ref={div} className="h-full w-full" aria-label="Mapa do crédito rural por estado e município" role="img" />

      {/* controles */}
      <div className="absolute right-3 top-3 flex flex-col gap-1.5">
        {[
          { i: <Plus size={15} />, f: () => mapa.current?.zoomIn(), t: "Aproximar" },
          { i: <Minus size={15} />, f: () => mapa.current?.zoomOut(), t: "Afastar" },
          {
            i: <RotateCcw size={14} />,
            f: () => {
              onUF(null);
              mapa.current?.fitBounds(BR, { padding: 16, duration: 700 });
            },
            t: "Voltar ao Brasil",
          },
        ].map((b) => (
          <button key={b.t} onClick={b.f} title={b.t} aria-label={b.t} className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-black/50 text-white/80 backdrop-blur transition hover:bg-black/70 hover:text-white">
            {b.i}
          </button>
        ))}
      </div>

      {/* legenda */}
      {pintura ? (
        <div className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-[11px] text-white/70 backdrop-blur">{pintura.legenda}</div>
      ) : legenda.quebras.length > 0 && (
        <div className="absolute bottom-3 left-3 rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-[11px] text-white/70 backdrop-blur">
          <div className="mb-1.5 font-medium text-white/85">
            {NOME_METRICA[metrica]} · {mostrarMun ? "municípios" : "estados"}
          </div>
          <div className="flex items-center gap-[2px]">
            <span className="mr-1 h-2.5 w-4 rounded-sm" style={{ background: COR_ZERO }} title="Sem operações" />
            {RAMPA.map((c) => (
              <span key={c} className="h-2.5 w-6 first:rounded-l-sm last:rounded-r-sm" style={{ background: c }} />
            ))}
          </div>
          <div className="mt-1 flex justify-between gap-4 tabular-nums">
            <span>sem operação</span>
            <span>{fmtMetrica(legenda.quebras[0], metrica)}</span>
            <span>{fmtMetrica(legenda.quebras[legenda.quebras.length - 1], metrica)}+</span>
          </div>
        </div>
      )}

      {!geo.mun && (nivelMun || sel.uf) && (
        <div className="absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-black/60 px-3 py-1 text-xs text-white/80">Carregando malha municipal…</div>
      )}

      {hover && (
        <div
          className="pointer-events-none absolute z-10 min-w-40 rounded-lg border border-white/10 bg-[#0b100e]/95 px-3 py-2 text-xs shadow-xl"
          style={{ left: Math.min(hover.x + 14, (div.current?.clientWidth ?? 400) - 190), top: hover.y + 14 }}
        >
          <div className="font-semibold text-white">{hover.titulo}</div>
          <div className="text-white/50">{hover.sub}</div>
          <div className="mt-1 text-sm font-semibold tabular-nums text-emerald-300">{hover.valor}</div>
          <div className="text-[10px] uppercase tracking-wide text-white/40">{hover.rotulo ?? NOME_METRICA[metrica]}</div>
        </div>
      )}
    </div>
  );
}
