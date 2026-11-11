import { getNominationOdds, getAllNomination } from "./_nomination.js";
import { PARTIES } from "../src/config/president.config.js";

// GET /api/nomination?party=dem|rep -> { party, updatedAt, candidates:[{id,name,polymarket,kalshi,avg}], sources:{polymarket:{ok,volume},kalshi:{ok}} }
// Without ?party= returns { dem:{...}, rep:{...} } (the shape the KV warmer stores).
export default async function handler(req, res) {
  const party = String(req.query?.party || "").toLowerCase();
  if (party && !PARTIES[party]) {
    res.status(400).json({ error: `unknown party ${party}` });
    return;
  }
  try {
    const data = party ? await getNominationOdds(party) : await getAllNomination();
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
