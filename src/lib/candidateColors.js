// Categorical candidate colours for the presidential panels. The eight hues are the
// dataviz skill's reference palette stepped for a dark surface (validated against
// the ops-panel background: lightness band, chroma, adjacent-pair colour-blind
// separation and 3:1 contrast all pass). Colour-blind separation sits in the 6-8
// floor band, so identity is never colour alone: every colour is paired with a
// name (leaderboard rows, chart legends).
export const CANDIDATE_PALETTE = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
];

// Beyond the palette a candidate is a neutral grey rather than a generated hue.
export const NEUTRAL_COLOR = "#6b778c";

// Assign colours in fixed order, first come first served, never cycled. Pass id
// lists in priority order (e.g. market ranking, then poll ranking, then history):
// an id keeps the colour it first earned, so the same candidate is the same colour
// in the leaderboard bar, both charts and their legends, whatever the sort or
// the chart's candidate subset. Returns a function id -> hex.
export function assignCandidateColors(...idLists) {
  const map = new Map();
  for (const list of idLists) {
    for (const id of list || []) {
      if (id != null && !map.has(id) && map.size < CANDIDATE_PALETTE.length) {
        map.set(id, CANDIDATE_PALETTE[map.size]);
      }
    }
  }
  return (id) => map.get(id) ?? NEUTRAL_COLOR;
}
