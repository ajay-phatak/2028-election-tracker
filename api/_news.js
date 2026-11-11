// Recent-news proxy via the GNews API (https://gnews.io). Replaces the old Google
// News RSS source, which Google blocks from datacenter/Cloudflare egress IPs.
// Framework-agnostic (plain async + global fetch) so it runs both as a Cloudflare
// Pages Function and under the Vite dev middleware.
//
// The API key is passed in by the caller (env.NEWS_API_KEY on Workers,
// process.env.NEWS_API_KEY in local dev). With no key we degrade gracefully to an
// empty article list rather than erroring — the UI already handles empty news.
//
// Result shape: { stateCode, articles: [{ title, link, source, publishedAt }], lastUpdated }

import { WATCHED_RACES } from "../src/config/races.config.js";
import { dedupeArticles } from "../src/lib/news.js";

const GNEWS = "https://gnews.io/api/v4/search";
const MAX_ARTICLES = 6;
// Ask GNews for its free-tier maximum (same one request) so there are still
// MAX_ARTICLES left after syndicated duplicates are dropped.
const FETCH_ARTICLES = 10;

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// A nominee's name as a GNews phrase term: drop accents (headlines often omit
// them), middle initials ("John E. Sununu") and generational suffixes ("Tom Kean
// Jr."), which headlines rarely include and an exact phrase would then miss.
function searchName(name) {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, "")
    .replace(/\s+[A-Z]\.(?=\s)/g, "")
    .trim();
}

// Words that mark a headline as campaign coverage rather than the candidate's
// day job (a senator's committee vote, a mayor's budget).
const RACE_WORDS = /\b(race|campaign|election|poll|polls|polling|debate|ad|ads|vote|voters|ballot|challenger|nominee|endorse\w*|fundrais\w*|primar(y|ies))\b/i;

// Build the GNews query + the surnames used to rank results. With nominees set
// (every watched race), search for either nominee by full name: GNews treats
// quoted phrases as exact and OR widens the match, so this stays as broad as the
// old one-name queries while excluding namesakes and same-state noise (the
// "Florida Senate" query used to return Florida *state* Senate stories). Without
// nominees, fall back to the old loose queries. Note GNews ANDs bare
// space-separated terms and the free plan only covers the last 30 days, so never
// add bare words to these queries (e.g. "Georgia Senate race <year>" -> ~0 results).
function newsConfig(race) {
  if (race.candidates) {
    const names = [race.candidates.dem, race.candidates.rep].filter(Boolean).map(searchName);
    return {
      query: names.map((n) => `"${n}"`).join(" OR "),
      surnames: names.map((n) => n.split(" ").pop()),
    };
  }
  if (!race.district) return { query: `${race.state} Senate`, surnames: [race.state] };
  const hasName = race.incumbent && !/open/i.test(race.incumbent);
  if (hasName) {
    const name = searchName(race.incumbent);
    return { query: name, surnames: [name.split(" ").pop()] };
  }
  const num = Number(race.district.split("-")[1]);
  return { query: `${race.state} ${ordinal(num)} district`, surnames: [race.state] };
}

// Map GNews's article shape to ours and rank it: headlines naming both nominees
// first (head-to-head coverage), then one nominee plus a campaign word, then one
// nominee, then the rest; newest-first within each tier. Syndicated copies of the
// same headline are dropped.
function normalize(articles, surnames) {
  // Whole-word surname matches, so "Lee" doesn't match "fleeing".
  const terms = (surnames || []).map(
    (t) => new RegExp(`(^|[^\\p{L}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "iu")
  );
  const score = (title) => {
    const named = terms.filter((re) => re.test(title)).length;
    return named * 2 + (named && RACE_WORDS.test(title) ? 1 : 0);
  };
  const ranked = (articles || [])
    .map((a) => ({
      title: a.title || "",
      link: a.url || "",
      source: a.source?.name || "",
      publishedAt: a.publishedAt || null,
      relScore: score(a.title || ""),
    }))
    .filter((a) => a.title && a.link)
    .sort((a, b) => b.relScore - a.relScore || (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  return dedupeArticles(ranked)
    .slice(0, MAX_ARTICLES)
    .map(({ title, link, source, publishedAt }) => ({ title, link, source, publishedAt }));
}

// `strict` (used by the scheduled warmer) makes a missing key / non-OK GNews
// response THROW instead of degrading to an empty list. That lets the warmer
// distinguish a real failure (e.g. GNews rate-limiting a burst of requests with
// 429) — which is worth retrying — from a genuine no-news 200, which isn't. The
// default (non-strict) keeps the graceful-empty behavior the read-path live
// fallback and local dev rely on.
export async function getRaceNews(code, apiKey, { strict = false } = {}) {
  const race = [...WATCHED_RACES.senate, ...(WATCHED_RACES.house || [])].find(
    (r) => (r.code ?? r.stateCode) === code
  );
  if (!race) return null;

  const empty = { stateCode: code, articles: [], lastUpdated: null };
  // No key configured -> degrade gracefully (local dev, or before the Pages env var is set).
  if (!apiKey) {
    if (strict) throw new Error("no NEWS_API_KEY");
    return empty;
  }

  try {
    const { query, surnames } = newsConfig(race);
    // Keep to params supported on the GNews free tier (q, lang, country, max).
    const url =
      `${GNEWS}?q=${encodeURIComponent(query)}` +
      `&lang=en&country=us&max=${FETCH_ARTICLES}&apikey=${apiKey}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) {
      if (strict) throw new Error(`gnews ${r.status}`);
      return empty;
    }
    const data = await r.json();
    const articles = normalize(data.articles, surnames);
    return {
      stateCode: code,
      articles,
      lastUpdated: articles.length ? new Date().toISOString() : null,
    };
  } catch (e) {
    if (strict) throw e;
    return empty;
  }
}
