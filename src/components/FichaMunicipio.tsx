import { MapPin, X } from "lucide-react";
import type { Metrica, QV, QVMun } from "../lib/data";
import type { Par } from "../lib/pam";
import { brl, fmtMetrica, ha, num, NOME_METRICA } from "../lib/format";
import { BarrasH, Card } from "./ui";

interface Props {
  nome: string;
  ufSigla: string;
  ufNome: string;
  ano: number;
  periodo: string;
  metrica: Metrica;
  x: QVMun | undefined;
  ufTot: QV | undefined;
  posUF: { pos: number; n: number } | null;
  posBR: { pos: number; n: number } | null;
  programas: { k: string; nome: string; v: number }[];
  atividades: { k: string; nome: string; v: number }[];
  ql: Par | undefined;
  pam: { ano: number; culturas: { k: string; nome: string; v: number; a: number }[] } | null;
  aviso?: string;
  onFechar: () => void;
}

const pct = (x: number) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: x < 0.01 ? 2 : 1 }).format(x * 100)}%`;
const nfQ = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function FichaMunicipio(p: Props) {
  const { x } = p;
  const tiles = [
    { r: `Valor contratado · ${p.periodo}`, v: brl(x?.v ?? 0) },
    { r: "Contratos", v: num(x?.q ?? 0) },
    { r: "Valor médio por contrato", v: x?.q ? brl(x.v / x.q) : "—" },
    { r: "Área financiada", v: x && x.aC + x.aI > 0 ? ha(x.aC + x.aI) : "—" },
    { r: `Participação em ${p.ufSigla}`, v: p.ufTot?.v && x ? pct(x.v / p.ufTot.v) : "—" },
    {
      r: "Posição no ranking",
      v: p.posUF ? `${p.posUF.pos}º de ${p.posUF.n}` : "—",
      d: p.posBR ? `${p.posBR.pos.toLocaleString("pt-BR")}º no Brasil` : undefined,
    },
  ];
  const fmt = (v: number) => fmtMetrica(v, p.metrica);

  return (
    <Card
      titulo={
        <span className="flex items-center gap-2">
          <MapPin size={16} className="text-emerald-700" />
          {p.nome} <span className="font-normal text-stone-500">· {p.ufNome} · {p.ano}</span>
        </span>
      }
      sub="Ficha do município com os filtros atuais"
      acao={
        <button onClick={p.onFechar} aria-label="Fechar a ficha do município" className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900">
          <X size={16} />
        </button>
      }
      nota={p.aviso}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.r} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">{t.r}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-stone-900">{t.v}</div>
            {t.d && <div className="text-[11px] text-stone-500">{t.d}</div>}
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-6 md:grid-cols-3">
        <div>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">Por programa · {NOME_METRICA[p.metrica].toLowerCase()}</h3>
          <BarrasH itens={p.programas.filter((i) => i.v > 0)} fmt={fmt} cor="#2a78d6" />
        </div>
        <div>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">Agrícola × pecuária</h3>
          <BarrasH itens={p.atividades.filter((i) => i.v > 0)} fmt={fmt} cor="#1baf7a" />
        </div>
        <div>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">Produção agrícola{p.pam ? ` · PAM ${p.pam.ano}` : ""}</h3>
          {p.ql && Number.isFinite(p.ql.ql) && (
            <p className="mb-2 rounded-lg bg-stone-50 px-2.5 py-1.5 text-xs text-stone-600">
              QL crédito × produção em {p.ufSigla}: <b className="tabular-nums text-stone-900">{nfQ.format(p.ql.ql)}</b>
              {p.ql.ql >= 1.25 ? " — recebe mais crédito que sua fatia na produção" : p.ql.ql < 0.8 ? " — recebe menos crédito que sua fatia na produção" : " — perto do equilíbrio"}
            </p>
          )}
          {p.pam && p.pam.culturas.length ? (
            <BarrasH itens={p.pam.culturas.map((c) => ({ ...c, extra: c.a > 0 ? ha(c.a) : undefined }))} fmt={(v) => brl(v)} cor="#1baf7a" />
          ) : (
            <p className="text-sm text-stone-500">Sem produção agrícola registrada na PAM.</p>
          )}
        </div>
      </div>
    </Card>
  );
}
