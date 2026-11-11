import { getControl } from "./_providers.js";

// GET /api/control -> { senate: { sources: [...] }, house: { sources: [...] } }
export default async function handler(req, res) {
  try {
    const data = await getControl();
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
