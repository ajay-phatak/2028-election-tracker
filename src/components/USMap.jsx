import { useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import topology from "us-atlas/states-10m.json";
import { CATEGORIES, SENATE_OUTLOOK, WATCHED_RACES } from "../config/races.config";
import { getRaceByStateName } from "../lib/races";
import { CALLS_FOOTNOTE, morningFavorite, raceCall } from "../lib/calls";
import { isElectionNight, isResultsMode, pollsCloseLabel } from "../lib/electionNight";
import { useElectionNow, useMorning, useResults, useSenateOdds } from "../lib/liveData";
import CallBadge from "./CallBadge";
import ResultsCredit from "./ResultsCredit";
import Takeaway from "./Takeaway";

const NEUTRAL = "#1c2230";

// Takeaway math: Democrats start from the D-caucus seats not up plus the safe
// untracked D seats, and need the rest of a majority from the watched races
// (NE's and ID's independents are explained in their drawers).
const DEM_BASE =
  SENATE_OUTLOOK.holdovers.dem +
  Object.values(SENATE_OUTLOOK.untracked).filter((u) => u.party === "D").length;
const DEM_NEEDED = SENATE_OUTLOOK.majority - DEM_BASE;
const MAP_RACES = WATCHED_RACES.senate.length;
const NEUTRAL_STROKE = "#0a0e17";

// Results-mode palette (see ResultsLegend): outline = Election Day morning market
// favorite; fill = no votes yet / currently leading (light) / called (dark).
const OUTLINE = { D: "#2563eb", R: "#dc2626" };
const LEADING = { D: "#93c5fd", R: "#fca5a5" };
const CALLED = { D: "#1d4ed8", R: "#b91c1c" };
const NO_VOTES = "#334155"; // lighter than NEUTRAL so a watched state still reads as one

function ResultsLegend() {
  const items = [
    { label: "Outline: Election Day morning market favorite", swatch: { border: `2px solid ${OUTLINE.D}` } },
    { label: "Light fill: currently leading", swatch: { backgroundColor: LEADING.D } },
    { label: "Dark fill: called", swatch: { backgroundColor: CALLED.D } },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ops-muted">Results</span>
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm" style={i.swatch} />
          <span className="text-xs font-medium text-ops-muted">{i.label}</span>
        </div>
      ))}
    </div>
  );
}

// The vote leader ("D" | "R") from a results entry, or null with no votes / a tie.
function voteLeader(result) {
  const d = result?.dem?.votes ?? 0;
  const r = result?.rep?.votes ?? 0;
  return d === r ? null : d > r ? "D" : "R";
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ops-muted">
        Categories<span className="text-accent">*</span>
      </span>
      {Object.values(CATEGORIES).map((cat) => (
        <div key={cat.label} className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-sm"
            style={{ backgroundColor: cat.color, boxShadow: `0 0 6px ${cat.color}` }}
          />
          <span className="text-xs font-medium text-ops-muted">{cat.label}</span>
        </div>
      ))}
    </div>
  );
}

// "47.2% reporting" and the vote leader, once any votes are in.
function ResultsTooltip({ race, result }) {
  const leader = voteLeader(result);
  const lead = leader && result[leader === "D" ? "dem" : "rep"];
  return (
    <div className="mt-1 text-[11px] text-ops-muted tabular">
      <div>{result.pct}% reporting</div>
      {lead && (
        <div style={{ color: OUTLINE[leader] }}>
          Leading: {lead.name} ({leader === "D" && race.independent ? "I" : leader}) {lead.percent}%
        </div>
      )}
    </div>
  );
}

export default function USMap({ onSelectRace }) {
  const [tooltip, setTooltip] = useState(null); // { x, y, race }

  // Election night: states still voting show when polls close; once closed, a
  // market call (see lib/calls.js) outlines the state in the winner's color.
  // Results mode (vote counts from civicAPI) additionally paints the vote leader
  // and the Election Day morning favorite; a call is then results- or market-based.
  const now = useElectionNow();
  const odds = useSenateOdds();
  const resultsMode = isResultsMode(now);
  const results = useResults()?.races;
  const morning = useMorning();
  const calls = {};
  for (const r of WATCHED_RACES.senate) {
    const call = raceCall(r, odds?.[r.stateCode]?.sources, now, results?.[r.stateCode]);
    if (call) calls[r.stateCode] = call;
  }

  return (
    <div>
      <div className="mb-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ops-text">
            Senate Battleground Map
          </h2>
          <p className="text-xs text-ops-muted">
            Click a highlighted state for odds, polls &amp; news
          </p>
        </div>
        {resultsMode ? <ResultsLegend /> : <Legend />}
      </div>

      <div
        className="relative h-[300px] overflow-hidden rounded-xl border border-ops-border bg-ops-panel/40 sm:h-[340px]"
        onMouseLeave={() => setTooltip(null)}
      >
        {/* The default 800x600 viewBox leaves ~50px of dead space above and below
            the drawn map; the explicit viewBox crops it so the map fills the panel. */}
        <ComposableMap
          projection="geoAlbersUsa"
          projectionConfig={{ scale: 1100 }}
          viewBox="0 48 800 512"
          className="h-full w-full"
          style={{ width: "100%", height: "100%" }}
        >
          <Geographies geography={topology}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const race = getRaceByStateName(geo.properties.name);
                const isWatched = Boolean(race);
                const called = isWatched ? calls[race.stateCode] : null;
                const calledStroke = called?.party === "D" ? "#3b82f6" : "#ef4444";
                let fill = isWatched ? CATEGORIES[race.category].color : NEUTRAL;
                let stroke = called ? calledStroke : isWatched ? "#0a0e17" : NEUTRAL_STROKE;
                let strokeWidth = called ? 1.6 : 0.6;
                if (resultsMode && isWatched) {
                  const leader = voteLeader(results?.[race.stateCode]);
                  fill = called ? CALLED[called.party] : leader ? LEADING[leader] : NO_VOTES;
                  stroke =
                    OUTLINE[morningFavorite(race, odds?.[race.stateCode]?.sources, morning)];
                  strokeWidth = 2;
                }

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    className={isWatched ? "watched-state" : undefined}
                    onClick={isWatched ? () => onSelectRace(race.stateCode) : undefined}
                    onMouseMove={
                      isWatched
                        ? (e) => {
                            const box = e.currentTarget
                              .closest("div.relative")
                              .getBoundingClientRect();
                            setTooltip({
                              x: e.clientX - box.left,
                              y: e.clientY - box.top,
                              race,
                            });
                          }
                        : undefined
                    }
                    onMouseLeave={isWatched ? () => setTooltip(null) : undefined}
                    style={{
                      default: {
                        fill,
                        stroke,
                        strokeWidth,
                        outline: "none",
                      },
                      hover: {
                        fill,
                        stroke: resultsMode && isWatched ? stroke : isWatched ? "#ffffff" : NEUTRAL_STROKE,
                        strokeWidth: resultsMode && isWatched ? 3 : isWatched ? 1 : 0.6,
                        outline: "none",
                        cursor: isWatched ? "pointer" : "default",
                      },
                      pressed: { fill, outline: "none" },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ComposableMap>

        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-ops-border bg-ops-panel px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: tooltip.x, top: tooltip.y - 10 }}
          >
            <div className="font-semibold text-ops-text">{tooltip.race.state}</div>
            <div className="text-ops-muted">
              {tooltip.race.incumbent} ({tooltip.race.party})
            </div>
            <div
              className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: CATEGORIES[tooltip.race.category].color }}
            >
              {CATEGORIES[tooltip.race.category].label}
            </div>
            {resultsMode && results?.[tooltip.race.stateCode] && (
              <ResultsTooltip race={tooltip.race} result={results[tooltip.race.stateCode]} />
            )}
            {calls[tooltip.race.stateCode] ? (
              <div className="mt-1">
                <CallBadge race={tooltip.race} call={calls[tooltip.race.stateCode]} />
              </div>
            ) : (
              pollsCloseLabel(tooltip.race.stateCode, now) && (
                <div className="mt-1 text-[10px] font-semibold text-accent">
                  {pollsCloseLabel(tooltip.race.stateCode, now)}
                </div>
              )
            )}
          </div>
        )}
      </div>

      <div className="mt-2.5 flex justify-center">
        <Takeaway>
          Democrats need <b>{DEM_NEEDED} more seats</b> from the <b>{MAP_RACES} races on the map</b>{" "}
          to take control of the Senate.
        </Takeaway>
      </div>
      {Object.keys(calls).length > 0 && !isElectionNight(now) && (
        <p className="mt-1.5 text-center text-[10px] text-ops-muted/60">{CALLS_FOOTNOTE}</p>
      )}
      {resultsMode && (
        <p className="mt-1.5 text-center text-[10px] text-ops-muted/60">
          <ResultsCredit />
        </p>
      )}
      <p className="mt-1.5 text-center text-[10px] text-ops-muted/60">
        <span className="text-accent">*</span> Categories are based on Ajay’s subjective opinion
        and will be updated as the race develops.
      </p>
    </div>
  );
}
