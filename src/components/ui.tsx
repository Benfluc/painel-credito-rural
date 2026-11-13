import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Info } from "lucide-react";

export function Card({ titulo, sub, acao, children, className = "", nota }: { titulo?: ReactNode; sub?: ReactNode; acao?: ReactNode; children: ReactNode; className?: string; nota?: ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className={`card flex flex-col p-4 sm:p-5 ${className}`}
    >
      {(titulo || acao) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {titulo && <h2 className="text-[15px] font-semibold text-stone-900">{titulo}</h2>}
            {sub && <p className="mt-0.5 text-xs text-stone-500">{sub}</p>}
          </div>
          {acao}
        </header>
      )}
      <div className="min-h-0 flex-1">{children}</div>
      {nota && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-stone-500">
          <Info size={12} className="mt-px shrink-0" />
          <span>{nota}</span>
        </p>
      )}
    </motion.section>
  );
}

export function Segmentado<T extends string | number>({ valor, opcoes, onChange, rotulo }: { valor: T; opcoes: { v: T; t: string }[]; onChange: (v: T) => void; rotulo: string }) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="inline-flex rounded-lg border border-stone-200 bg-stone-100 p-0.5">
      {opcoes.map((o) => (
        <button
          key={String(o.v)}
          role="radio"
          aria-checked={valor === o.v}
          onClick={() => onChange(o.v)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${valor === o.v ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-600/30" : "text-stone-600 hover:text-stone-900"}`}
        >
          {o.t}
        </button>
      ))}
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="grid h-full min-h-32 place-items-center px-6 text-center text-sm text-stone-500">{children}</div>;
}

/** Lista de barras horizontais com rótulo e valor (para rankings e quebras). */
export function BarrasH({
  itens,
  fmt,
  cor = "#2a78d6",
  onClick,
  ativo,
  max,
}: {
  itens: { k: string; nome: string; v: number; extra?: string }[];
  fmt: (v: number) => string;
  cor?: string;
  onClick?: (k: string) => void;
  ativo?: string | null;
  max?: number;
}) {
  const m = max ?? Math.max(1, ...itens.map((i) => i.v));
  if (!itens.length) return <Vazio>Sem operações para os filtros escolhidos.</Vazio>;
  return (
    <ol className="space-y-1.5">
      {itens.map((it, i) => {
        const Comp = onClick ? "button" : "div";
        return (
          <li key={it.k}>
            <Comp
              {...(onClick ? { onClick: () => onClick(it.k), title: `Selecionar ${it.nome}` } : {})}
              className={`group grid w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md px-1.5 py-1 text-left text-[13px] transition ${onClick ? "hover:bg-stone-100" : ""} ${ativo === it.k ? "bg-emerald-50" : ""}`}
            >
              <span className="text-[11px] tabular-nums text-stone-400">{i + 1}</span>
              <span className="truncate text-stone-800">
                {it.nome}
                {it.extra && <span className="ml-1.5 text-[11px] text-stone-500">{it.extra}</span>}
              </span>
              <span className="text-right text-[12px] font-medium tabular-nums text-stone-700">{fmt(it.v)}</span>
              <span />
              <span className="col-span-2 mt-1 block h-1.5 overflow-hidden rounded-full bg-stone-100">
                <motion.span
                  className="block h-full rounded-full"
                  style={{ background: cor }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(1.5, (it.v / m) * 100)}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </span>
            </Comp>
          </li>
        );
      })}
    </ol>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-stone-100 ${className}`} />;
}
