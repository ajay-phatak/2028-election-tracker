// TODO(2028): fill in from Cook Political Report ratings once available.
// Safe seats per state for the election-night House tally (src/lib/calls.js): the
// districts Cook rates Solid/Safe for a party, counted for that party once the
// state's polls have closed: { AL: { D: 1, R: 5 }, ... }. Every seat rated Likely or
// closer (all of the watchlist in races.config.js) is excluded and stays uncalled
// until its markets say otherwise. Totals should equal HOUSE_OUTLOOK.ratings
// safeD/safeR in races.config.js.
export const HOUSE_SAFE_SEATS = {};
