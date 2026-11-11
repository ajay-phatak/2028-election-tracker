// History-chart ranges shared by the RangeSelector component and its callers
// (kept out of the component file so React fast refresh works there).

export const POLL_RANGES = [
  { id: "all", label: "All", days: null },
  { id: "90d", label: "90D", days: 90 },
  { id: "30d", label: "30D", days: 30 },
];

// Same { id, label, days } shape as POLL_RANGES, plus 7D/24H — market history
// supports finer windows because the server fetches sub-daily candles for
// them (see MARKET_RANGES in api/_providers.js), unlike polls which are at
// most daily.
export const MARKET_RANGES = [
  { id: "all", label: "All", days: null },
  { id: "90d", label: "90D", days: 90 },
  { id: "30d", label: "30D", days: 30 },
  { id: "7d", label: "7D", days: 7 },
  { id: "24h", label: "24H", days: 1 },
];

// Slice `data` (rows sorted oldest -> newest, each { t: unixSeconds, ... }) to the
// trailing `days` window. `days` null/0 returns the data unchanged ("All").
//
// Deliberately anchored to the NEWEST POINT IN THE SERIES rather than Date.now():
// per-race polling trends can go stale (most recent poll weeks old) while a
// range selector is still open, and slicing against "now" would silently blank
// the chart instead of showing the last real data.
export function sliceRange(data, days) {
  if (!days || !data || data.length < 2) return data;
  const newest = data[data.length - 1].t;
  const cutoff = newest - days * 86400;
  return data.filter((p) => p.t >= cutoff);
}
