// React side of the live-data refresh in ./api.js.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  fetchHouseRaces,
  fetchMorning,
  fetchNomination,
  fetchNominationHistory,
  fetchPrimaryPolls,
  fetchRaceOdds,
  fetchResults,
  getDataAsOf,
  getDataVersion,
  refreshData,
  subscribeData,
} from "./api";
import { ELECTION_DAY, WATCHED_RACES } from "../config/races.config";
import { isResultsMode } from "./electionNight";
import { getElectionNow, SIMULATE_VOTES, simulatedResults } from "./simulate";

// Bumps whenever newer data lands; put it in a fetch effect's deps to re-fetch.
export const useDataVersion = () => useSyncExternalStore(subscribeData, getDataVersion);

// When the KV warmer last wrote the data on screen (ms), or null before load.
export const useDataAsOf = () => useSyncExternalStore(subscribeData, getDataAsOf);

// The warmer writes every 15 min, so checking more often than this only spends
// the free-tier function-invocation quota on unchanged data.
const REFRESH_MS = 5 * 60 * 1000;

// Poll for newer data while the tab is visible, and check right away when the
// user comes back to a tab that has been hidden longer than one interval.
// Hidden tabs don't poll at all.
export function useAutoRefresh() {
  useEffect(() => {
    let last = Date.now();
    const tick = () => {
      last = Date.now();
      refreshData();
    };
    const id = setInterval(() => {
      if (document.visibilityState === "visible") tick();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last >= REFRESH_MS) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  });
}

// Current time, re-read every `ms`, for labels that age (countdown, staleness).
export function useNow(ms = 60 * 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// Like useNow, but on the election-night clock: honors ?simulate (see
// ./simulate.js) and ticks faster so poll closings land within seconds.
export function useElectionNow(ms = 15 * 1000) {
  const [now, setNow] = useState(getElectionNow);
  useEffect(() => {
    const id = setInterval(() => setNow(getElectionNow()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// Current odds for every watched Senate race, { GA: { sources }, ... }, for the
// market calls. Reads the same memoized fetches the drawer uses; states that
// failed to load are simply absent.
export function useSenateOdds() {
  const [odds, setOdds] = useState(null);
  const version = useDataVersion();
  useEffect(() => {
    let alive = true;
    Promise.all(
      WATCHED_RACES.senate.map((r) =>
        fetchRaceOdds(r.stateCode).then(
          (d) => [r.stateCode, d],
          () => null
        )
      )
    ).then((rows) => alive && setOdds(Object.fromEntries(rows.filter(Boolean))));
    return () => {
      alive = false;
    };
  }, [version]);
  return odds;
}

// Current odds for every watched House district, { "NY-17": { sources }, ... }, or null.
export function useHouseOdds() {
  const [odds, setOdds] = useState(null);
  const version = useDataVersion();
  useEffect(() => {
    let alive = true;
    fetchHouseRaces()
      .then((d) => alive && setOdds(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [version]);
  return odds;
}

// ---- Live results ---------------------------------------------------------
// One shared poll feeds every useResults() caller (map, drawer, tallies), so
// three mounted components cost one /api/results request a minute, not three. The
// poll runs only while something is subscribed, i.e. during the results window.
const RESULTS_POLL_MS = 60 * 1000;
let liveResults = null;
let resultsTimer = null;
const resultsListeners = new Set();

function loadResults() {
  fetchResults()
    .then((d) => {
      // Merge per race so one with no entry this poll keeps its last good one.
      liveResults = {
        races: { ...liveResults?.races, ...d.races },
        lastUpdated: d.lastUpdated ?? liveResults?.lastUpdated,
      };
      resultsListeners.forEach((fn) => fn());
    })
    .catch(() => {}); // keep what we have; the next tick retries
}

function subscribeResults(fn) {
  resultsListeners.add(fn);
  if (resultsListeners.size === 1) {
    loadResults();
    resultsTimer = setInterval(() => {
      if (document.visibilityState === "visible") loadResults();
    }, RESULTS_POLL_MS);
  }
  return () => {
    resultsListeners.delete(fn);
    if (!resultsListeners.size) clearInterval(resultsTimer);
  };
}

const noSubscribe = () => () => {};
const getLiveResults = () => liveResults;

// Live vote counts, { races: { GA: {...}, "NY-17": {...} }, lastUpdated }, or null
// outside the results window (see isResultsMode) or before the first response.
// ?simulateVotes=1 swaps the fetch for deterministic synthetic counts.
export function useResults() {
  const now = useElectionNow();
  const active = isResultsMode(now);
  const live = useSyncExternalStore(
    active && !SIMULATE_VOTES ? subscribeResults : noSubscribe,
    getLiveResults
  );
  return useMemo(() => {
    if (!active) return null;
    return SIMULATE_VOTES ? simulatedResults(now) : live;
  }, [active, now, live]);
}

// The Election Day morning market favorites, { GA: "D", ... }, or null (see
// fetchMorning); re-read on each live-data refresh.
export function useMorning() {
  const [morning, setMorning] = useState(null);
  const version = useDataVersion();
  useEffect(() => {
    let alive = true;
    fetchMorning().then((m) => alive && setMorning(m));
    return () => {
      alive = false;
    };
  }, [version]);
  return morning;
}

// Whole days from today to Election Day, counted on the US Eastern calendar so
// the number flips at midnight ET for everyone. 0 on the day, negative after.
export function daysToElection(now) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  return Math.round((Date.parse(ELECTION_DAY) - Date.parse(today)) / 86400000);
}

// ---- 2028 presidential primaries ----------------------------------------
// Shared shape: { data, loading, error }. The result is stored with the key it was
// fetched for, so a changed party/range reads as loading until its own data lands.
function useKeyedFetch(key, fetcher, enabled = true) {
  const [state, setState] = useState({ key: null, data: null, error: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    fetcher().then(
      (data) => alive && setState({ key, data, error: null }),
      (error) => alive && setState({ key, data: null, error })
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  const current = enabled && state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: enabled && !current,
  };
}

// Nomination market odds for one party ("dem" | "rep"); re-fetched on each live-data refresh.
export function useNomination(party) {
  const version = useDataVersion();
  return useKeyedFetch(`${party}:${version}`, () => fetchNomination(party));
}

// National primary polling for one party; re-fetched on each live-data refresh.
export function usePrimaryPolls(party) {
  const version = useDataVersion();
  return useKeyedFetch(`${party}:${version}`, () => fetchPrimaryPolls(party));
}

// Lazy price history for the top nomination candidates: nothing is fetched until
// `enabled` is true (e.g. when a chart is expanded). Memoized per party + range.
export function useNominationHistory(party, range = "all", enabled = true) {
  const version = useDataVersion();
  return useKeyedFetch(`${party}:${range}:${version}`, () => fetchNominationHistory(party, range), enabled);
}
