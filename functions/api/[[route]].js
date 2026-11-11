// Cloudflare Pages Functions entry for every /api/* request. Replaces the Vercel
// serverless handlers that used to live in /api/*.js: it reuses the same
// framework-agnostic providers (../../api/_providers.js, _polls.js, _news.js)
// unchanged and only adapts them to the Web Fetch (Request -> Response) signature
// that Pages Functions use instead of Vercel's Node-style (req, res).
//
// This single catch-all ([[route]] matches /api/control, /api/race?state=GA, ...)
// keeps one place to route from; the data/normalization logic stays shared with
// the Vite dev middleware so local dev and production behave identically.

import {
  getControl,
  getRace,
  getControlHistory,
  getRaceHistory,
  getAllHouseRaces,
  sliceSources,
} from "../../api/_providers.js";
import { getRacePolls, getAllRacePolls, getMacroPolls } from "../../api/_polls.js";
import { getNominationOdds, getAllNomination, getNominationHistory } from "../../api/_nomination.js";
import { getPrimaryPolls, getAllPrimaryPolls } from "../../api/_primaryPolls.js";
import { PARTIES, PARTY_IDS } from "../../src/config/president.config.js";
import { getRaceNews } from "../../api/_news.js";
import { getAllResults, inResultsWindow, mergeResults, resultsCacheControl } from "../../api/_results.js";

// Build a JSON Response, mirroring the Cache-Control values the Vercel handlers set.
function json(data, { status = 200, cache } = {}) {
  const headers = { "content-type": "application/json" };
  if (cache) headers["cache-control"] = cache;
  return new Response(JSON.stringify(data), { status, headers });
}

const missingState = () => json({ error: "missing ?state=" }, { status: 400 });
const badParty = (party) => json({ error: `unknown party ${party}` }, { status: 400 });
const unknownState =(state) => json({ error: `unknown state ${state}` }, { status: 404 });

// Market-history range plumbing (control-history + history routes). Intraday
// windows (30d/7d/24h) get a short cache since they're fetched on demand rather
// than served from the warmer's KV; all/90d keep the longer window (90d rides
// the same KV/"all" payload — see below).
const INTRADAY_RANGES = new Set(["30d", "7d", "24h"]);
const historyCacheFor = (range) =>
  INTRADAY_RANGES.has(range)
    ? "public, max-age=60, s-maxage=60, stale-while-revalidate=300"
    : "public, max-age=300, s-maxage=300, stale-while-revalidate=900";

// ORIGIN-MIRROR FOR INTRADAY, for the same reason /api/refresh uses it (see the
// header comment there): calling the providers directly from here means calling
// them from Cloudflare's shared, rate-limited egress IP. Kalshi hard-blocks it —
// verified in production, where every intraday range returned an empty Kalshi
// series (the PATIENT retry budget exhausting) while the identical request
// succeeded from a clean IP and from the Vercel origin. Polymarket tolerates the
// shared IP, which is why only the Kalshi half of those charts went blank.
//
// The all/90d paths never had this problem because they're served from KV, which
// the warmer fills by mirroring this same origin. So intraday does the mirroring
// inline instead: one reliable subrequest against a clean IP, still fresh (no KV
// staleness), and no new keys for the warmer to maintain.
const DEFAULT_ORIGIN = "https://2028-election-tracker.vercel.app"; // TODO(2028): confirm host

// Fetch one intraday payload from the clean-IP origin. Returns undefined on any
// failure so the caller can fall back to a direct provider call — degraded
// (Polymarket lands, Kalshi likely doesn't) but never a blank 500.
async function fromOrigin(env, path) {
  const origin = (env?.WARM_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, "");
  try {
    const r = await fetch(`${origin}${path}`, { headers: { Accept: "application/json" } });
    if (!r.ok) return undefined;
    return await r.json();
  } catch {
    return undefined;
  }
}

// LAST-KNOWN-GOOD RESULTS. civicAPI 502s a lot on election night, and each fetch
// only returns the races that got through, so without this a called race drops off
// the site whenever its fetch fails. The merged payload lives in this colo's edge
// Cache API (free, unlike KV writes, which the quota can't afford at this cadence).
// Every operation is best-effort: no cache (local dev, an error) means no merge.
const LAST_GOOD_KEY = "https://elections.ajaycent.com/__internal/results-last-good"; // TODO(2028): confirm host (2028 hostname undecided)

async function readLastGood() {
  try {
    const r = await caches.default.match(LAST_GOOD_KEY);
    return r ? await r.json() : undefined;
  } catch {
    return undefined;
  }
}

function writeLastGood(data) {
  try {
    return caches.default
      .put(
        LAST_GOOD_KEY,
        new Response(JSON.stringify(data), {
          headers: { "content-type": "application/json", "cache-control": "public, max-age=1209600" },
        })
      )
      .catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

// Read an aggregate key's { data, updatedAt } envelope from Workers KV (written
// by the scheduled warmer, /api/refresh). Returns undefined when there's nothing
// usable to serve — i.e. the binding is absent (local Vite dev has no env), the
// key is cold (before the first refresh), or the value can't be parsed. Every
// caller falls back to a live provider call in those cases, so a missing/empty
// KV never blanks a response.
async function kvGetEnvelope(env, key) {
  const kv = env?.MARKET_CACHE;
  if (!kv) return undefined;
  try {
    const raw = await kv.get(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// Just the `data` out of the envelope (what every route serves).
async function kvGet(env, key) {
  const envelope = await kvGetEnvelope(env, key);
  return envelope?.data;
}

// Serve an aggregate route from KV when warm, else fall back to its live provider
// call (cold KV / local dev). `live` is a zero-arg async producing the same shape.
async function served(env, key, live) {
  const cached = await kvGet(env, key);
  return cached !== undefined ? cached : await live();
}

// No response-level caching here: caching the whole endpoint result locks in
// any partial (a compute that hit a Kalshi 429 on some tickers would cache the
// half-null result for the TTL). Caching is done at the upstream-subrequest
// level instead (success-only) in _providers.js, so partials self-heal.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\//, "").replace(/\/+$/, "");
  const state = String(url.searchParams.get("state") || "").toUpperCase();

  // Per-state routes read their aggregate KV key ({ [stateCode]: value }) and
  // index by state; a miss (cold KV, local dev, or a state the warmer doesn't
  // cover — e.g. House news) falls back to the single-state provider call, which
  // returns null for a genuinely unknown state -> 404.
  const fromAgg = async (aggKey, live) => {
    const agg = await kvGet(env, aggKey);
    return agg && agg[state] !== undefined ? agg[state] : await live();
  };

  try {
    switch (route) {
      // One-shot first-paint payload: everything the client prefetches on load,
      // composed by the warmer into the `bootstrap` KV key. Serving it as a single
      // request (1 invocation + 1 KV read) instead of ~13 is what keeps the free
      // Pages/KV daily quotas viable under real traffic. If the composed key is
      // cold, compose from the individual aggregate keys; if those are cold too,
      // 503 — the client then falls back to the per-piece endpoints (each of which
      // live-falls-back on its own), so nothing goes blank. No live composition
      // here: assembling every upstream in one invocation would burst the
      // 50-subrequest cap. (Local dev never reaches this file — the Vite
      // middleware serves api/bootstrap.js, which composes live.)
      case "bootstrap": {
        const cache = "public, max-age=60, s-maxage=60, stale-while-revalidate=300";
        const envelope = await kvGetEnvelope(env, "bootstrap");
        if (envelope?.data) {
          return json({ ...envelope.data, updatedAt: envelope.updatedAt ?? null }, { cache });
        }
        const [control, polls, racePolls, houseRaces, races, nomination, primaryPolls] = await Promise.all([
          kvGet(env, "control"),
          kvGet(env, "polls"),
          kvGet(env, "race-polls"),
          kvGet(env, "house-races"),
          kvGet(env, "races"),
          kvGet(env, "nomination"),
          kvGet(env, "primary-polls"),
        ]);
        if ([control, polls, racePolls, houseRaces, races, nomination, primaryPolls].every((v) => v === undefined)) {
          return json({ error: "bootstrap not warmed yet" }, { status: 503 });
        }
        return json(
          {
            control: control ?? null,
            polls: polls ?? null,
            racePolls: racePolls ?? null,
            houseRaces: houseRaces ?? null,
            races: races ?? null,
            president:
              nomination || primaryPolls
                ? { nomination: nomination ?? null, primaryPolls: primaryPolls ?? null }
                : null,
            updatedAt: null,
          },
          { cache }
        );
      }

      case "control":
        return json(await served(env, "control", getControl), {
          cache: "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
        });

      case "control-history": {
        const range = String(url.searchParams.get("range") || "all");
        const cache = historyCacheFor(range);
        // Intraday windows are daily-KV-incompatible — the warmer only ever
        // writes the "all" payload — so they're fetched on demand, through the
        // clean-IP origin (see fromOrigin above) rather than straight from the
        // providers.
        if (INTRADAY_RANGES.has(range)) {
          const mirrored = await fromOrigin(env, `/api/control-history?range=${range}`);
          return json(mirrored ?? (await getControlHistory(range)), { cache });
        }
        // "all"/"90d": serve from KV as today. "90d" reuses the cached "all"
        // payload (identical upstream params, see MARKET_RANGES) and is
        // narrowed to 90 days right here in the worker via sliceSources —
        // keeping the most likely non-default range completely off the
        // rate-limited upstream path, which is the whole reason this KV layer
        // exists (Cloudflare's shared egress IP gets rate-limited by Kalshi/
        // Polymarket otherwise).
        const cached = await kvGet(env, "control-history");
        if (cached === undefined) return json(await getControlHistory(range), { cache });
        const data =
          range === "90d"
            ? {
                senate: { sources: sliceSources(cached.senate.sources, 90) },
                house: { sources: sliceSources(cached.house.sources, 90) },
              }
            : cached;
        return json(data, { cache });
      }

      case "polls":
        return json(await served(env, "polls", getMacroPolls), {
          cache: "public, max-age=900, s-maxage=1800, stale-while-revalidate=3600",
        });

      case "house-races":
        return json(await served(env, "house-races", getAllHouseRaces), {
          cache: "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
        });

      case "race-polls": {
        // No ?state= returns every state in one shot; ?state=GA returns just that one.
        if (!state) {
          return json(await served(env, "race-polls", getAllRacePolls), {
            cache: "public, max-age=900, s-maxage=1800, stale-while-revalidate=3600",
          });
        }
        const data = await fromAgg("race-polls", () => getRacePolls(state));
        return data
          ? json(data, { cache: "public, max-age=900, s-maxage=1800, stale-while-revalidate=3600" })
          : unknownState(state);
      }

      case "race": {
        if (!state) return missingState();
        const data = await fromAgg("races", () => getRace(state));
        return data
          ? json(data, { cache: "public, max-age=60, s-maxage=60, stale-while-revalidate=300" })
          : unknownState(state);
      }

      case "history": {
        if (!state) return missingState();
        const range = String(url.searchParams.get("range") || "all");
        const cache = historyCacheFor(range);
        // Same all/90d-vs-live rule as control-history above, just indexed by
        // state instead of senate/house. Not routed through fromAgg() because
        // "90d" needs to slice the per-state entry before returning it.
        if (INTRADAY_RANGES.has(range)) {
          const mirrored = await fromOrigin(
            env,
            `/api/history?state=${encodeURIComponent(state)}&range=${range}`
          );
          if (mirrored) return json(mirrored, { cache });
          const data = await getRaceHistory(state, range);
          return data ? json(data, { cache }) : unknownState(state);
        }
        const agg = await kvGet(env, "histories");
        const cached = agg && agg[state] !== undefined ? agg[state] : undefined;
        if (cached === undefined) {
          const data = await getRaceHistory(state, range);
          return data ? json(data, { cache }) : unknownState(state);
        }
        const data =
          range === "90d"
            ? { stateCode: cached.stateCode, sources: sliceSources(cached.sources, 90) }
            : cached;
        return json(data, { cache });
      }

      // ---- 2028 presidential primaries (N-candidate) ----
      // KV holds { dem, rep } under `nomination` / `primary-polls`; ?party= indexes it,
      // and a miss falls back to the live provider call (cold KV / local dev).
      case "nomination": {
        const party = String(url.searchParams.get("party") || "").toLowerCase();
        if (party && !PARTIES[party]) return badParty(party);
        const cache = "public, max-age=300, s-maxage=300, stale-while-revalidate=900";
        const agg = await kvGet(env, "nomination");
        if (!party) return json(agg ?? (await getAllNomination()), { cache });
        return json(agg?.[party] ?? (await getNominationOdds(party)), { cache });
      }

      case "primary-polls": {
        const party = String(url.searchParams.get("party") || "").toLowerCase();
        if (party && !PARTIES[party]) return badParty(party);
        const cache = "public, max-age=900, s-maxage=1800, stale-while-revalidate=3600";
        const agg = await kvGet(env, "primary-polls");
        if (!party) return json(agg ?? (await getAllPrimaryPolls()), { cache });
        return json(agg?.[party] ?? (await getPrimaryPolls(party)), { cache });
      }

      case "nomination-history": {
        const party = String(url.searchParams.get("party") || "").toLowerCase();
        if (party && !PARTIES[party]) return badParty(party);
        const range = String(url.searchParams.get("range") || "all");
        const cache = historyCacheFor(range);
        const parties = party ? [party] : PARTY_IDS;
        const pack = (byParty) => (party ? byParty[party] : byParty);
        // Intraday: on demand via the clean-IP origin (same reason as history above).
        if (INTRADAY_RANGES.has(range)) {
          const mirrored = await fromOrigin(
            env,
            `/api/nomination-history?range=${range}${party ? `&party=${party}` : ""}`
          );
          if (mirrored) return json(mirrored, { cache });
          const live = Object.fromEntries(
            await Promise.all(parties.map(async (p) => [p, await getNominationHistory(p, range)]))
          );
          return json(pack(live), { cache });
        }
        // all/90d: the warmer stores the "all" payload per party inside the `histories`
        // aggregate (key `president-<party>`); "90d" is sliced here.
        const agg = await kvGet(env, "histories");
        const entry = async (p) => {
          const cached = agg?.[`president-${p}`];
          if (cached === undefined) return getNominationHistory(p, range);
          return range === "90d" ? { ...cached, range, sources: sliceSources(cached.sources, 90) } : cached;
        };
        const out = Object.fromEntries(await Promise.all(parties.map(async (p) => [p, await entry(p)])));
        return json(pack(out), { cache });
      }

      case "race-news": {
        if (!state) return missingState();
        const data = await fromAgg("news", () => getRaceNews(state, env.NEWS_API_KEY));
        return data
          ? json(data, { cache: "public, max-age=900, s-maxage=1800, stale-while-revalidate=3600" })
          : unknownState(state);
      }

      // Live vote counts (civicAPI). Deliberately NOT in KV: a minute-level cadence
      // would blow the free write quota. The origin mirror (clean IP, one
      // subrequest) comes first, then a direct civicAPI fetch; a short max-age lets
      // the zone's edge cache rule (~60s on /api/*) absorb traffic. Outside the
      // results window nothing changes, so it caches for up to an hour (never past
      // the window's start). An empty payload inside the window is cached only briefly.
      case "results": {
        const now = Date.now();
        let cache = resultsCacheControl(now);
        if (!inResultsWindow(now)) return json({ races: {}, lastUpdated: null }, { cache });
        let data = await fromOrigin(env, "/api/results");
        if (!data || !Object.keys(data.races || {}).length) data = await getAllResults();
        const lastGood = await readLastGood();
        if (Object.keys(data?.races || {}).length) {
          data = mergeResults(lastGood, data);
          await writeLastGood(data);
        } else if (lastGood) {
          data = lastGood;
        }
        // Short, not no-store: until civicAPI drops test_data every response is
        // empty, and no-store would send each visitor's minute poll to the Function.
        if (!Object.keys(data.races || {}).length) cache = "public, max-age=15, s-maxage=15";
        return json(data, { cache });
      }

      default:
        return json({ error: `unknown endpoint /api/${route}` }, { status: 404 });
    }
  } catch (e) {
    return json({ error: String(e?.message || e) }, { status: 500 });
  }
}
