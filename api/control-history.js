import { getControlHistory } from "./_providers.js";

// Intraday windows (30d/7d/24h) are live, uncached-upstream fetches — keep the
// client/CDN cache short so a fresh selection doesn't serve a stale one for
// minutes. all/90d stay on the longer window (90d rides the "all" cache key).
const INTRADAY_RANGES = new Set(["30d", "7d", "24h"]);
const cacheControlFor = (range) =>
  INTRADAY_RANGES.has(range)
    ? "s-maxage=60, stale-while-revalidate=300"
    : "s-maxage=300, stale-while-revalidate=900";

// GET /api/control-history?range=all -> { senate:{sources:[{id,label,points:[{t,dem,rep}],hasData}]}, house:{...} }
export default async function handler(req, res) {
  const range = String(req.query?.range || "all");
  try {
    const data = await getControlHistory(range);
    res.setHeader("Cache-Control", cacheControlFor(range));
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
