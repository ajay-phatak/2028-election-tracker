// Bar for two-sided prediction markets where Dem-Yes and Rep-Yes are read
// independently and need not sum to 100%:
//   sum > 100  -> the two segments overlap; the overlap renders PURPLE
//   sum < 100  -> the market leaves slack; the gap renders GREY
//   sum = 100  -> clean split, no middle band

import { GREY, PURPLE } from "../lib/overlap";

const DEM = "#2563eb";
const REP = "#dc2626";

export default function OverlapBar({ demYes, repYes }) {
  if (demYes == null || repYes == null) return null;

  const sum = demYes + repYes;
  const overlap = sum > 100;
  const mid = Math.abs(100 - sum);
  // In the overlap case each colored segment shrinks to its "exclusive" share so
  // the shared middle reads as a single band; otherwise they take their full value.
  const blue = Math.max(0, overlap ? 100 - repYes : demYes);
  const red = Math.max(0, overlap ? 100 - demYes : repYes);
  const midColor = overlap ? PURPLE : GREY;

  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-ops-border">
      <div
        className="h-full transition-all duration-500"
        style={{ width: `${blue}%`, backgroundColor: DEM }}
      />
      {mid > 0 && (
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${mid}%`, backgroundColor: midColor }}
        />
      )}
      <div
        className="h-full transition-all duration-500"
        style={{ width: `${red}%`, backgroundColor: REP }}
      />
    </div>
  );
}
