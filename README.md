# 2028 Election Tracker

Live dashboard for the 2028 US elections: a presidential race on top (a primaries mode, then a general-election mode), with Senate, House and governor sections below.

**Status: scaffold only.** This repo was scaffolded from the 2026 midterms tracker. It has the reusable build tooling, API/provider code, KV warmer, cron Worker and React components in place, with all 2026 data removed (empty structures in `src/config/` marked `TODO(2028)`). `src/App.jsx` is a placeholder shell; no data layer is mounted yet. Grep for `TODO(2028)` to find what needs filling in or verifying (hosts, endpoint names, ticker formats, race data).

The election year is driven from one place: `ELECTION_DAY` in `src/config/races.config.js`. `src/config/election.js` derives the year, election-night and results windows, and the morning-snapshot time from it.

Stack: React 18, Vite, Tailwind v4 (`@tailwindcss/vite`), react-simple-maps + us-atlas, Recharts.

## Local development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/
npm run lint
npm run preview
```

`vite dev` serves `api/*.js` through a small middleware (`vite.config.js`), so there is no KV locally and everything is fetched live.

## Deploy

Deployed to **Cloudflare Pages** via git integration (build `npm run build`, output `dist`). `/api` is a Pages Function from `functions/`. There is intentionally **no `wrangler.toml` at the repo root**: it would make Cloudflare treat the project as a Worker and break the Pages build. `public/_redirects` provides the SPA fallback. Only `cron-worker/` has a `wrangler.toml`; deploy it by hand from that folder.

Pages settings (dashboard, names only):

- KV namespace binding: `MARKET_CACHE`
- Secrets/env: `REFRESH_TOKEN`, `NEWS_API_KEY`
- Optional: `WARM_ORIGIN` (override the Vercel origin the warmer mirrors)

See `docs/kv-warmer-plan.md` for the KV warmer design (carried over unchanged from 2026).
