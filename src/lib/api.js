import { MARKET_RANGES } from "./ranges";

// Client-side helpers that hit our serverless proxy (/api/*), which normalizes
// Kalshi + Polymarket into { sources: [{ id, label, demYes, repYes, lastUpdated }] }.
//
// Everything the first paint needs comes from ONE /api/bootstrap request
// ({ control, polls, racePolls, houseRaces, races }); each fetcher below reads
// its piece out of that shared payload and only falls back to its individual
// endpoint when the piece is missing (bootstrap cold/unavailable). That keeps a
// fresh visit to ~1 API request instead of ~13 — which is what the free-tier
// Cloudflare quotas are budgeted around. History and news stay lazy per drawer.
//
// Responses are memoized per session; refreshData() (driven by useAutoRefresh)
// swaps in a newer bootstrap, clears those caches and bumps the data version so
// mounted components re-fetch.

// Every request gives up after this long, so a hung upstream can't leave the
// loading screen or a skeleton up indefinitely; callers treat it as an error.
const REQUEST_TIMEOUT_MS = 15000;

async function getJson(url, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`${label} ${r.status}`);
    return await r.json();
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`${label} timed out`, { cause: e });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Live-data version --------------------------------------------------
// `dataVersion` bumps each time refreshData() lands newer data; components
// subscribe (see src/lib/liveData.js) and include it in their fetch effects.
// `dataAsOf` is bootstrap's updatedAt (ms): when the KV warmer last wrote it.
let dataVersion = 0;
let dataAsOf = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export function subscribeData(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const getDataVersion = () => dataVersion;
export const getDataAsOf = () => dataAsOf;

function noteAsOf(boot) {
  const t = Number(boot?.updatedAt);
  if (Number.isFinite(t) && t !== dataAsOf) {
    dataAsOf = t;
    emit();
  }
}

// Memoize a promise per key; drop it on failure so a later call can retry.
function memoize(map, key, make) {
  if (!map.has(key)) {
    map.set(
      key,
      make().catch((e) => {
        map.delete(key);
        throw e;
      })
    );
  }
  return map.get(key);
}

// The shared first-paint payload. Resolves to null on any failure (404 on an old
// deploy, 503 cold KV, network) so callers just fall back to their own endpoint;
// not memoized via memoize() because null is a valid "don't retry per caller"
// result — retrying bootstrap 13 times would defeat its purpose.
let bootstrapPromise = null;
function fetchBootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = getJson("/api/bootstrap", "bootstrap")
      .then((b) => (noteAsOf(b), b))
      .catch(() => null);
  }
  return bootstrapPromise;
}

// Serve a piece from the bootstrap payload, else from its individual endpoint.
async function fromBootstrap(pick, live) {
  const boot = await fetchBootstrap();
  const v = boot ? pick(boot) : undefined;
  return v != null ? v : live();
}

export function fetchControl() {
  return fromBootstrap(
    (b) => b.control,
    () => getJson("/api/control", "control")
  );
}

// Macro polling averages + trend: { genericBallot:{dem,rep,n,lastUpdated,trend}, approval:{...} }
export function fetchPolls() {
  return fromBootstrap(
    (b) => b.polls,
    () => getJson("/api/polls", "polls")
  );
}

// ---- 2028 presidential primaries (N-candidate) ----
// Nomination odds ({ party, updatedAt, candidates:[{id,name,polymarket,kalshi,avg}],
// sources }) and national primary polling ({ party, method, lastUpdated, n,
// candidates:[{id,name,pct,lower,upper}], trend, recentPolls }) per party ("dem"|"rep").
// Both come out of bootstrap.president; history is lazy per party + range.
const nominationCache = new Map();
export function fetchNomination(party) {
  return memoize(nominationCache, party, () =>
    fromBootstrap(
      (b) => b.president?.nomination?.[party],
      () => getJson(`/api/nomination?party=${encodeURIComponent(party)}`, "nomination")
    )
  );
}

const primaryPollsCache = new Map();
export function fetchPrimaryPolls(party) {
  return memoize(primaryPollsCache, party, () =>
    fromBootstrap(
      (b) => b.president?.primaryPolls?.[party],
      () => getJson(`/api/primary-polls?party=${encodeURIComponent(party)}`, "primary-polls")
    )
  );
}

// { party, range, candidates:[{id,name}], sources:[{ id, label, points:[{t,<candidateId>:pct}], hasData }] }
const nominationHistoryCache = new Map();
export function fetchNominationHistory(party, range = "all") {
  return memoize(nominationHistoryCache, `${party}:${range}`, () =>
    getJson(
      `/api/nomination-history?party=${encodeURIComponent(party)}&range=${encodeURIComponent(range)}`,
      "nomination-history"
    )
  );
}

// Win-probability history for the control markets: { senate:{sources}, house:{sources} }
// Memoized per range (default "all") so switching ranges back and forth in the
// same session doesn't re-fetch — mirrors fetchRaceHistory below.
const controlHistoryCache = new Map();
export function fetchControlHistory(range = "all") {
  return memoize(controlHistoryCache, range, () =>
    getJson(`/api/control-history?range=${encodeURIComponent(range)}`, "control-history")
  );
}

const oddsCache = new Map();
export function fetchRaceOdds(stateCode) {
  return memoize(oddsCache, stateCode, () =>
    fromBootstrap(
      (b) => b.races?.[stateCode],
      () => getJson(`/api/race?state=${encodeURIComponent(stateCode)}`, "race")
    )
  );
}

// Historical win-probability time-series per provider: { sources: [{ id, label, points:[{t,dem,rep}], hasData }] }
// Keyed by stateCode + range so each window is cached independently per race.
const historyCache = new Map();
export function fetchRaceHistory(stateCode, range = "all") {
  return memoize(historyCache, `${stateCode}:${range}`, () =>
    getJson(
      `/api/history?state=${encodeURIComponent(stateCode)}&range=${encodeURIComponent(range)}`,
      "history"
    )
  );
}

// Recent news headlines per state: { stateCode, articles:[{title,link,source,publishedAt}], lastUpdated }
const newsCache = new Map();
export function fetchRaceNews(stateCode) {
  return memoize(newsCache, stateCode, () =>
    getJson(`/api/race-news?state=${encodeURIComponent(stateCode)}`, "race-news")
  );
}

// Live vote counts for every watched race, { races: { GA: {...}, "NY-17": {...} },
// lastUpdated } (see api/_results.js). Not memoized or bootstrapped: useResults()
// polls it during the results window only.
export const fetchResults = () => getJson("/api/results", "results");

// The Election Day morning market favorites, { GA: "D", "NY-17": "R", ... }, that the
// KV warmer snapshots into the bootstrap payload (see functions/api/refresh.js);
// null until it exists (before that morning, local dev, or bootstrap unavailable).
export async function fetchMorning() {
  const boot = await fetchBootstrap();
  return boot?.morning ?? null;
}

// Current odds for every watched House district, batched into one request:
// { "CA-41": { code, sources:[...] }, ... }
let houseRacesPromise = null;
export function fetchHouseRaces() {
  if (!houseRacesPromise) {
    houseRacesPromise = fromBootstrap(
      (b) => b.houseRaces,
      () => getJson("/api/house-races", "house-races")
    ).catch((e) => {
      houseRacesPromise = null;
      throw e;
    });
  }
  return houseRacesPromise;
}

// Per-state senate polling is batched: one /api/race-polls fetch returns every state,
// so we download VoteHub's full poll list once instead of per drawer open.
let allRacePollsPromise = null;
function fetchAllRacePolls() {
  if (!allRacePollsPromise) {
    allRacePollsPromise = fromBootstrap(
      (b) => b.racePolls,
      () => getJson("/api/race-polls", "race-polls")
    ).catch((e) => {
      allRacePollsPromise = null;
      throw e;
    });
  }
  return allRacePollsPromise;
}

// { stateCode, dem, rep, n, lastUpdated, trend:[{t,dem,rep}] }
export async function fetchRacePolls(stateCode) {
  const all = await fetchAllRacePolls();
  return (
    all[stateCode] || { stateCode, dem: null, rep: null, n: 0, lastUpdated: null, trend: [] }
  );
}

// Market-range ids in fetch order.
const MARKET_RANGE_IDS = MARKET_RANGES.map((r) => r.id);

// Run `fn(id)` for every market range except `current` (already being fetched
// by the caller), one at a time. Sequential on purpose: 3 of the 5 ranges
// proxy through the Vercel origin, and bursting all 4 remaining requests at
// once per chart expand is exactly the kind of fan-out this file otherwise
// avoids (see prefetchRaces below) — the user is looking at `current` already,
// there's no rush on the rest. `shouldContinue`, if given, is checked before
// each request so a caller can abandon an in-flight sweep (e.g. the drawer
// moved to a different race) without it keeping firing requests in the
// background.
async function sweepMarketRanges(current, fn, shouldContinue) {
  for (const id of MARKET_RANGE_IDS) {
    if (id === current) continue;
    if (shouldContinue && !shouldContinue()) return;
    await fn(id).catch(() => {});
  }
}

// One sweep per key ("control", or `race:${stateCode}`) per session — the
// per-range memoization above already dedupes actual network calls, this just
// stops re-expanding the same panel from re-walking the range list.
const prefetchedSweeps = new Set();

// Schedule a sweep off the critical path. Deliberately a plain timer and NOT
// requestIdleCallback: rIC never fires while the document is hidden, so
// opening the dashboard in a background tab (middle-click, "open in new tab")
// silently skipped the whole sweep. Timers still fire there — throttled, which
// is fine for a prefetch. The delay is belt-and-braces anyway: callers only
// invoke this once the fetch the user is actually waiting on has resolved.
//
// The dedupe key is claimed INSIDE the callback, not at schedule time, so a
// sweep that never got to run can't permanently mark itself done — that was
// the other half of the background-tab bug.
function scheduleSweep(key, current, fn, shouldContinue) {
  if (prefetchedSweeps.has(key)) return;
  setTimeout(() => {
    if (prefetchedSweeps.has(key)) return;
    if (shouldContinue && !shouldContinue()) return;
    prefetchedSweeps.add(key);
    sweepMarketRanges(current, fn, shouldContinue);
  }, 500);
}

// Quietly warm the other control-history ranges once the panel the user
// opened has loaded, so flipping Senate/House Control's range selector is
// instant. Called from MacroMetrics only after the current range's fetch
// succeeds — never on page load (bootstrap must stay the only request a
// visitor who never expands a chart pays for).
export function prefetchControlHistoryRanges(current = "all") {
  scheduleSweep("control", current, fetchControlHistory);
}

// Same idea for a race's provider history. `shouldContinue` lets RaceDrawer
// cancel an in-flight sweep when the user has since moved on to another race
// (see the drawer's effect) — without it, rapidly clicking through states
// with a chart expanded could leave several abandoned sweeps still issuing
// requests for races no longer on screen.
export function prefetchRaceHistoryRanges(stateCode, current = "all", shouldContinue) {
  scheduleSweep(
    `race:${stateCode}`,
    current,
    (id) => fetchRaceHistory(stateCode, id),
    shouldContinue
  );
}

// Warm the caches in the background on app load so drawers open quickly. All of
// these resolve off the single shared /api/bootstrap payload (extra network
// requests happen only for pieces bootstrap couldn't supply). History and news
// are loaded lazily when a drawer opens (RaceDrawer fetches them on open) —
// don't add them here: prefetching them for all 9 states at once bursts the
// upstreams on the live-fallback path.
export function prefetchRaces(stateCodes) {
  fetchAllRacePolls().catch(() => {});
  fetchHouseRaces().catch(() => {});
  for (const sc of stateCodes) {
    fetchRaceOdds(sc).catch(() => {});
  }
}

// True when a normalized source actually carries odds.
export function sourceHasData(s) {
  return Boolean(s && s.demYes != null && s.repYes != null);
}

// Re-fetch bootstrap and, if the warmer has written newer data since the one
// we hold, swap it in: every cache that derives from it (or that the warmer
// also refreshes, like history) is cleared and the data version bumps, so
// mounted components re-fetch and lazily-opened ones start fresh. News is left
// alone (warmed only every ~4h). Returns true when newer data landed.
export async function refreshData() {
  let boot;
  try {
    boot = await getJson("/api/bootstrap", "bootstrap");
  } catch {
    return false; // keep what we have; the next tick retries
  }
  const t = Number(boot?.updatedAt);
  if (!Number.isFinite(t) || (dataAsOf != null && t <= dataAsOf)) return false;
  bootstrapPromise = Promise.resolve(boot);
  oddsCache.clear();
  historyCache.clear();
  controlHistoryCache.clear();
  nominationCache.clear();
  primaryPollsCache.clear();
  nominationHistoryCache.clear();
  prefetchedSweeps.clear();
  houseRacesPromise = null;
  allRacePollsPromise = null;
  dataAsOf = t;
  dataVersion++;
  emit();
  return true;
}
