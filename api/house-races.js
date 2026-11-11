import { getAllHouseRaces } from "./_providers.js";

// GET /api/house-races -> { "CA-41": { code, sources:[...] }, ... } (all watched
// House districts, fanned out server-side in one batch like /api/race-polls).
export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json(await getAllHouseRaces());
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
