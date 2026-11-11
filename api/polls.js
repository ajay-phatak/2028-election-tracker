import { getMacroPolls } from "./_polls.js";

// GET /api/polls -> { genericBallot:{dem,rep,n,lastUpdated,trend}, approval:{approve,disapprove,n,lastUpdated,trend} }
export default async function handler(req, res) {
  try {
    const data = await getMacroPolls();
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
