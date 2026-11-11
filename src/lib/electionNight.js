import { POLL_CLOSINGS } from "../config/pollClosings";
import { NIGHT_START, NIGHT_END, RESULTS_END } from "../config/election";

// Election-night mode runs from the first poll close (6 PM ET on election day) through
// the end of the following day ET; outside that window the UI is unchanged. Window
// constants live in src/config/election.js.

export const isElectionNight = (now) => now >= NIGHT_START && now < NIGHT_END;

// Results mode (live vote counts from civicAPI, see api/_results.js) runs from the
// first poll close until mid-December: counting continues for days after election
// night (California, close races).

export const isResultsMode = (now) => now >= NIGHT_START && now < RESULTS_END;

// Postal code of the state a race is in: senate races carry stateCode, House
// districts a code like "NY-17".
export const raceState = (race) => race.stateCode ?? race.code.split("-")[0];

// True once every poll in the state has closed (false for unknown states).
export const stateClosed = (state, now) => {
  const at = Date.parse(POLL_CLOSINGS[state]);
  return Number.isFinite(at) && now >= at;
};

// "7:30 PM ET" for an instant.
export const formatET = (ms) =>
  `${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(ms)} ET`;

// "Polls close 8:00 PM ET" while a state is still voting on election night, else null.
export function pollsCloseLabel(state, now) {
  if (!isElectionNight(now) || !POLL_CLOSINGS[state] || stateClosed(state, now)) return null;
  return `Polls close ${formatET(Date.parse(POLL_CLOSINGS[state]))}`;
}

// The next batch of closings after `now`: { at (ms), states: [codes] }, or null
// once every state has closed.
export function nextClosings(now) {
  let at = Infinity;
  for (const iso of Object.values(POLL_CLOSINGS)) {
    const t = Date.parse(iso);
    if (t > now && t < at) at = t;
  }
  if (at === Infinity) return null;
  const states = Object.keys(POLL_CLOSINGS)
    .filter((s) => Date.parse(POLL_CLOSINGS[s]) === at)
    .sort();
  return { at, states };
}
