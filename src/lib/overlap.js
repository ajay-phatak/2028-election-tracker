// Middle-band colors and label for two-sided market bars (see OverlapBar).
export const PURPLE = "#9333ea";
export const GREY = "#3a4150";

// Describes the middle band, or null when the values sum to exactly 100.
export function overlapInfo(demYes, repYes) {
  if (demYes == null || repYes == null) return null;
  const sum = demYes + repYes;
  const delta = Math.round(Math.abs(100 - sum) * 10) / 10;
  if (delta === 0) return null;
  return sum > 100
    ? { text: `+${delta}% overlap`, color: PURPLE }
    : { text: `${delta}% gap`, color: GREY };
}
