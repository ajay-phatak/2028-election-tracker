import { getRaceNews } from "./_news.js";

// GET /api/race-news?state=GA -> { stateCode, articles: [...], lastUpdated }
export default async function handler(req, res) {
  const state = String(req.query?.state || "").toUpperCase();
  if (!state) {
    res.status(400).json({ error: "missing ?state=" });
    return;
  }
  try {
    const data = await getRaceNews(state, process.env.NEWS_API_KEY);
    if (!data) {
      res.status(404).json({ error: `unknown state ${state}` });
      return;
    }
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
