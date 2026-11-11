// TODO(2028): fill in after the general-election races exist on civicAPI.
// civicAPI race IDs for the watched general-election races, keyed by Senate stateCode
// ("GA") or House district code ("NY-17"): { "GA": 12345, ... }. Resolve each ID once
// via civicAPI's search, then verify by a by-ID fetch (type, state/district, general
// date, both nominees). Races missing here are simply not shown live.
// api/_results.js fetches by these IDs.
export const CIVIC_IDS = {};
