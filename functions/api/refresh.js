// Scheduled warmer for the Workers KV data layer (see docs/kv-warmer-plan.md).
// A token-gated cron endpoint (driven by the Cloudflare Cron Trigger Worker in
// cron-worker/; .github/workflows/refresh.yml is the manual trigger) that fills the
// aggregate KV keys the read path in functions/api/[[route]].js serves from, so
// user reads hit KV and scale independently of the rate-limited free upstreams.
//
// MARKETS — ORIGIN-MIRROR: fetching Kalshi/Polymarket/VoteHub directly from the
// warmer blows the free Workers 50-subrequest cap, because Cloudflare's shared,
// rate-limited egress IP fans each fetch into many retried subrequests. So for the
// market/poll keys we instead pull the already-assembled JSON from a clean-IP
// origin that has done that work — the app's Vercel deployment, whose egress isn't
// rate-limited. Each key is then one reliable subrequest. WARM_ORIGIN overrides the
// default origin (a Pages env var).
//
// NEWS — DIRECT, SLOW: news is the opposite case. GNews is key-based and NOT
// IP-rate-limited (that's why the app moved off the IP-blocked Google RSS), but it
// has a hard ~100 requests/day free quota. So news is fetched DIRECTLY here with
// Cloudflare's own NEWS_API_KEY (no dependency on the origin having a news key) and
// warmed on a SEPARATE, infrequent schedule (the cron's `news` group, ~every 4h).
// Warming every 15 min would have blown the quota. NOTE the call count is sized
// against the state count: each run fetches at most NEWS_STATES_PER_RUN (12) states,
// rotating through the list, so 12 x 6 runs = ~72 calls/day leaves room for the 429
// retries below no matter how many states are watched (at 16 states each one is
// refreshed in 3 of every 4 runs). A guard keeps
// the last-good news in KV if a whole run comes back empty (transient GNews
// failure), and a single state that fails keeps its previous articles.
//
// Pages routes this static file ahead of the [[route]] catch-all, so /api/refresh
// lands here.

import { WATCHED_RACES } from "../../src/config/races.config.js";
import { getRaceNews } from "../../api/_news.js";
import { NIGHT_START } from "../../api/_results.js";
import { MORNING_AT } from "../../src/config/election.js";
import { PARTY_IDS } from "../../src/config/president.config.js";
import { mergeNominationLastGood, nominationHasHoles } from "../../api/_nomination.js";
import { mergePrimaryPollsLastGood, primaryPollsHaveHoles } from "../../api/_primaryPolls.js";

const SENATE_STATES = WATCHED_RACES.senate.map((r) => r.stateCode);

// Per-run caps for the per-state groups that don't fit every state in one run.
// Histories: half the states per 15-min markets run (5 core + N races + N/2
// histories fetches + 16 KV ops stays under the budget at 16 states), so each
// state's history refreshes every 30 min. News: see the GNews quota note above.
const HISTORY_STATES_PER_RUN = Math.ceil(SENATE_STATES.length / 2);
const NEWS_STATES_PER_RUN = 12;
const MARKETS_TICK_MS = 15 * 60 * 1000; // cron-worker: */15 * * * *
const NEWS_TICK_MS = 4 * 60 * 60 * 1000; // cron-worker: 7 */4 * * *

// `count` consecutive states starting where the previous tick left off (wrapping),
// so successive cron runs walk the whole list. Missing states are carried over
// from the previous KV value by writeKey's fillKeys.
function rotation(list, count, tickMs) {
  if (count >= list.length) return list;
  const start = (Math.floor(Date.now() / tickMs) * count) % list.length;
  return Array.from({ length: count }, (_, i) => list[(start + i) % list.length]);
}

const DEFAULT_ORIGIN = "https://2028-election-tracker.vercel.app"; // TODO(2028): confirm host

// writeKey options for the { [stateCode]: value } aggregates.
const BY_STATE = { merge: true, fillKeys: SENATE_STATES };

// Presidential nomination histories ride inside the `histories` aggregate under
// `president-<party>` keys (the read path indexes them the same way), so they cost
// no extra KV keys. One party is warmed per markets tick, alternating, so each
// party refreshes every 30 min.
const PRES_PREFIX = "president-";
const PRES_HISTORY_KEYS = PARTY_IDS.map((p) => PRES_PREFIX + p);
const HISTORIES = { merge: true, fillKeys: [...SENATE_STATES, ...PRES_HISTORY_KEYS] };
// `nomination` / `primary-polls` are { dem, rep } payloads: the generic last-good
// merge only understands the two-sided shapes, so they bring their own.
const NOMINATION = { merge: true, holes: nominationHasHoles, combine: mergeNominationLastGood };
const PRIMARY_POLLS = { merge: true, holes: primaryPollsHaveHoles, combine: mergePrimaryPollsLastGood };

// ?only= groups. `markets` = everything the origin serves (core + races +
// histories), warmed frequently. `news` is warmed on its own slow schedule. `all`
// = markets + news (for a local full warm; at 12+ states it no longer fits the
// subrequest budget, so the guard below skips the tail of the news pass). The
// granular core/races/histories groups remain as a safety valve.
const GROUPS = ["all", "markets", "core", "races", "histories", "news"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

// Rough item count for the cron summary — array length, object key count, or 1.
function countOf(data) {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") return Object.keys(data).length;
  return data == null ? 0 : 1;
}

// ---- Election Day morning snapshot -----------------------------------------
// From 6 AM ET on Election Day the first warm run records which side the markets
// favor in every watched race (`bootstrap.morning`, { GA: "D", "NY-17": "R", ... }).
// The results-mode map outlines each state in that color all night, so it has to be
// frozen before the votes move the odds. Same average-of-sources rule as
// morningFavorite() in src/lib/calls.js. It lives in the bootstrap value that is
// already read and written each run, so it costs no extra KV ops.
// MORNING_AT (6 AM ET on election day) comes from src/config/election.js.

function favoriteOf(sources) {
  const live = (sources || []).filter((s) => s && s.demYes != null && s.repYes != null);
  if (!live.length) return null;
  const avg = (key) => live.reduce((sum, s) => sum + s[key], 0) / live.length;
  const dem = avg("demYes");
  const rep = avg("repYes");
  return dem === rep ? null : dem > rep ? "D" : "R";
}

// { code: "D" | "R" } for the watched races that have odds in `merged` (this run's
// pieces laid over the previous value, so a piece that failed this run still counts).
function morningSnapshot(merged) {
  const morning = {};
  for (const r of WATCHED_RACES.senate) {
    const f = favoriteOf(merged.races?.[r.stateCode]?.sources);
    if (f) morning[r.stateCode] = f;
  }
  for (const d of WATCHED_RACES.house) {
    const f = favoriteOf(merged.houseRaces?.[d.code]?.sources);
    if (f) morning[d.code] = f;
  }
  return morning;
}

// ---- Subrequest budget ----------------------------------------------------
// Free Workers allow 50 subrequests per invocation, and KV get/put count too.
// Past the cap every further call throws (error 1027), which would lose the KV
// writes at the end of the run. So each run gets a budget that:
//   - always holds back enough for the KV reads/writes still to come,
//   - lets a planned fetch's FIRST attempt go ahead whenever that reserve allows,
//   - lets a RETRY go ahead only if every planned first attempt still fits too.
// When the origin is healthy nothing is skipped. When it's down, retries stop
// first, then later fetches are skipped (recorded as failures, so last-good
// merging keeps their previous KV values) and the writes still land.
const SUBREQUEST_CAP = 50;
const SUBREQUEST_BUDGET = SUBREQUEST_CAP - 3; // headroom for anything uncounted

function createBudget(plannedFetches, kvReserve) {
  return {
    used: 0,
    skipped: 0,
    pending: plannedFetches, // planned fetches not yet attempted
    kvReserve, // KV ops still expected (upper bound)
    tryFirst() {
      this.pending = Math.max(0, this.pending - 1);
      if (this.used + 1 + this.kvReserve > SUBREQUEST_BUDGET) {
        this.skipped++;
        return false;
      }
      this.used++;
      return true;
    },
    tryRetry() {
      if (this.used + 1 + this.kvReserve + this.pending > SUBREQUEST_BUDGET) return false;
      this.used++;
      return true;
    },
    kvOp() {
      this.used++;
      this.kvReserve = Math.max(0, this.kvReserve - 1);
    },
    // An expected KV op that turned out not to be needed (e.g. no merge read).
    release(n = 1) {
      this.kvReserve = Math.max(0, this.kvReserve - n);
    },
  };
}

// KV namespace wrapper that charges every get/put to the budget.
function budgetedKv(kv, budget) {
  return {
    budget,
    get: (...a) => (budget.kvOp(), kv.get(...a)),
    put: (...a) => (budget.kvOp(), kv.put(...a)),
  };
}

// Take one fetch attempt from the budget; throws on a skipped first attempt,
// returns false when a retry isn't affordable.
function spendAttempt(budget, i, what) {
  if (i === 0) {
    if (!budget.tryFirst()) throw new Error(`${what}: skipped (subrequest budget)`);
    return true;
  }
  return budget.tryRetry();
}

// Fetch JSON from the origin with a light retry (the origin is reliable, so this
// is for transient hiccups/cold starts, not the upstream rate-limit storms the
// direct path suffered). Don't retry 4xx other than 429.
async function fetchJson(url, budget, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    if (!spendAttempt(budget, i, url)) break;
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (r.ok) return r.json();
      lastErr = new Error(`${url} -> ${r.status}`);
      if (r.status < 500 && r.status !== 429) break;
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await sleep(400);
  }
  throw lastErr;
}

// ---- Last-good merging ----------------------------------------------------
// The origin answers 200 even when an upstream failed underneath it: a Kalshi
// hiccup comes back as a source with demYes:null / points:[], a VoteHub miss as
// dem:null, a GNews 429 as articles:[]. Written as-is, that would overwrite a
// good KV value with a hole for a whole cron interval. So before writing, each
// empty piece is replaced by the same piece from the previous KV value (when that
// one had data). Carried-forward pieces keep their own lastUpdated, so staleness
// stays visible per source rather than being hidden under a fresh envelope.
const isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);

function sourceHasData(s) {
  if (!isPlainObject(s)) return false;
  if (Array.isArray(s.points)) return s.points.length > 0; // history series
  return s.demYes != null || s.repYes != null; // current odds
}

// A leaf value (poll average / news entry) that came back empty.
function isEmptyLeaf(o) {
  if (!isPlainObject(o)) return o == null;
  if ("dem" in o) return o.dem == null && o.rep == null; // race poll / generic ballot
  if ("approve" in o) return o.approve == null && o.disapprove == null; // approval
  if (Array.isArray(o.articles)) return o.articles.length === 0; // news
  return false;
}

// Does `next` contain any hole that `prev` could fill? Lets writeKey skip the
// extra KV read on a clean run (the free-tier subrequest budget is tight).
function hasHoles(next) {
  if (next == null) return true;
  if (!isPlainObject(next)) return false;
  if (Array.isArray(next.sources)) return next.sources.some((s) => !sourceHasData(s));
  if (isEmptyLeaf(next)) return true;
  return Object.values(next).some((v) => isPlainObject(v) && hasHoles(v));
}

// Merge `next` over `prev`, keeping prev's piece wherever next's is empty. Only
// keys present in `next` are kept (except `fillKeys`, see below), so an entry
// dropped from the config doesn't linger forever.
function mergeLastGood(prev, next) {
  if (next == null) return prev;
  if (!isPlainObject(next) || !isPlainObject(prev)) return next;
  if (Array.isArray(next.sources)) {
    const prevById = new Map((prev.sources || []).map((s) => [s?.id, s]));
    return {
      ...next,
      sources: next.sources.map((s) => {
        const old = prevById.get(s?.id);
        return !sourceHasData(s) && sourceHasData(old) ? old : s;
      }),
    };
  }
  if (isEmptyLeaf(next) && !isEmptyLeaf(prev)) return prev;
  const out = {};
  for (const [k, v] of Object.entries(next)) out[k] = mergeLastGood(prev[k], v);
  return out;
}

async function readPrev(kv, key) {
  try {
    return JSON.parse(await kv.get(key))?.data;
  } catch {
    return undefined; // no/unreadable previous value
  }
}

// Fetch one aggregate value and write it to KV as a { data, updatedAt } envelope
// (so the read path can observe staleness). Never throws: a failed key is recorded
// in the summary and the remaining keys still run/write. Returns the data on
// success (so callers can compose the bootstrap key from it), undefined on failure.
//
// Options:
//   merge     - fill empty pieces from the previous KV value (see mergeLastGood).
//   fillKeys  - top-level keys (the senate states, for by-state aggregates) that
//               are carried over from the previous value when this run lacks
//               them entirely, e.g. one state's origin fetch failed.
async function writeKey(
  kv,
  summary,
  key,
  produce,
  { merge = false, fillKeys = [], holes = hasHoles, combine = mergeLastGood } = {}
) {
  let produced = false;
  try {
    let data = await produce();
    produced = true;
    const missing = fillKeys.filter((k) => data?.[k] == null);
    const needsMerge = merge && (missing.length > 0 || holes(data));
    if (merge && !needsMerge) kv.budget?.release(1); // the reserved read isn't needed
    if (needsMerge) {
      const prev = await readPrev(kv, key);
      if (prev != null) {
        data = combine(prev, data);
        for (const k of missing) if (prev[k] != null) data[k] = prev[k];
        summary.carried.push(key);
      }
    }
    await kv.put(key, JSON.stringify({ data, updatedAt: Date.now() }));
    summary.written.push(key);
    summary.counts[key] = countOf(data);
    return data;
  } catch (e) {
    // Nothing fetched -> neither the merge read nor the write will happen.
    if (!produced) kv.budget?.release(merge ? 2 : 1);
    summary.failures.push(`${key}: ${String(e?.message || e)}`);
    return undefined;
  }
}

// Build a { [stateCode]: value } aggregate by calling `perState` for each of
// `states` SEQUENTIALLY (paced). Per-state try/catch records failures and keeps going;
// writeKey's fillKeys then carries a failed state over from the previous KV value
// (the read path only live-falls-back for a state KV has never had). The stored value
// is exactly what the per-state route/provider returns, so the read path indexes
// it directly.
async function buildByState(label, states, perState, summary) {
  const out = {};
  for (const st of states) {
    try {
      const v = await perState(st);
      if (v != null) out[st] = v;
      else summary.failures.push(`${label}:${st}: null`);
    } catch (e) {
      summary.failures.push(`${label}:${st}: ${String(e?.message || e)}`);
    }
  }
  return out;
}

// GNews' free tier rate-limits bursts: in a rapid sequence only the first request
// lands and the rest 429. So fetch news for one state with strict mode (throws on a
// 429 instead of swallowing it to empty) and retry with backoff. The caller also
// paces between states; this retry just catches stragglers.
async function newsForState(st, newsKey, budget) {
  const RETRIES = 3;
  for (let attempt = 0; ; attempt++) {
    try {
      // getRaceNews makes exactly one fetch per call.
      if (!spendAttempt(budget, attempt, `news:${st}`)) throw new Error(`news:${st}: retry skipped (subrequest budget)`);
      return await getRaceNews(st, newsKey, { strict: true });
    } catch (e) {
      if (attempt >= RETRIES || /subrequest budget/.test(e?.message)) throw e;
      await sleep(1200 * (attempt + 1) + Math.floor(Math.random() * 400));
    }
  }
}

async function runGroup(group, origin, newsKey, rawKv, summary) {
  // `markets` (and `all`) warm everything the origin serves; news is separate.
  const markets = group === "all" || group === "markets";
  const doCore = markets || group === "core";
  const doRaces = markets || group === "races";
  const doHistories = markets || group === "histories";
  const doNews = group === "all" || group === "news";

  // Plan the run for the subrequest budget: one fetch per core endpoint / state,
  // and up to two KV ops (merge read + write) per key, bootstrap included.
  const N = SENATE_STATES.length;
  const historyStates = rotation(SENATE_STATES, HISTORY_STATES_PER_RUN, MARKETS_TICK_MS);
  const newsStates = rotation(SENATE_STATES, NEWS_STATES_PER_RUN, NEWS_TICK_MS);
  const presParties = rotation(PARTY_IDS, 1, MARKETS_TICK_MS);
  const historyKeys = [...historyStates, ...presParties.map((p) => PRES_PREFIX + p)];
  // Core: 7 origin fetches (control, control-history, polls, house-races, race-polls,
  // nomination, primary-polls) and 7 keys x (merge read + write) = 14 KV ops.
  const b = createBudget(
    (doCore ? 7 : 0) + (doRaces ? N : 0) + (doHistories ? historyKeys.length : 0) + (doNews ? newsStates.length : 0),
    (doCore ? 14 : 0) + (doRaces ? 2 : 0) + (doCore || doRaces ? 2 : 0) + (doHistories ? 2 : 0) + (doNews ? 2 : 0)
  );
  const kv = budgetedKv(rawKv, b);

  // First-paint pieces captured as they're warmed, then composed into the
  // `bootstrap` KV key below so the client's initial load is ONE request
  // (/api/bootstrap) instead of ~13. control-history/histories/news stay out —
  // the client loads those lazily.
  const pieces = {};

  if (doCore) {
    // Origin endpoints that are already aggregated server-side -> one fetch each.
    const merge = { merge: true };
    pieces.control = await writeKey(kv, summary, "control", () => fetchJson(`${origin}/api/control`, b), merge);
    await writeKey(kv, summary, "control-history", () => fetchJson(`${origin}/api/control-history`, b), merge);
    pieces.polls = await writeKey(kv, summary, "polls", () => fetchJson(`${origin}/api/polls`, b), merge);
    pieces.houseRaces = await writeKey(kv, summary, "house-races", () => fetchJson(`${origin}/api/house-races`, b), merge);
    pieces.racePolls = await writeKey(kv, summary, "race-polls", () => fetchJson(`${origin}/api/race-polls`, b), merge);
    // 2028 presidential primaries: { dem, rep } each, composed into bootstrap.president.
    pieces.nomination = await writeKey(kv, summary, "nomination", () => fetchJson(`${origin}/api/nomination`, b), NOMINATION);
    pieces.primaryPolls = await writeKey(kv, summary, "primary-polls", () => fetchJson(`${origin}/api/primary-polls`, b), PRIMARY_POLLS);
  }
  if (doRaces) {
    pieces.races = await writeKey(
      kv,
      summary,
      "races",
      () => buildByState("races", SENATE_STATES, (st) => fetchJson(`${origin}/api/race?state=${st}`, b), summary),
      BY_STATE
    );
  }
  if (doCore || doRaces) {
    // Merge this run's pieces over the previous bootstrap value so a piece that
    // failed this run (or a granular core/races-only run) never wipes a
    // previously-good piece. Empty results count as failed, same idea as the
    // news last-good guard.
    await writeKey(kv, summary, "bootstrap", async () => {
      let prev = {};
      try {
        prev = JSON.parse(await kv.get("bootstrap"))?.data || {};
      } catch {
        // no/unreadable previous value -> start fresh
      }
      const merged = { ...prev };
      const { nomination, primaryPolls, ...firstPaint } = pieces;
      for (const [k, v] of Object.entries(firstPaint)) {
        if (v != null && countOf(v) > 0) merged[k] = v;
      }
      // president = { nomination, primaryPolls }, each carried forward independently.
      const president = { ...prev.president };
      if (nomination != null) president.nomination = nomination;
      if (primaryPolls != null) president.primaryPolls = primaryPolls;
      if (Object.keys(president).length) merged.president = president;
      // `morning` is carried forward by the `...prev` spread. Until polls open, each
      // run fills in races the snapshot is missing (odds that weren't loaded at 6 AM);
      // existing keys are never overwritten.
      const now = Date.now();
      if (now >= MORNING_AT && now < NIGHT_START) {
        const fresh = morningSnapshot(merged);
        const morning = { ...fresh, ...merged.morning };
        if (Object.keys(morning).length) merged.morning = morning;
      }
      return merged;
    });
  }
  if (doHistories) {
    await writeKey(
      kv,
      summary,
      "histories",
      () =>
        buildByState(
          "histories",
          historyKeys,
          (k) =>
            fetchJson(
              k.startsWith(PRES_PREFIX)
                ? `${origin}/api/nomination-history?party=${k.slice(PRES_PREFIX.length)}`
                : `${origin}/api/history?state=${k}`,
              b
            ),
          summary
        ),
      HISTORIES
    );
  }
  if (doNews) {
    // News is fetched DIRECTLY from GNews with Cloudflare's own key (not via the
    // origin), and GNews 429s rapid bursts, so walk the states SEQUENTIALLY with a
    // pause between each so every call lands (vs. only the first one). This runs on
    // its own slow ~4h schedule so the <=12 calls/run stay under GNews' daily quota.
    const news = {};
    for (let i = 0; i < newsStates.length; i++) {
      const st = newsStates[i];
      if (i > 0) await sleep(1200); // pace so we stay under GNews' per-second/burst limit
      try {
        news[st] = await newsForState(st, newsKey, b);
      } catch (e) {
        summary.failures.push(`news:${st}: ${String(e?.message || e)}`);
      }
    }
    const hasAny = Object.values(news).some((d) => (d?.articles?.length || 0) > 0);
    if (hasAny) {
      // Merge per state so a state that 429'd this run keeps its last-good
      // articles instead of dropping out (which would send its readers to a live
      // GNews call and burn the daily quota).
      await writeKey(kv, summary, "news", async () => news, BY_STATE);
    } else {
      // Whole run came back empty -> almost certainly a transient GNews failure or
      // a missing key, not 11 genuinely newsless races. Keep the last-good KV value.
      summary.failures.push("news: all states empty — kept previous KV value (verify NEWS_API_KEY)");
      b.release(2);
    }
  }
  summary.subrequests = { used: b.used, skipped: b.skipped, cap: SUBREQUEST_CAP };
}

// Handle any method (the cron may GET or POST). Auth is a shared secret compared
// against env.REFRESH_TOKEN, passed as the X-Refresh-Token header or ?token=.
export async function onRequest({ request, env }) {
  const token = env?.REFRESH_TOKEN;
  // No token configured -> deny rather than expose an open warmer (e.g. local dev
  // or before the Pages secret is set). The cron simply can't run until it's set.
  if (!token) return json({ error: "refresh not configured (no REFRESH_TOKEN)" }, 503);

  const url = new URL(request.url);
  const provided = request.headers.get("x-refresh-token") || url.searchParams.get("token") || "";
  if (provided !== token) return json({ error: "unauthorized" }, 401);

  const kv = env?.MARKET_CACHE;
  if (!kv) return json({ error: "no MARKET_CACHE binding" }, 503);

  const origin = (env.WARM_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, "");
  const group = (url.searchParams.get("only") || "all").toLowerCase();
  if (!GROUPS.includes(group)) {
    return json({ error: `unknown group '${group}' (use ${GROUPS.join("|")})` }, 400);
  }

  const summary = {
    group,
    origin,
    startedAt: new Date().toISOString(),
    written: [],
    carried: [], // keys where empty pieces were filled from the previous KV value
    counts: {},
    failures: [],
  };
  await runGroup(group, origin, env.NEWS_API_KEY, kv, summary);
  summary.finishedAt = new Date().toISOString();

  // 207 (Multi-Status) when some keys failed but others were written, so the cron
  // logs surface partial refreshes without treating them as total failures.
  return json(summary, summary.failures.length ? 207 : 200);
}
