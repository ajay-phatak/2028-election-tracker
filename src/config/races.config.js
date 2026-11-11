// General election day (YYYY-MM-DD, US Eastern calendar). THE single source of truth
// for the election year: src/config/election.js derives YEAR, the election-night
// windows and the morning-snapshot time from it; the header countdown uses it too.
export const ELECTION_DAY = "2028-11-07";

// TODO(2028): fill in. Per-race market identifiers are discovered from the live APIs:
//   polymarketSlug -> gamma-api.polymarket.com/events?slug=<slug> (party-named sub-markets)
//   kalshiMarketId -> external-api.kalshi.com .../markets?series_ticker=<id>
//
// Senate entry schema:
//   { state, stateCode, category (key of CATEGORIES), incumbent ("Open seat" if the sitting
//     senator isn't on the ballot), party ("D"|"R"), kalshiMarketId, kalshiDemTicker?
//     (override when the anti-GOP candidate is an independent), polymarketSlug,
//     independent? (surname of an independent on the "dem" side),
//     candidates: { dem, rep }, pollParties: { dem: [name fragments], rep: [...] } }
//   pollParties fragments are matched case-insensitively as substrings against VoteHub
//   us-senator answer choices; list ONLY general-election nominees.
// House entry schema:
//   { code ("NY-17"), state, district, incumbent, party, candidates: { dem, rep },
//     rating (key of RATINGS), polymarketSlug? }
export const WATCHED_RACES = {
  senate: [],
  house: [],
}

// TODO(2028): fill in. Senate math for the election-night tally.
//   holdovers = seats NOT up this cycle ({ dem, rep }; independents who caucus count with D)
//   seatsUp   = seats up this cycle
//   untracked = seats up that aren't on the watchlist: { [stateCode]: { party, safe } }
//               (safe: true counts for the holder once the state's polls close)
//   holdovers.dem + holdovers.rep + seatsUp should equal total.
export const SENATE_OUTLOOK = {
  majority: 51,
  total: 100,
  holdovers: { dem: 0, rep: 0 },
  seatsUp: 0,
  untracked: {},
}

// TODO(2028): fill in. Chamber-control markets shown in the top MacroMetrics cards.
//   polymarketSlug: Polymarket event slug; kalshi: { series, demTicker, repTicker }
//   (per-party markets, e.g. <SERIES>-<YY>-D / -R).
export const CONTROL_MARKETS = {
  senate: {
    polymarketSlug: "",
    kalshi: { series: "", demTicker: "", repTicker: "" },
  },
  house: {
    polymarketSlug: "",
    kalshi: { series: "", demTicker: "", repTicker: "" },
  },
}

// Dark-blue -> light-blue gradient across the difficulty spectrum (easier to scan).
// Tiers are named by how likely a Democratic win is, NOT by hold-vs-flip: the old
// "Must Keep"/"Easy Flip" split implied the held seats were the safest ones, which
// the odds don't bear out (a held seat can be shakier than a favorable pickup).
export const CATEGORIES = {
  favored:     { label: "Favored",     color: "#1e3a8a" },
  competitive: { label: "Competitive", color: "#2563eb" },
  uphill:      { label: "Uphill",      color: "#60a5fa" },
  long_shot:   { label: "Long Shot",   color: "#bfdbfe" },
}

// House race ratings (blue -> grey -> red). Used for the watchlist badges and the
// path-to-218 rollup. Order matters: it's the left-to-right order of the rollup bar.
export const RATINGS = {
  safeD:   { label: "Safe D",   short: "D", color: "#1e3a8a" },
  likelyD: { label: "Likely D", short: "D", color: "#2563eb" },
  leanD:   { label: "Lean D",   short: "D", color: "#60a5fa" },
  tossup:  { label: "Toss-up",  short: "—", color: "#9ca3af" },
  leanR:   { label: "Lean R",   short: "R", color: "#f87171" },
  likelyR: { label: "Likely R", short: "R", color: "#dc2626" },
  safeR:   { label: "Safe R",   short: "R", color: "#991b1b" },
}

// TODO(2028): fill in. Static, hand-maintained House outlook: drives the "seats to 218"
// bar and the ratings rollup. `ratings` counts (keys of RATINGS) must sum to `total`;
// `current` is the sworn House (dem/rep/ind/vacant).
export const HOUSE_OUTLOOK = {
  majority: 218,
  total: 435,
  current: { dem: 0, rep: 0, ind: 0, vacant: 0 },
  ratings: { safeD: 0, likelyD: 0, leanD: 0, tossup: 0, leanR: 0, likelyR: 0, safeR: 0 },
  asOf: "",
  source: "Cook Political Report race ratings",
}
