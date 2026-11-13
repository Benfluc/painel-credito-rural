import { useMemo, useRef, useState } from "react";
import { Search, X, ChevronRight } from "lucide-react";
import type { Filtros, Geo, Meta, Metrica } from "../lib/data";
import { Segmentado } from "./ui";
import { COR_FIN } from "../lib/colors";
import { FIN_NOMES } from "./Graficos";

interface Props {
  meta: Meta;
  f: Filtros;
  setF: (f: Filtros) => void;
  geo: Geo;
  setGeo: (g: Geo) => void;
  nomeMun: Map<string, string>;
  /** dentro do painel de filtros do celular (sem barra fixa) */
  emPainel?: boolean;
}

function norm(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function BuscaMunicipio({ nomeMun, meta, onPick }: { nomeMun: Map<string, string>; meta: Meta; onPick: (ibge: string) => void }) {
  const [q, setQ] = useState("");
  const [aberto, setAberto] = useState(false);
  const [i, setI] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const indice = useMemo(() => [...nomeMun.entries()].map(([id, n]) => ({ id, n, k: norm(n) })), [nomeMun]);
  const res = useMemo(() => {
    const t = norm(q.trim());
    if (t.length < 2) return [];
    const ini = indice.filter((x) => x.k.startsWith(t));
    const meio = indice.filter((x) => !x.k.startsWith(t) && x.k.includes(t));
    return [...ini, ...meio].slice(0, 8);
  }, [q, indice]);

  const escolher = (id: string) => {
    onPick(id);
    setQ("");
    setAberto(false);
    ref.current?.blur();
  };

  return (
    <div className="relative w-full sm:w-64">
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-500" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setAberto(true);
          setI(0);
        }}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setI((x) => Math.min(x + 1, res.length - 1));
          else if (e.key === "ArrowUp") setI((x) => Math.max(x - 1, 0));
          else if (e.key === "Enter" && res[i]) escolher(res[i].id);
          else if (e.key === "Escape") setAberto(false);
        }}
        placeholder={nomeMun.size ? "Buscar município…" : "Carregando municípios…"}
        disabled={!nomeMun.size}
        role="combobox"
        aria-expanded={aberto && res.length > 0}
        aria-controls="lista-mun"
        aria-label="Buscar município"
        className="h-9 w-full rounded-lg border border-stone-200 bg-stone-100 pl-8 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-600/40 focus:outline-none"
      />
      {aberto && res.length > 0 && (
        <ul id="lista-mun" role="listbox" className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-2xl">
          {res.map((r, k) => (
            <li key={r.id} role="option" aria-selected={k === i}>
              <button onMouseDown={() => escolher(r.id)} onMouseEnter={() => setI(k)} className={`flex w-full justify-between px-3 py-1.5 text-left text-sm ${k === i ? "bg-emerald-50 text-stone-900" : "text-stone-700"}`}>
                <span>{r.n}</span>
                <span className="text-xs text-stone-500">{meta.ufs[r.id.slice(0, 2)]?.sigla}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BarraFiltros({ meta, f, setF, geo, setGeo, nomeMun, emPainel }: Props) {
  const toggleFin = (k: number) => {
    const fins = [...f.fins] as Filtros["fins"];
    fins[k] = !fins[k];
    if (!fins.some(Boolean)) return; // pelo menos uma finalidade
    setF({ ...f, fins });
  };
  const sel = "h-9 rounded-lg border border-stone-200 bg-stone-100 px-2.5 text-sm text-stone-900 focus:border-emerald-600/40 focus:outline-none";

  return (
    <div className={emPainel ? "" : "z-20 -mx-4 border-b border-stone-200 bg-[#f7f7f4]/90 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 md:sticky md:top-0"}>
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="f-ano">Ano</label>
          <select id="f-ano" className={sel} value={f.ano} onChange={(e) => setF({ ...f, ano: Number(e.target.value) })}>
            {[...meta.anos].reverse().map((a) => (
              <option key={a} value={a} className="bg-white">
                {a}
                {meta.ultimoMes?.startsWith(String(a)) && Number(meta.ultimoMes.slice(5)) < 12 ? " (parcial)" : ""}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="f-pg">Programa</label>
          <select id="f-pg" className={sel} value={f.pg} onChange={(e) => setF({ ...f, pg: Number(e.target.value) })}>
            <option value={-1} className="bg-white">Todos os programas</option>
            {meta.programas.map((p, i) => (
              <option key={p} value={i} className="bg-white">{p}</option>
            ))}
          </select>
          <Segmentado
            rotulo="Atividade"
            valor={f.at}
            onChange={(at) => setF({ ...f, at })}
            opcoes={[
              { v: 0, t: "Todas" },
              { v: 1, t: "Agrícola" },
              { v: 2, t: "Pecuária" },
            ]}
          />
          <Segmentado<Metrica>
            rotulo="Métrica"
            valor={f.metrica}
            onChange={(metrica) => setF({ ...f, metrica })}
            opcoes={[
              { v: "valor", t: "Valor" },
              { v: "contratos", t: "Contratos" },
              { v: "medio", t: "Valor médio" },
            ]}
          />
          <div className="ml-auto w-full sm:w-auto">
            <BuscaMunicipio nomeMun={nomeMun} meta={meta} onPick={(id) => setGeo({ uf: id.slice(0, 2), mun: id })} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Finalidades">
            {FIN_NOMES.map((n, k) => (
              <button
                key={n}
                aria-pressed={f.fins[k]}
                onClick={() => toggleFin(k)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${f.fins[k] ? "border-stone-200 bg-stone-100 text-stone-900" : "border-stone-200 text-stone-500 line-through decoration-stone-300 hover:text-stone-700"}`}
              >
                <i className="h-2 w-2 rounded-full" style={{ background: f.fins[k] ? COR_FIN[k] : "#555" }} />
                {n}
              </button>
            ))}
          </div>
          <nav aria-label="Recorte geográfico" className="ml-auto flex items-center gap-1 text-sm">
            <button onClick={() => setGeo({ uf: null, mun: null })} className={geo.uf ? "text-stone-600 hover:text-stone-900" : "font-semibold text-stone-900"}>
              Brasil
            </button>
            {geo.uf && (
              <>
                <ChevronRight size={14} className="text-stone-400" />
                <button onClick={() => setGeo({ uf: geo.uf, mun: null })} className={geo.mun ? "text-stone-600 hover:text-stone-900" : "font-semibold text-stone-900"}>
                  {meta.ufs[geo.uf]?.nome}
                </button>
              </>
            )}
            {geo.mun && (
              <>
                <ChevronRight size={14} className="text-stone-400" />
                <span className="font-semibold text-stone-900">{nomeMun.get(geo.mun) ?? geo.mun}</span>
                <button onClick={() => setGeo({ uf: geo.uf, mun: null })} aria-label="Limpar município" className="ml-1 rounded p-0.5 text-stone-500 hover:bg-stone-200 hover:text-stone-900">
                  <X size={13} />
                </button>
              </>
            )}
          </nav>
        </div>
      </div>
    </div>
  );
}
