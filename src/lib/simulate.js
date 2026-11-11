// Dry-run switches for election-night mode, read once from the page URL:
//   ?simulate=2028-11-07T21:30-05:00   pretend it's that moment (the clock keeps
//                                      ticking from there)
//   ?simulateCalls=GA:D,NC:R,NY-17:D   force those races' market odds to 99/1
//   ?simulateVotes=1                   synthetic vote counts instead of fetching
//                                      /api/results: each watched race starts
//                                      reporting when its state's polls close and
//                                      reaches 100% four hours later (needs ?simulate
//                                      to be at or past the first poll close)
// All are inert without the params, and none touches the network or data.
import { WATCHED_RACES } from "../config/races.config";
import { POLL_CLOSINGS } from "../config/pollClosings";
import { raceState } from "./electionNight";

const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);

// URLSearchParams decodes a literal "+" in a UTC offset (…21:30+00:00) as a space.
const raw = params.get("simulate")?.trim().replace(/ (\d\d:?\d\d)$/, "+$1");
const simulatedAt = raw ? Date.parse(raw) : NaN;
const offset = Number.isFinite(simulatedAt) ? simulatedAt - Date.now() : 0;

export const IS_SIMULATING = Number.isFinite(simulatedAt);

// "Now" for every election-night decision (poll closings, activation, calls).
export const getElectionNow = () => Date.now() + offset;

// { GA: "D", "NY-17": "D" } — race code -> forced winner, from ?simulateCalls.
export const SIMULATED_CALLS = Object.fromEntries(
  (params.get("simulateCalls") || "")
    .split(",")
    .map((pair) => pair.trim().split(":"))
    .filter(([code, party]) => code && (party?.toUpperCase() === "D" || party?.toUpperCase() === "R"))
    .map(([code, party]) => [code.toUpperCase(), party.toUpperCase()])
);

// ?simulateVotes=1 — see the header. Only meaningful alongside ?simulate.
export const SIMULATE_VOTES = params.get("simulateVotes") === "1";

const RAMP_MS = 4 * 60 * 60 * 1000; // 0% -> 100% reporting after a state's close

// Deterministic pseudo-random in [0, 1) per (race code, salt): FNV-1a hash, so a
// reload at the same simulated time shows the same numbers.
function unit(code, salt) {
  let h = 2166136261;
  for (const ch of `${code}:${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}

// Synthetic /api/results payload at `now`: races whose state's polls have closed
// ramp up in percent reporting; the Democrat's two-party share is a fixed 42-58%
// per race (so some flip and some stay too close to call), and a winner is set once
// 80% is in and the margin is at least 4 points.
export function simulatedResults(now) {
  const races = {};
  for (const race of [...WATCHED_RACES.senate, ...(WATCHED_RACES.house || [])]) {
    const code = race.code ?? race.stateCode;
    const closeAt = Date.parse(POLL_CLOSINGS[raceState(race)]);
    if (!(now >= closeAt)) continue;
    const pct = Math.round(Math.min(1, (now - closeAt) / RAMP_MS) * 1000) / 10;
    const finalVotes = race.stateCode
      ? 900000 + unit(code, "total") * 5000000
      : 150000 + unit(code, "total") * 200000;
    const demShare = 42 + unit(code, "share") * 16;
    const votes = Math.round((finalVotes * pct) / 100);
    const demVotes = Math.round((votes * demShare) / 100);
    const repVotes = votes - demVotes;
    const percent = (n) => (votes ? Math.round((n / votes) * 1000) / 10 : 0);
    const margin = Math.abs(2 * demShare - 100);
    races[code] = {
      pct,
      dem: { name: race.candidates.dem, votes: demVotes, percent: percent(demVotes) },
      rep: { name: race.candidates.rep, votes: repVotes, percent: percent(repVotes) },
      winner: pct >= 80 && margin >= 4 ? (demShare > 50 ? "D" : "R") : null,
      updated: new Date(now).toISOString(),
    };
  }
  return { races, lastUpdated: new Date(now).toISOString() };
}
