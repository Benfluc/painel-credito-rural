import type { VercelRequest, VercelResponse } from "@vercel/node";
import { consultarStatus } from "./_olinda";

// GET /api/status — a fonte (BCB) está no ar e qual o último mês com registros
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const s = await consultarStatus();
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=21600");
    return res.status(200).json(s);
  } catch (e) {
    res.setHeader("Cache-Control", "public, s-maxage=300");
    return res.status(200).json({ online: false, ultimoMes: null, consultadoEm: new Date().toISOString(), erro: String(e) });
  }
}
