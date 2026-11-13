import { useEffect, useMemo, useState } from "react";
import { Radio, RefreshCw, AlertTriangle } from "lucide-react";
import type { Filtros, QV } from "../lib/data";
import type { RespostaMunicipio } from "../../api/_olinda";
import { consultarMunicipio } from "../../api/_olinda";
import { BarrasEmpilhadas, LegendaFin, serieMensal } from "./Graficos";
import { BarrasH, Card, Skeleton, Vazio } from "./ui";
import { brl, ha } from "../lib/format";
import { COR_FIN } from "../lib/colors";

type Estado = { s: "carregando" } | { s: "erro"; msg: string } | { s: "ok"; d: RespostaMunicipio; via: "api" | "direto" };

async function buscar(ibge: string, ano: number): Promise<{ d: RespostaMunicipio; via: "api" | "direto" }> {
  try {
    const r = await fetch(`/api/municipio?ibge=${ibge}&ano=${ano}`);
    if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) return { d: await r.json(), via: "api" };
  } catch {
    /* sem função serverless (ex.: npm run dev) — segue para a consulta direta */
  }
  // Reserva: consulta o Olinda direto do navegador (funciona se a API do BCB liberar CORS)
  return { d: await consultarMunicipio(ibge, ano), via: "direto" };
}

export default function MunicipioAoVivo({
  ibge,
  nome,
  uf,
  filtros,
  pam,
}: {
  ibge: string;
  nome: string;
  uf: string;
  filtros: Filtros;
  pam?: { ano: number; culturas: { k: string; nome: string; v: number; a: number }[] } | null;
}) {
  const [estado, setEstado] = useState<Estado>({ s: "carregando" });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    setEstado({ s: "carregando" });
    buscar(ibge, filtros.ano)
      .then((r) => vivo && setEstado({ s: "ok", ...r }))
      .catch((e) => vivo && setEstado({ s: "erro", msg: String(e?.message ?? e) }));
    return () => {
      vivo = false;
    };
  }, [ibge, filtros.ano, tentativa]);

  const visao = useMemo(() => {
    if (estado.s !== "ok") return null;
    const { d } = estado;
    const passa = (a: number, p: number) => (!filtros.at || a === filtros.at) && (filtros.pg < 0 || p === filtros.pg);
    const m: QV[][] = Array.from({ length: 12 }, () => Array.from({ length: 4 }, () => ({ q: 0, v: 0 })));
    for (const r of d.mensal) {
      if (!passa(r[1], r[2])) continue;
      for (let k = 0; k < 4; k++) {
        m[r[0] - 1][k].q += r[3 + 2 * k];
        m[r[0] - 1][k].v += r[4 + 2 * k];
      }
    }
    const meses = d.mensal.map((r) => r[0]);
    const prod = (lista: (string | number)[][]) => {
      const acc = new Map<string, { v: number; a: number }>();
      for (const [nomeP, a, p, v, area] of lista) {
        if (!passa(a as number, p as number)) continue;
        const x = acc.get(nomeP as string) ?? { v: 0, a: 0 };
        x.v += v as number;
        x.a += area as number;
        acc.set(nomeP as string, x);
      }
      return [...acc.entries()]
        .sort((x, y) => y[1].v - x[1].v)
        .slice(0, 8)
        .map(([k, x]) => ({ k, nome: k.charAt(0) + k.slice(1).toLowerCase(), v: x.v, extra: x.a > 0 ? ha(x.a) : undefined }));
    };
    return { mensal: serieMensal(m, meses.length ? meses : undefined), custeio: prod(d.custeio), invest: prod(d.investimento) };
  }, [estado, filtros.at, filtros.pg]);

  const selo =
    estado.s === "ok" ? (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/25 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
        <Radio size={12} className="animate-pulse" /> Ao vivo do BCB · {new Date(estado.d.consultadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
      </span>
    ) : null;

  return (
    <Card
      titulo={
        <>
          {nome} <span className="font-normal text-stone-500">· {uf} · {filtros.ano}</span>
        </>
      }
      sub="Consulta direta à API do SICOR para o município selecionado"
      acao={selo}
      className="lg:col-span-3"
      nota="Os dados mensais e por produto do município vêm direto do Banco Central no momento da consulta (com cache de algumas horas). Industrialização e comercialização não têm detalhamento por produto no nível municipal."
    >
      {estado.s === "carregando" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <p className="mb-2 text-xs text-stone-500">Consultando o Banco Central… a API do SICOR costuma levar de 5 a 30 segundos.</p>
            <Skeleton className="h-56" />
          </div>
          <Skeleton className="h-64" />
        </div>
      )}
      {estado.s === "erro" && (
        <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-stone-600">
          <AlertTriangle className="text-amber-600" />
          <p>
            A API do Banco Central não respondeu agora. Ela tem instabilidades conhecidas.
            <br />
            <span className="text-xs text-stone-500">{estado.msg}</span>
          </p>
          <button onClick={() => setTentativa((t) => t + 1)} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-100">
            <RefreshCw size={13} /> Tentar de novo
          </button>
        </div>
      )}
      {estado.s === "ok" && visao && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-medium uppercase tracking-wide text-stone-500">Contratações por mês</h3>
              <LegendaFin fins={filtros.fins} />
            </div>
            {estado.d.mensal.length ? <BarrasEmpilhadas serie={visao.mensal} fins={filtros.fins} metrica={filtros.metrica} altura={230} /> : <Vazio>Nenhum contrato registrado em {filtros.ano}.</Vazio>}
            {estado.d.avisos.map((a) => (
              <p key={a} className="mt-2 text-[11px] text-amber-700">{a}</p>
            ))}
          </div>
          <div className="space-y-4">
            {filtros.fins[0] && (
              <div>
                <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">Custeio · principais produtos</h3>
                <BarrasH itens={visao.custeio} fmt={(v) => brl(v)} cor={COR_FIN[0]} />
              </div>
            )}
            {filtros.fins[1] && (
              <div>
                <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">Investimento · principais itens</h3>
                <BarrasH itens={visao.invest} fmt={(v) => brl(v)} cor={COR_FIN[1]} />
              </div>
            )}
            {pam && pam.culturas.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">Produção agrícola · PAM {pam.ano}</h3>
                <BarrasH itens={pam.culturas.map((c) => ({ ...c, extra: c.a > 0 ? ha(c.a) : undefined }))} fmt={(v) => brl(v)} cor="#2a78d6" />
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
