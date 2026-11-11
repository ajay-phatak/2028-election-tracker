import { getRacePolls, getAllRacePolls } from "./_polls.js";

// GET /api/race-polls            -> { GA:{...}, MI:{...}, ... }  (all states, one VoteHub fetch)
// GET /api/race-polls?state=GA   -> { stateCode, dem, rep, n, lastUpdated, trend }
export default async function handler(req, res) {
  const state = String(req.query?.state || "").toUpperCase();
  try {
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    if (!state) {
      res.status(200).json(await getAllRacePolls());
      return;
    }
    const data = await getRacePolls(state);
    if (!data) {
      res.status(404).json({ error: `unknown state ${state}` });
      return;
    }
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
