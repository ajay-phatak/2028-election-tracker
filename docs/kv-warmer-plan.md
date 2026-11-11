# Plan: Decouple the data layer with Workers KV + a scheduled warmer

> **Handoff doc for a fresh Claude Code session.** It is self-contained — you do not
> need any prior conversation. Read it fully before changing code. The app already
> works; this is a scalability/robustness upgrade, not a bug fix.

## 1. Goal & why

This is an ad-supported public dashboard that will see **spiky, high traffic** (blog
embeds, election-time surges) and is the template for **more dashboards like it**. The
data layer must scale independently of traffic and stay robust under load.

**Root problem we are designing around:** the API proxies free upstreams (Kalshi,
Polymarket, VoteHub, GNews). On Cloudflare, Functions egress from a **shared IP pool**
that those free APIs rate-limit (Kalshi returns 429; Google News RSS is IP-blocked, which
is why news already moved to GNews). The current code fetches upstreams **per request**
(with an edge cache + retries), so every cache-miss across Cloudflare's ~300 edge
locations re-hits the upstreams. That works but couples user traffic to the rate-limited
upstreams.

**The fix in this plan:** a **scheduled warmer** fetches everything at a controlled,
paced rate into **Workers KV (global)**; **all user-facing reads serve from KV**. User
traffic then scales independently of the upstream rate limits. This is the standard
pattern for serving external-API data at scale, and it generalizes to the other planned
dashboards.

Do **not** replace this with Kalshi API-key auth. Auth only raises the ceiling on one
upstream while keeping the per-request model. It is a future *complement* to the warmer
(add it only if the warmer itself ever gets throttled — a paced warmer almost certainly
won't), not the foundation.

## 2. Current architecture (what exists today)

- **Hosting:** Cloudflare **Pages** project (NOT a Worker — this matters, see Gotchas).
  Repo `ajay-phatak/2026-election-tracker`, branch `main`. Build: `npm run build` → `dist`.
- **API:** one catch-all Pages Function, `functions/api/[[route]].js`, exporting
  `onRequestGet({ request, env })`. It routes `/api/<name>` to provider functions and
  returns JSON. Routes and their providers:
  | Route | Provider call | Notes |
  |---|---|---|
  | `/api/control` | `getControl()` | loading-screen critical path |
  | `/api/control-history` | `getControlHistory()` | lazy (card expand) |
  | `/api/polls` | `getMacroPolls()` | VoteHub |
  | `/api/house-races` | `getAllHouseRaces()` | ~37 districts, Polymarket-only |
  | `/api/race-polls` | `getAllRacePolls()` (or `getRacePolls(state)` with `?state=`) | VoteHub, batched |
  | `/api/race?state=XX` | `getRace(state)` | per state |
  | `/api/history?state=XX` | `getRaceHistory(state)` | per state, heavy (730-day candles) |
  | `/api/race-news?state=XX` | `getRaceNews(state, env.NEWS_API_KEY)` | per state, GNews |
- **Providers (framework-agnostic, keep them so):**
  - `api/_providers.js` — Polymarket + Kalshi. Contains `edgeFetch` (success-only
    per-colo edge cache via `caches.default`, buffered body, `EDGE_TTL = 900`s), retry
    policies `FAST`/`PATIENT` with jittered `backoff`, `getJson` (Polymarket, retried),
    `kalshiFetch` (no serialization chain — removed deliberately), `mapLimit` (caps the
    house fan-out at 6 concurrent). `getControl` uses FAST; everything else PATIENT.
  - `api/_polls.js` — VoteHub polling averages/trends.
  - `api/_news.js` — GNews JSON API. Queries are the two nominees as quoted phrases joined
    by OR (`"Angie Nixon" OR "Ashley Moody"`). Never add bare words: GNews ANDs them, and
    the free plan only returns the last 30 days, so longer queries return empty.
  - `src/config/races.config.js` — `WATCHED_RACES.senate` (11 states, each has `stateCode`,
    `polymarketSlug`, `kalshiMarketId`, `pollParties`), `WATCHED_RACES.house` (~37
    districts, Polymarket-only), `CONTROL_MARKETS`.
- **Local dev:** `vite dev` uses a middleware in `vite.config.js` that loads the OLD Vercel
  handlers in `api/*.js` (e.g. `api/race.js`) which import the same providers. These have
  NO `env`/KV. **Any KV code must treat the binding as possibly-undefined and fall back to
  a live provider call**, or local dev and the Vite middleware break.
- **Client:** `src/lib/api.js` calls `/api/*` (memoized per session). On load it prefetches
  only current odds for the 11 senate states; history and news load lazily when a drawer/card
  opens (`src/components/RaceDrawer.jsx`, `MacroMetrics.jsx`). Don't reintroduce eager
  history/news prefetch — it bursts the upstreams.

**The retry/cache code in `_providers.js` was hard-won — preserve it.** It's also what
makes the warmer's paced fetches reliable.

## 3. Oracle for verification

A still-working copy of the app runs on Vercel: **https://2026-election-tracker.vercel.app**
(its egress IP isn't rate-limited, so its data is complete). Use it as ground truth — e.g.
`curl .../api/control`, `.../api/race?state=GA`, `.../api/house-races` — and diff against
the Cloudflare prod at **https://2026-election-tracker.pages.dev**. After this work, the
KV-served Cloudflare responses should match Vercel.

## 4. Design

### Storage shape — use a FEW aggregate keys (KV write-quota matters)
KV free tier allows ~1000 writes/day. Per-state keys refreshed every 10 min would blow
past that. Store **aggregate** keys instead:

| KV key | Value | Source |
|---|---|---|
| `control` | getControl() result | |
| `control-history` | getControlHistory() result | |
| `polls` | getMacroPolls() result | |
| `house-races` | getAllHouseRaces() result | |
| `race-polls` | getAllRacePolls() result | |
| `races` | `{ [stateCode]: getRace(state) }` for all 9 senate states | warmer loops, paced |
| `histories` | `{ [stateCode]: getRaceHistory(state) }` for all 11 | warmer loops, paced |
| `news` | `{ [stateCode]: getRaceNews(state, key) }` for all 11 | warmer loops, paced |

8 keys × refresh frequency. At every-15-min that's ~768 writes/day (under the free quota);
every-10-min (~1152/day) needs paid KV (≈$0.50/million writes — negligible, fine for an
ad-supported app). **Decide with the user: 15-min cron on free KV, or 10-min + enable paid
KV.** Store each value as `{ data, updatedAt }` so staleness is observable.

### Read path (in `functions/api/[[route]].js`)
For each route, read its aggregate KV key first; serve `data` if present. On a miss
(cold KV, or local dev where `env.MARKET_CACHE` is undefined), fall back to the live
provider call exactly as today (so nothing ever goes blank). For the per-state routes
(`race`, `history`, `race-news`), read the aggregate key (`races`/`histories`/`news`) and
index by `state`; fall back to the single-state provider call on miss.

Keep the existing JSON/`Cache-Control` response shaping. The per-colo `caches.default`
edge cache in `edgeFetch` can stay as a harmless second layer (it only wraps the live
fallback now). Don't remove it.

### Refresh function (the warmer)
Add `functions/api/refresh.js` (or a route in the catch-all) exporting `onRequest` /
`onRequestPost`:
- **Auth-gate it** so it's not publicly triggerable: require a header/query secret equal
  to `env.REFRESH_TOKEN`; return 401 otherwise.
- Fetch everything **paced** (sequential or small `mapLimit`, NOT a 30-wide burst) reusing
  the providers, assemble the 8 aggregate values, and `env.MARKET_CACHE.put(key,
  JSON.stringify({ data, updatedAt: Date.now() }))` each.
- Return a small JSON summary (keys written, counts, any per-source failures) for cron
  observability.
- Be resilient: if one source fails, still write the others (don't abort the whole refresh).

### Cron
> **Update (2026-09-29):** the schedule now runs as a Cloudflare Cron Trigger Worker
> (`cron-worker/`). GitHub throttled the 15-min schedule to roughly hourly, with gaps of
> several hours; the workflow stays for manual warms only.

Use a **GitHub Actions scheduled workflow** (`.github/workflows/refresh.yml`, `on:
schedule: cron`) that `curl`s `https://2026-election-tracker.pages.dev/api/refresh` with
the secret. (A companion Cron-Trigger Worker is the alternative; Pages itself has no native
cron. GitHub Actions is simpler and keeps everything in this repo.) The secret goes in a
GitHub repo secret; the cron passes it as a header.

## 5. Staged implementation (do in order; verify between stages)

1. **KV read-through + fallback** — add KV reads to the Function with live-fallback, guarded
   for undefined binding. No warmer yet, so KV is empty → everything falls back to live
   (behavior identical to today). Ship and confirm no regression vs. Vercel. *Safe first step.*
2. **Refresh function** — add `/api/refresh` (token-gated, paced, writes aggregate keys).
   Trigger it manually with the token; confirm KV populates and reads now serve from KV
   (fast, complete, matching Vercel) instead of falling back.
3. **Cron** — add the GitHub Actions workflow; confirm it triggers refresh on schedule and
   KV stays warm.
4. **(Deferred / only if needed)** Kalshi API-key auth on the warmer's Kalshi fetches if the
   warmer ever shows 429s. Kalshi limits are **per-account, not per-IP** (Basic tier ≈ 20
   read req/s), auth is per-request RSA-PSS signing (WebCrypto in the Worker). Likely
   unnecessary for a paced warmer — leave it out unless evidence says otherwise.

## 6. Manual steps the USER must do (you can't; guide them)

- **Create a KV namespace** in the Cloudflare dashboard and **bind it to the Pages project**
  as `MARKET_CACHE` for **both Production and Preview** (Pages project → Settings → Functions
  / Bindings → KV namespace bindings). Pages KV bindings are set in the dashboard, NOT in
  code.
- **Add `REFRESH_TOKEN`** (a random string) as a Pages environment variable/secret
  (Production + Preview). `NEWS_API_KEY` already exists there — leave it.
- **GitHub:** ensure Actions are enabled; add the same `REFRESH_TOKEN` as a repo secret so
  the workflow can authenticate.
- Decide refresh cadence (15-min on free KV vs 10-min on paid KV) per §4.

## 7. Gotchas / guardrails (read before editing)

- **This is a Pages project, not a Worker. Do NOT add a `wrangler.toml`** — Cloudflare's git
  integration detects it and switches the repo to the Workers `wrangler deploy` path, which
  fails ("Missing entry-point…"). This already broke a deploy once. KV binding for Pages is
  done in the dashboard. (For local `wrangler pages dev` with KV you can pass `--kv
  MARKET_CACHE`, but don't commit a wrangler.toml that changes the build.)
- **Always guard `env.MARKET_CACHE` / `env.REFRESH_TOKEN` for undefined** and fall back to a
  live provider call. Local dev (Vite middleware + `api/*.js`) has no `env`. Never let a
  missing binding break a response.
- **Commit/push only with explicit user approval.** The user reviews on localhost first
  (`npm run dev`, http://localhost:5173). Branch is `main`; pushing to `main` auto-deploys to
  Cloudflare. Do not push unprompted.
- **Keep providers framework-agnostic** (plain async + global `fetch`); they run under both
  Pages Functions and the Vite middleware.
- **Verify each change:** `npm run build` (client) must pass; also import-check the Function
  in Node — `node --input-type=module -e "import('./functions/api/[[route]].js').then(m=>console.log(typeof m.onRequestGet))"`
  — because the client build does NOT compile `/functions` (Cloudflare bundles those at
  deploy; a Function bundling error won't show locally). Then verify prod output against the
  Vercel oracle.
- **KV is eventually consistent** (~secs to up to a minute globally). Fine for slow-moving
  odds. The read path's live-fallback covers the brief gap before the first refresh.
- Don't reintroduce eager client prefetch of history/news (`src/lib/api.js prefetchRaces`) —
  it bursts upstreams. History/news stay lazy.
- Reuse the existing `_providers.js` retry/cache machinery; don't rewrite it.

## 8. Definition of done

- KV namespace bound; `/api/refresh` (token-gated) populates the 8 aggregate keys.
- All `/api/*` reads serve from KV when warm, live-fallback when cold, never blank.
- GitHub Actions cron refreshes on schedule; KV stays warm with no manual action.
- Cloudflare prod (`*.pages.dev`) data matches the Vercel oracle across control, all 9 senate
  states (both Dem+Rep Kalshi sides), house (~35/36), polls, history, and news.
- Cold-start gaps after a deploy are gone (cron re-warms within one interval).
- No `wrangler.toml`; local `vite dev` still works; build + Function import checks pass.
