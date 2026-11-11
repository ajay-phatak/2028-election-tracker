import { getControl, getRace, getAllHouseRaces } from "./_providers.js";
import { getMacroPolls, getAllRacePolls } from "./_polls.js";
import { getAllNomination } from "./_nomination.js";
import { getAllPrimaryPolls } from "./_primaryPolls.js";
import { WATCHED_RACES } from "../src/config/races.config.js";

const SENATE_STATES = WATCHED_RACES.senate.map((r) => r.stateCode);

// GET /api/bootstrap -> { control, polls, racePolls, houseRaces, races, president, updatedAt }
// (president = { nomination:{dem,rep}, primaryPolls:{dem,rep} }, each null if its fetch failed)
//
// One-shot first-paint payload: everything the client prefetches on load, in a
// single request. On Cloudflare this route is served from the warmer-composed
// `bootstrap` KV key (see functions/api/[[route]].js); THIS handler is the
// no-KV version that composes live, for local Vite dev and the Vercel oracle
// (both on clean egress IPs, so the parallel fan-out below is safe there).
//
// Each piece is fetched independently and a failed piece becomes null — the
// client falls back to that piece's individual endpoint, so one flaky upstream
// never blanks the whole payload.
async function piece(run) {
  try {
    const v = await run();
    return v == null ? null : v;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const [control, polls, racePolls, houseRaces, races, nomination, primaryPolls] = await Promise.all([
    piece(getControl),
    piece(getMacroPolls),
    piece(getAllRacePolls),
    piece(getAllHouseRaces),
    piece(async () => {
      const out = {};
      await Promise.all(
        SENATE_STATES.map(async (st) => {
          try {
            const v = await getRace(st);
            if (v) out[st] = v;
          } catch {
            // recorded as a missing state; client falls back per state
          }
        })
      );
      return Object.keys(out).length ? out : null;
    }),
    piece(getAllNomination),
    piece(getAllPrimaryPolls),
  ]);
  res.setHeader(
    "Cache-Control",
    "public, max-age=60, s-maxage=60, stale-while-revalidate=300"
  );
  const president = nomination || primaryPolls ? { nomination, primaryPolls } : null;
  res.status(200).json({ control, polls, racePolls, houseRaces, races, president, updatedAt: Date.now() });
}
