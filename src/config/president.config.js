// 2028 presidential PRIMARY data-layer config. Plain ESM (no extensionless imports)
// so both the client and the api/functions code can import it, like election.js.
//
// Candidates are NOT listed here: they come from the market + polling data. This
// file only says where each party's data lives and how to tidy it.

// phase: "primary" (contested), "presumptive" (clear frontrunner, not yet formal),
// "nominee" (set `nominee` to the candidate's display name). Informational for now.
export const PARTIES = {
  dem: {
    label: "Democratic",
    phase: "primary",
    nominee: null,
    polymarketSlug: "democratic-presidential-nominee-2028",
    kalshiSeries: "KXPRESNOMD",
    kalshiEvent: "KXPRESNOMD-28",
    votehubAverageKey: "dem_primary_2028",
    pollSubject: "2028 Democratic",
  },
  rep: {
    label: "Republican",
    phase: "primary",
    nominee: null,
    polymarketSlug: "republican-presidential-nominee-2028",
    kalshiSeries: "KXPRESNOMR",
    kalshiEvent: "KXPRESNOMR-28",
    votehubAverageKey: null, // VoteHub has no rep_primary_2028 average (404) -> trailing mean from raw polls
    pollSubject: "2028 Republican",
  },
};

export const PARTY_IDS = Object.keys(PARTIES);

// General-election party odds. Recorded only; no general-election features yet.
// Kalshi tickers are <event>-D / -R and use a FOUR-digit year (KXPRESPARTY-2028-D),
// unlike the `-<YY>-` builder in api/_providers.js.
export const GENERAL = {
  kalshiPartyEvent: "KXPRESPARTY-2028",
  polymarketSlug: null, // TODO(2028): find the Polymarket "which party wins the 2028 presidency" event slug
};

// Name variants that normalization alone (case/punctuation/diacritics) cannot merge.
// Keys and values are NORMALIZED names (lowercase, no punctuation; see candidateId).
// Only add a variant once it has been seen in live data.
export const CANDIDATE_ALIASES = {
  aoc: "alexandria ocasio cortez",
};

export const TUNABLES = {
  maxCandidates: 12, // candidates returned per party (odds and polls)
  minOddsPct: 1, // drop market candidates whose average odds are below this (0-100)
  minPollPct: 1, // drop poll candidates below this (0-100)
  historyCandidates: 5, // top-N candidates that get a price history
  trailingWindowDays: 90, // trailing-mean window for polls without a VoteHub average
  trailingMinPolls: 5, // widen to the most recent N polls when fewer fall in the window
  minPollsPerCandidate: 2, // a candidate needs this many polls in the window to be averaged
  trendWindowDays: 30, // rolling window for the trailing-mean trend
  trendMaxDays: 540, // how far back trends go
  recentPolls: 8, // raw polls returned in recentPolls
};
