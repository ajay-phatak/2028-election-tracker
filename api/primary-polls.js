import { getPrimaryPolls, getAllPrimaryPolls } from "./_primaryPolls.js";
import { PARTIES } from "../src/config/president.config.js";

// GET /api/primary-polls?party=dem|rep
//   -> { party, method, lastUpdated, n, candidates:[{id,name,pct,lower,upper}], trend:[{t,<id>:pct}], recentPolls:[...] }
// Without ?party= returns { dem:{...}|null, rep:{...}|null } (the shape the KV warmer stores).
export default async function handler(req, res) {
  const party = String(req.query?.party || "").toLowerCase();
  if (party && !PARTIES[party]) {
    res.status(400).json({ error: `unknown party ${party}` });
    return;
  }
  try {
    const data = party ? await getPrimaryPolls(party) : await getAllPrimaryPolls();
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
