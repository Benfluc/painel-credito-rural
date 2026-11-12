import type { VercelRequest, VercelResponse } from "@vercel/node";
import { consultarMunicipio } from "./_olinda";

// GET /api/municipio?ibge=3143302&ano=2025 — consulta ao vivo no SICOR (com cache de CDN)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ibge = String(req.query.ibge ?? "");
  const ano = Number(req.query.ano);
  const anoAtual = new Date().getFullYear();
  if (!/^\d{7}$/.test(ibge) || !(ano >= 2013 && ano <= anoAtual)) {
    return res.status(400).json({ erro: "Parâmetros inválidos: use ibge=<7 dígitos>&ano=<2013–atual>" });
  }
  try {
    const dados = await consultarMunicipio(ibge, ano);
    // ano corrente muda com novos registros; anos fechados quase não mudam
    const ttl = ano === anoAtual ? 6 * 3600 : 7 * 86400;
    res.setHeader("Cache-Control", `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}`);
    return res.status(200).json(dados);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ erro: String(e instanceof Error ? e.message : e) });
  }
}
