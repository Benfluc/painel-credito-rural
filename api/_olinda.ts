// Consultas ao vivo ao SICOR (OData v2 do Olinda/BCB).
// Usado pelas funções serverless (/api/*) e, como reserva, direto no navegador.

export const BASE = "https://olinda.bcb.gov.br/olinda/servico/SICOR/versao/v2/odata";

const PROG: Record<string, number> = { "0001": 0, "0050": 1, "0999": 2, "0156": 3, "0222": 3, "0180": 3 };
const pg = (c: unknown) => PROG[String(c ?? "").padStart(4, "0")] ?? 4;
const at = (a: unknown) => (String(a ?? "").trim() === "2" ? 2 : 1);
const n = (x: unknown) => (typeof x === "number" ? x : Number(x) || 0);
const esc = (s: string) => s.replace(/'/g, "''");

type Reg = Record<string, unknown>;

export function urlOData(entidade: string, filtro: string, select?: string[], top = 100000): string {
  const p = [`$format=json`, `$top=${top}`, `$filter=${encodeURIComponent(filtro).replace(/%27/g, "'")}`];
  if (select) p.push(`$select=${select.join(",")}`);
  return `${BASE}/${entidade}?${p.join("&")}`;
}

export async function getOData(url: string, tentativas = 3, timeoutMs = 25000): Promise<Reg[]> {
  let erro: unknown;
  for (let t = 0; t < tentativas; t++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { value?: Reg[] };
      if (!Array.isArray(j.value)) throw new Error("resposta sem 'value'");
      return j.value;
    } catch (e) {
      erro = e;
      await new Promise((ok) => setTimeout(ok, 600 * (t + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Falha ao consultar o BCB: ${String(erro)}`);
}

export interface RespostaMunicipio {
  ibge: string;
  ano: number;
  nome: string | null;
  consultadoEm: string;
  /** [mes, at, pg, qC, vC, qI, vI, qM, vM, qN, vN] */
  mensal: number[][];
  /** [nome, at, pg, valor, area] */
  custeio: (string | number)[][];
  investimento: (string | number)[][];
  avisos: string[];
  urls: string[];
}

function agruparProdutos(regs: Reg[], campoV: string, campoA: string) {
  const m = new Map<string, (string | number)[]>();
  for (const r of regs) {
    const nome = String(r.nomeProduto ?? "").replace(/"/g, "").trim() || "NÃO INFORMADO";
    const k = `${nome}|${at(r.Atividade)}|${pg(r.cdPrograma)}`;
    const a = m.get(k) ?? [nome, at(r.Atividade), pg(r.cdPrograma), 0, 0];
    a[3] = (a[3] as number) + n(r[campoV]);
    a[4] = (a[4] as number) + n(r[campoA]);
    m.set(k, a);
  }
  return [...m.values()].sort((x, y) => (y[3] as number) - (x[3] as number));
}

export async function consultarMunicipio(ibge: string, ano: number): Promise<RespostaMunicipio> {
  if (!/^\d{7}$/.test(ibge)) throw new Error("código IBGE inválido");
  const avisos: string[] = [];
  const urls: string[] = [];
  const fAno = `AnoEmissao eq '${ano}'`;

  // 1) Série mensal do município (+ código SICOR e nome, usados nas consultas por produto)
  const u1 = urlOData("CusteioInvestimentoComercialIndustrialSemFiltros", `${fAno} and codMunicIbge eq '${ibge}'`, [
    "MesEmissao", "Atividade", "cdPrograma", "cdMunicipio", "Municipio", "cdEstado",
    "QtdCusteio", "VlCusteio", "QtdInvestimento", "VlInvestimento", "QtdComercializacao", "VlComercializacao", "QtdIndustrializacao", "VlIndustrializacao",
  ]);
  urls.push(u1);
  const regs = await getOData(u1);
  const acc = new Map<string, number[]>();
  let cdMun: string | null = null;
  let nome: string | null = null;
  let cdEstado: string | null = null;
  for (const r of regs) {
    const mes = Number(r.MesEmissao);
    const k = `${mes}|${at(r.Atividade)}|${pg(r.cdPrograma)}`;
    const a = acc.get(k) ?? [mes, at(r.Atividade), pg(r.cdPrograma), 0, 0, 0, 0, 0, 0, 0, 0];
    const vals = [r.QtdCusteio, r.VlCusteio, r.QtdInvestimento, r.VlInvestimento, r.QtdComercializacao, r.VlComercializacao, r.QtdIndustrializacao, r.VlIndustrializacao];
    vals.forEach((v, i) => (a[3 + i] += n(v)));
    acc.set(k, a);
    cdMun ??= r.cdMunicipio ? String(r.cdMunicipio) : null;
    nome ??= r.Municipio ? String(r.Municipio) : null;
    cdEstado ??= r.cdEstado ? String(r.cdEstado) : null;
  }
  const mensal = [...acc.values()].sort((a, b) => a[0] - b[0]);

  // 2) Produtos financiados (custeio e investimento), em paralelo
  const cust = async () => {
    const u = urlOData("CusteioMunicipioProduto", `${fAno} and codIbge eq '${ibge}'`, ["nomeProduto", "Atividade", "cdPrograma", "VlCusteio", "AreaCusteio"]);
    urls.push(u);
    let r = await getOData(u);
    if (!r.length && nome && cdEstado) {
      // reserva: algumas bases trazem o código IBGE em outro formato; tenta pelo nome + UF
      const u2 = urlOData("CusteioMunicipioProduto", `${fAno} and Municipio eq '${esc(nome)}' and cdEstado eq '${cdEstado}'`, ["nomeProduto", "Atividade", "cdPrograma", "VlCusteio", "AreaCusteio"]);
      urls.push(u2);
      r = await getOData(u2);
    }
    return agruparProdutos(r, "VlCusteio", "AreaCusteio");
  };
  const inv = async () => {
    if (!cdMun) return [];
    const u = urlOData("InvestMunicipioProduto", `${fAno} and cdMunicipio eq '${cdMun}'`, ["nomeProduto", "Atividade", "cdPrograma", "VlInvest", "AreaInvest"]);
    urls.push(u);
    return agruparProdutos(await getOData(u), "VlInvest", "AreaInvest");
  };
  const [rc, ri] = await Promise.allSettled([cust(), inv()]);
  if (rc.status === "rejected") avisos.push("Produtos de custeio indisponíveis no momento.");
  if (ri.status === "rejected") avisos.push("Produtos de investimento indisponíveis no momento.");

  return {
    ibge,
    ano,
    nome,
    consultadoEm: new Date().toISOString(),
    mensal,
    custeio: rc.status === "fulfilled" ? rc.value : [],
    investimento: ri.status === "fulfilled" ? ri.value : [],
    avisos,
    urls,
  };
}

export interface RespostaStatus {
  online: boolean;
  ultimoMes: string | null;
  consultadoEm: string;
}

/** Último mês com registros na fonte (procura até 6 meses para trás). */
export async function consultarStatus(): Promise<RespostaStatus> {
  const d = new Date();
  for (let i = 0; i < 6; i++) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const url = urlOData("RegiaoUF", `AnoEmissao eq '${y}' and MesEmissao eq '${String(m).padStart(2, "0")}'`, ["AnoEmissao"], 1);
    const r = await getOData(url, 2, 15000);
    if (r.length) return { online: true, ultimoMes: `${y}-${String(m).padStart(2, "0")}`, consultadoEm: new Date().toISOString() };
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return { online: true, ultimoMes: null, consultadoEm: new Date().toISOString() };
}
