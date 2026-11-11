import { callText } from "../lib/calls";

const DEM = "#2563eb";
const REP = "#dc2626";

// "Results: called D" / "Markets: called R" — a vote-count or prediction-market
// call (`call` is raceCall's { party, by }), never an official one (pair with
// CALLS_FOOTNOTE).
export default function CallBadge({ race, call }) {
  const color = call.party === "D" ? DEM : REP;
  return (
    <span
      className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ color, backgroundColor: `${color}24` }}
    >
      {callText(race, call)}
    </span>
  );
}
