import { getNominationHistory } from "./_nomination.js";
import { PARTIES, PARTY_IDS } from "../src/config/president.config.js";

// Intraday windows (30d/7d/24h) are live, uncached-upstream fetches — same short
// cache as history.js; all/90d stay on the longer window (90d rides the "all" cache key).
const INTRADAY_RANGES = new Set(["30d", "7d", "24h"]);
const cacheControlFor = (range) =>
  INTRADAY_RANGES.has(range)
    ? "s-maxage=60, stale-while-revalidate=300"
    : "s-maxage=300, stale-while-revalidate=900";

// GET /api/nomination-history?party=dem&range=all
//   -> { party, range, candidates:[{id,name}], sources:[{ id, label, points:[{t,<candidateId>:pct}], hasData }] }
// Without ?party= returns { dem:{...}, rep:{...} }.
export default async function handler(req, res) {
  const party = String(req.query?.party || "").toLowerCase();
  const range = String(req.query?.range || "all");
  if (party && !PARTIES[party]) {
    res.status(400).json({ error: `unknown party ${party}` });
    return;
  }
  try {
    const data = party
      ? await getNominationHistory(party, range)
      : Object.fromEntries(await Promise.all(PARTY_IDS.map(async (p) => [p, await getNominationHistory(p, range)])));
    res.setHeader("Cache-Control", cacheControlFor(range));
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
