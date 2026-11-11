import { getAllResults, resultsCacheControl } from "./_results.js";

// GET /api/results -> { races: { GA: { pct, dem, rep, winner, updated }, "NY-17": {...} }, lastUpdated }
// Live vote counts from civicAPI for the election-night results window; empty
// outside it. Not warmed into KV: a short max-age lets the edge cache (and the
// browser) absorb traffic, with a long one outside the window when nothing changes.
export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", resultsCacheControl(Date.now()));
    res.status(200).json(await getAllResults({ maxRequests: 100 }));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
