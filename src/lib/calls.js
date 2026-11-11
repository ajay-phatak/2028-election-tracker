import { HOUSE_SAFE_SEATS } from "../config/houseSafeSeats";
import { HOUSE_OUTLOOK, SENATE_OUTLOOK, WATCHED_RACES } from "../config/races.config";
import { raceState, stateClosed } from "./electionNight";
import { SIMULATED_CALLS } from "./simulate";

// Race calls and the election-night seat tallies. A race is called by EITHER the
// vote count (civicAPI's `winner` flag, see api/_results.js) OR the prediction
// markets (rule below). These are NOT AP calls and must never be worded as
// official — surface CALLS_FOOTNOTE wherever a call or a tally appears.
export const CALLS_FOOTNOTE =
  "Calls come from civicAPI vote counts or prediction-market odds, not official AP race calls.";

const CALL_BOTH = 97; // every source with data must have the party at least here...
const CALL_SOLO = 99; // ...or here when only one source has data

const hasOdds = (s) => Boolean(s && s.demYes != null && s.repYes != null);

// "D" | "R" | null from a race's market sources, ignoring poll closings.
export function marketCall(sources) {
  const live = (sources || []).filter(hasOdds);
  if (!live.length) return null;
  const need = live.length > 1 ? CALL_BOTH : CALL_SOLO;
  const dem = live.every((s) => s.demYes >= need);
  const rep = live.every((s) => s.repYes >= need);
  return dem === rep ? null : dem ? "D" : "R";
}

// The call for a watched race at `now`: { party: "D" | "R", by: "results" | "markets" },
// or null. A race can only be called once its state's polls have closed; after
// that, whichever source calls it first wins. `result` is the race's entry from
// /api/results (or undefined). ?simulateCalls forces a 99/1 market call and takes
// precedence, so dry runs behave the same with or without simulated votes.
export function raceCall(race, sources, now, result) {
  if (!stateClosed(raceState(race), now)) return null;
  const forced = SIMULATED_CALLS[(race.code ?? race.stateCode).toUpperCase()];
  if (forced) {
    const odds = forced === "D" ? { demYes: 99, repYes: 1 } : { demYes: 1, repYes: 99 };
    const party = marketCall([odds, odds]);
    return party && { party, by: "markets" };
  }
  if (result?.winner === "D" || result?.winner === "R") {
    return { party: result.winner, by: "results" };
  }
  const party = marketCall(sources);
  return party && { party, by: "markets" };
}

// Badge text: "Results: called D" / "Markets: called D" (Nebraska's and Idaho's
// non-GOP sides are independents).
export const callText = (race, call) =>
  `${call.by === "results" ? "Results" : "Markets"}: called ${
    race.independent && call.party === "D" ? `${race.independent} (I)` : call.party
  }`;

// "D" | "R" | null: the side favored by the average of the sources' odds.
function oddsFavorite(sources) {
  const live = (sources || []).filter(hasOdds);
  if (!live.length) return null;
  const avg = (key) => live.reduce((sum, s) => sum + s[key], 0) / live.length;
  const dem = avg("demYes");
  const rep = avg("repYes");
  return dem === rep ? null : dem > rep ? "D" : "R";
}

// The side markets favored on Election Day morning, for the results-mode map
// outline: the warmer's snapshot (`morning`, { GA: "D", ... } from bootstrap) if
// it has one, else the current odds favorite (dry runs, local dev, or before the
// snapshot), else the incumbent party. (functions/api/refresh.js builds the
// snapshot with the same average rule.)
export const morningFavorite = (race, sources, morning) =>
  morning?.[race.code ?? race.stateCode] ?? oddsFavorite(sources) ?? race.party;

// Senate seats by outcome. Holdovers are seats not up this cycle (SENATE_OUTLOOK);
// tracked races add market-called seats; untracked safe seats count for their
// holding party once the state's polls close; everything else is uncalled.
// `oddsByState` is { GA: { sources }, ... }; `results` is the /api/results `races` map.
export function senateTally(oddsByState, now, results) {
  const { holdovers, untracked, total } = SENATE_OUTLOOK;
  let safeDem = 0;
  let safeRep = 0;
  for (const [state, u] of Object.entries(untracked)) {
    if (!u.safe || !stateClosed(state, now)) continue;
    if (u.party === "D") safeDem++;
    else safeRep++;
  }
  let dem = holdovers.dem + safeDem;
  let rep = holdovers.rep + safeRep;
  let ind = 0; // independents (Osborn, Achilles), if called: not counted for either party
  for (const r of WATCHED_RACES.senate) {
    const party = raceCall(r, oddsByState?.[r.stateCode]?.sources, now, results?.[r.stateCode])?.party;
    if (party === "R") rep++;
    else if (party) r.independent ? ind++ : dem++;
  }
  return {
    dem,
    rep,
    ind,
    uncalled: total - dem - rep - ind,
    calledDem: dem - holdovers.dem - safeDem,
    calledRep: rep - holdovers.rep - safeRep,
    safeDem,
    safeRep,
  };
}

// House seats by outcome: watchlist districts with markets use the call rule;
// every other seat counts for its party only if Cook rates it Safe/Solid AND its
// state's polls have closed (HOUSE_SAFE_SEATS holds only such non-watchlist
// seats, so nothing is counted twice). All else is uncalled.
// `oddsByCode` is { "NY-17": { sources }, ... }; `results` is the /api/results `races` map.
export function houseTally(oddsByCode, now, results) {
  let calledDem = 0;
  let calledRep = 0;
  for (const d of WATCHED_RACES.house) {
    const party = raceCall(d, oddsByCode?.[d.code]?.sources, now, results?.[d.code])?.party;
    if (party === "D") calledDem++;
    else if (party === "R") calledRep++;
  }
  let safeDem = 0;
  let safeRep = 0;
  for (const [state, n] of Object.entries(HOUSE_SAFE_SEATS)) {
    if (!stateClosed(state, now)) continue;
    safeDem += n.D;
    safeRep += n.R;
  }
  const { total } = HOUSE_OUTLOOK;
  return {
    calledDem,
    calledRep,
    safeDem,
    safeRep,
    dem: calledDem + safeDem,
    rep: calledRep + safeRep,
    uncalled: total - calledDem - calledRep - safeDem - safeRep,
  };
}
