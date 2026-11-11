// Live election results via civicAPI (https://civicapi.org — free, no key, CORS *;
// attribution required, which the UI shows as "Results via civicAPI"). Framework-
// agnostic (plain async + global fetch) like _news.js, so it runs as a Cloudflare
// Pages Function fallback and under the Vite dev middleware / Vercel handler.
//
// Each watched race is fetched by its civicAPI ID (src/config/civicIds.js, resolved
// once via civicAPI's search, which is far too slow for live use: 10-15 s a query).
// The by-ID endpoint answers in well under a second, one subrequest per race. Senate
// goes first, then House in config order, under a request budget (default 44, under
// the Workers 50-subrequest cap; the Vercel origin passes a higher one). Races with no
// ID or a failed fetch are left out. Results are NOT stored in KV (the free write
// quota can't afford a minute-level cadence); the zone's edge cache absorbs traffic
// instead (see the `results` route in functions/api/[[route]].js).
//
// Result shape: { races: { [code]: { pct, dem, rep, winner, updated } }, lastUpdated }
//   code = Senate stateCode ("GA") or House district ("NY-17");
//   dem/rep = { name, votes, percent } | null; winner = "D" | "R" | null.
// The "dem" side is the anti-GOP candidate (an independent in NE and ID), matched
// to the config's nominee by full name, then a unique surname, then party.

import { WATCHED_RACES } from "../src/config/races.config.js";
import { CIVIC_IDS } from "../src/config/civicIds.js";
import { NIGHT_START, RESULTS_END } from "../src/config/election.js";

const CIVIC = "https://civicapi.org/api/v2/race";
const TIMEOUT_MS = 6000;
const DEADLINE_MS = 20000; // no new fetches after this; unreached races keep last-known-good
const CONCURRENCY = 8;
const MAX_REQUESTS = 44; // leaves headroom under the 50-subrequest cap
const RETRY_DELAY_MS = 750;

// Results window: first poll close through mid-December (counting continues for
// days after election night, e.g. California). Constants come from the shared
// src/config/election.js (also used by src/lib/electionNight.js).
export { NIGHT_START };
export const inResultsWindow = (now) => now >= NIGHT_START && now < RESULTS_END;

// Cache-Control for /api/results. Before the window the (empty) response may be
// cached, but never past NIGHT_START: a client with a fast clock fetching just
// before 6 PM must not keep the empty payload for an hour.
export function resultsCacheControl(now) {
  if (inResultsWindow(now)) return "public, max-age=30";
  const secs = Math.ceil((NIGHT_START - now) / 1000);
  return `public, max-age=${now < NIGHT_START ? Math.max(5, Math.min(3600, secs)) : 3600}`;
}

// Lowercase, accents stripped, whitespace collapsed ("Pete  Ricketts" -> "pete ricketts").
const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

// Last word of a name: "Monica De La Cruz" -> "cruz", "Cindy Hyde-Smith" -> "hyde-smith".
const surname = (s) => norm(s).split(" ").pop();

async function fetchRace(id) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${CIVIC}/${id}`, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`civicapi ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// Assign a civicAPI race's candidates to our two sides. Exact full name first, then
// a surname that is unique among the candidates ("Dan Sullivan" vs a second
// "Daniel J. Jr. Sullivan" on the AK ballot would otherwise be a coin flip); party
// only as a fallback for a side the name missed (and never reusing a candidate).
export function matchSides(race, cands) {
  const pick = (want) => {
    const exact = cands.find((c) => norm(c.name) === norm(want));
    if (exact) return exact;
    const sn = cands.filter((c) => surname(c.name) === surname(want));
    return sn.length > 1 ? undefined : sn[0];
  };
  let dem = pick(race.candidates.dem);
  let rep = pick(race.candidates.rep);
  const byParty = (party, taken) =>
    cands.find((c) => c.party === party && c !== taken && c !== dem && c !== rep);
  if (!dem) dem = byParty("Democratic");
  if (!rep) rep = byParty("Republican");
  return { dem, rep };
}

const side = (c) => (c ? { name: c.name.replace(/\s+/g, " ").trim(), votes: Number(c.votes) || 0, percent: Number(c.percent) || 0 } : null);

// Compact entry for one watched race from its civicAPI summary.
function toEntry(race, summary, updated) {
  const { dem, rep } = matchSides(race, summary.candidates || []);
  const winner = dem?.winner ? "D" : rep?.winner ? "R" : null; // a third-party winner -> null
  return { pct: Number(summary.percent_reporting) || 0, dem: side(dem), rep: side(rep), winner, updated };
}

// Run `fn` over `items` with at most `limit` in flight.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// `now` is injectable for tests; outside the results window nothing is fetched.
// `maxRequests` caps subrequests (Workers: 44; Vercel can afford all). `includeTest`
// keeps civicAPI's pre-election test_data records, which are skipped by default so
// placeholder numbers never show as real counts.
export async function getAllResults({ now = Date.now(), maxRequests = MAX_REQUESTS, includeTest = false } = {}) {
  if (!inResultsWindow(now)) return { races: {}, lastUpdated: null };

  const updated = new Date(now).toISOString();
  const races = {};
  // Senate first; House in random order, so when civicAPI is slow and the deadline
  // or budget cuts a pass short, a different set of districts gets refreshed each
  // time (the Pages Function's last-known-good cache keeps the rest).
  const house = WATCHED_RACES.house.map((r) => ({ key: r.code, race: r, k: Math.random() }));
  house.sort((a, b) => a.k - b.k);
  const todo = [...WATCHED_RACES.senate.map((r) => ({ key: r.stateCode, race: r })), ...house]
    .filter((t) => CIVIC_IDS[t.key])
    .slice(0, maxRequests);
  const deadline = Date.now() + DEADLINE_MS;

  // civicAPI 502s intermittently under election-night load, so races that failed
  // get one retry after a short pause, within whatever budget is left.
  const failed = [];
  const fetchOne = async (t) => {
    if (Date.now() > deadline) return;
    try {
      const rec = await fetchRace(CIVIC_IDS[t.key]);
      if (rec.test_data === true && !includeTest) return;
      races[t.key] = toEntry(t.race, rec, updated);
    } catch {
      failed.push(t); // left out unless the retry lands; the client keeps "no data"
    }
  };
  await mapLimit(todo, CONCURRENCY, fetchOne);
  const retry = failed.splice(0).slice(0, Math.max(0, maxRequests - todo.length));
  if (retry.length && Date.now() + RETRY_DELAY_MS < deadline) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    await mapLimit(retry, CONCURRENCY, fetchOne);
  }

  return { races, lastUpdated: updated };
}

// Merge a fresh /api/results payload over an earlier one, race by race: a race the
// fresh fetch got replaces the old entry, and a race it missed (civicAPI error)
// keeps its last known counts and call instead of disappearing. Used by the Pages
// Function's last-known-good cache; the client does the same across its polls.
export function mergeResults(prev, fresh) {
  const races = { ...prev?.races, ...fresh?.races };
  return { races, lastUpdated: fresh?.lastUpdated ?? prev?.lastUpdated ?? null };
}
