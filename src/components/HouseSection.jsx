import { useEffect, useMemo, useState } from "react";
import { WATCHED_RACES, RATINGS, HOUSE_OUTLOOK } from "../config/races.config";
import { fetchHouseRaces, sourceHasData } from "../lib/api";
import { useDataVersion } from "../lib/liveData";
import SourceTag from "./SourceTag";
import Takeaway from "./Takeaway";

const DEM = "#2563eb";
const REP = "#dc2626";

// Most-competitive first when sorting by rating.
const RATING_RANK = { tossup: 0, leanD: 1, leanR: 1, likelyD: 2, likelyR: 2, safeD: 3, safeR: 3 };

// Pull the leading side from a district's market sources (Polymarket only for House).
function marketLead(entry) {
  const src = entry?.sources?.find(sourceHasData);
  if (!src) return null;
  const demLeads = src.demYes >= src.repYes;
  return { party: demLeads ? "D" : "R", pct: demLeads ? src.demYes : src.repYes };
}

function RatingBadge({ rating }) {
  const r = RATINGS[rating];
  if (!r) return null;
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ color: r.color, backgroundColor: `${r.color}24` }}
    >
      {r.label}
    </span>
  );
}

// ---- Seats-to-218 balance bar ------------------------------------------

function SeatsBar() {
  const { current, total, majority } = HOUSE_OUTLOOK;
  const pct = (n) => `${total ? (n / total) * 100 : 0}%`;
  const needed = Math.max(0, majority - current.dem);

  return (
    <div>
      <div className="mb-2 flex items-end justify-between text-xs">
        <span className="font-semibold" style={{ color: DEM }}>
          {current.dem} <span className="text-ops-muted">DEM</span>
        </span>
        <span className="text-[10px] uppercase tracking-wide text-ops-muted">
          {majority} for majority
        </span>
        <span className="font-semibold" style={{ color: REP }}>
          <span className="text-ops-muted">GOP</span> {current.rep}
        </span>
      </div>

      <div className="relative h-3 w-full overflow-hidden rounded-full bg-ops-border">
        <div className="absolute left-0 top-0 h-full" style={{ width: pct(current.dem), backgroundColor: DEM }} />
        <div className="absolute right-0 top-0 h-full" style={{ width: pct(current.rep), backgroundColor: REP }} />
        {/* 218-seat majority line */}
        <div className="absolute top-[-2px] h-[calc(100%+4px)] w-px bg-ops-text/80" style={{ left: pct(majority) }} />
      </div>

      <Takeaway className="mt-2">
        Democrats need a net <b>+{needed} seats</b> to take the House
        {current.ind ? ` · ${current.ind} independent` : ""}
        {current.vacant ? ` · ${current.vacant} vacant` : ""}
      </Takeaway>
    </div>
  );
}

// ---- Rollup bars (path to 218) ------------------------------------------

// Shared 435-seat rollup bar: 7 rating buckets + the 218 majority line.
function Rollup({ caption, tag, counts, footnote }) {
  const { total, majority } = HOUSE_OUTLOOK;
  const order = Object.keys(RATINGS); // safeD ... safeR
  const demBase = counts.safeD + counts.likelyD + counts.leanD;
  const repBase = counts.safeR + counts.likelyR + counts.leanR;
  const demNeed = Math.max(0, majority - demBase);
  const repNeed = Math.max(0, majority - repBase);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ops-muted">
          <span className="truncate">{caption}</span>
          {tag && <SourceTag kind={tag} />}
        </div>
        <div className="whitespace-nowrap text-[11px] font-semibold tabular" title="Seats rated lean or better">
          <span style={{ color: DEM }}>{demBase} D</span>
          <span className="font-normal text-ops-muted"> · </span>
          <span style={{ color: REP }}>{repBase} R</span>
        </div>
      </div>
      <div className="relative flex h-3 w-full overflow-hidden rounded-full bg-ops-border">
        {order.map((key) => (
          <div
            key={key}
            title={`${RATINGS[key].label}: ${counts[key]}`}
            style={{ width: `${total ? (counts[key] / total) * 100 : 0}%`, backgroundColor: RATINGS[key].color }}
          />
        ))}
        <div className="absolute top-[-2px] h-[calc(100%+4px)] w-px bg-ops-text/80" style={{ left: `${total ? (majority / total) * 100 : 0}%` }} />
      </div>
      <Takeaway className="mt-2">
        Dems need <b>{demNeed} of {counts.tossup}</b> toss-ups · GOP needs <b>{repNeed}</b>
      </Takeaway>
      {footnote && (
        <p className="mt-1 text-[10px] uppercase tracking-wide text-ops-muted/60">{footnote}</p>
      )}
    </div>
  );
}

function RatingsRollup() {
  return <Rollup caption="All 435 seats by rating" tag="rating" counts={HOUSE_OUTLOOK.ratings} />;
}

// Bucket a district's market favorite into a rating-equivalent by the raw D−R
// spread. Thresholds were calibrated to natural gaps in the district odds when
// first set (|spread| clustered at ≤11, 16.5–28, 37–49.5, ≥56): under 15 toss-up, under 35
// lean, under 55 likely, else safe. Districts without a two-sided market keep
// their hand-curated rating.
function marketBucket(entry) {
  const src = entry?.sources?.find((s) => s.demYes != null && s.repYes != null);
  if (!src) return null;
  const spread = src.demYes - src.repYes;
  const abs = Math.abs(spread);
  if (abs < 15) return "tossup";
  const band = abs < 35 ? "lean" : abs < 55 ? "likely" : "safe";
  return `${band}${spread > 0 ? "D" : "R"}`;
}

// Same bar, but watchlist seats move to the bucket the betting market implies;
// all other (non-competitive) seats keep their rating.
function MarketRollup({ odds }) {
  const counts = useMemo(() => {
    const c = { ...HOUSE_OUTLOOK.ratings };
    for (const d of WATCHED_RACES.house) {
      const bucket = odds ? marketBucket(odds[d.code]) : null;
      if (bucket && bucket !== d.rating) {
        c[d.rating] -= 1;
        c[bucket] += 1;
      }
    }
    return c;
  }, [odds]);

  if (!odds) {
    return (
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ops-muted">
          All 435 by market consensus
          <SourceTag kind="market" />
        </div>
        <div className="h-3 w-full animate-pulse rounded-full bg-ops-border" />
        <div className="mt-2 h-12 animate-pulse rounded bg-ops-panel-2/60" />
      </div>
    );
  }

  return (
    <Rollup
      caption="All 435 by market consensus"
      tag="market"
      counts={counts}
      footnote="Watchlist seats bucketed by market spread (±15/35/55) · rest keep rating"
    />
  );
}

// ---- Watchlist table ---------------------------------------------------

function Watchlist({ odds, onSelectRace }) {
  const [sort, setSort] = useState("rating"); // rating | district | market
  const districts = WATCHED_RACES.house;

  const rows = useMemo(() => {
    const withLead = districts.map((d) => ({ ...d, lead: marketLead(odds?.[d.code]) }));
    const cmp = {
      district: (a, b) => a.code.localeCompare(b.code),
      rating: (a, b) => (RATING_RANK[a.rating] - RATING_RANK[b.rating]) || a.code.localeCompare(b.code),
      market: (a, b) => (b.lead?.pct ?? -1) - (a.lead?.pct ?? -1),
    }[sort];
    return [...withLead].sort(cmp);
  }, [districts, odds, sort]);

  // Plain render helper (not a component) — sortable column header. `label`
  // can be text or a SourceTag chip.
  const sortHeader = (id, label, className = "") => (
    <th className={`py-2 font-semibold ${className}`}>
      <button
        type="button"
        onClick={() => setSort(id)}
        title={`Sort by ${id}`}
        className={`uppercase tracking-wide transition-colors hover:text-ops-text ${
          sort === id ? "text-ops-text" : "text-ops-muted"
        }`}
      >
        {label}
      </button>
    </th>
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ops-muted">
          Competitive districts ({districts.length})
        </div>
        <span className="text-[10px] uppercase tracking-wide text-ops-muted/60">click a row for detail</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm [&_td]:pr-4 [&_th]:pr-4">
          <thead>
            {/* Banded row + heavier rule so the chip labels still read as column headers */}
            <tr className="border-b-2 border-ops-border bg-ops-panel-2/50 text-[10px]">
              {sortHeader("district", "District", "pl-2")}
              <th className="py-2 font-semibold text-[10px] uppercase tracking-wide text-ops-muted">Incumbent</th>
              {sortHeader("rating", <SourceTag kind="rating" />)}
              {sortHeader("market", <SourceTag kind="market" />, "text-right")}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr
                key={d.code}
                onClick={() => onSelectRace(d.code)}
                className="cursor-pointer border-b border-ops-border/50 transition-colors hover:bg-ops-panel-2/60"
              >
                <td className="py-2 pl-2 font-semibold text-ops-text">{d.district}</td>
                <td className="py-2 text-ops-muted">
                  {d.incumbent}{" "}
                  <span
                    className="ml-0.5 text-[10px] font-bold"
                    style={{ color: d.party === "D" ? DEM : REP }}
                  >
                    ({d.party})
                  </span>
                </td>
                <td className="py-2"><RatingBadge rating={d.rating} /></td>
                <td className="py-2 text-right tabular">
                  {d.lead ? (
                    <span className="font-semibold" style={{ color: d.lead.party === "D" ? DEM : REP }}>
                      {d.lead.party} {d.lead.pct}%
                    </span>
                  ) : (
                    <span className="text-ops-muted/50">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] uppercase tracking-wide text-ops-muted/60">
        Ratings: {HOUSE_OUTLOOK.source} · {HOUSE_OUTLOOK.asOf} · market odds via Polymarket
      </p>
    </div>
  );
}

// ---- Section -----------------------------------------------------------

export default function HouseSection({ onSelectRace }) {
  const [odds, setOdds] = useState(null);
  const version = useDataVersion();

  // Re-runs on each live-data refresh; the previous odds stay up meanwhile.
  useEffect(() => {
    let alive = true;
    fetchHouseRaces()
      .then((d) => alive && setOdds(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [version]);

  return (
    <section className="rounded-2xl border border-ops-border bg-ops-panel/40 p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ops-text">
          House — Battle for the Majority
        </h2>
        <p className="text-xs text-ops-muted">
          435 seats · 218 to control · watchlist of the most competitive districts
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <SeatsBar />
        <RatingsRollup />
        <MarketRollup odds={odds} />
      </div>

      <div className="mt-6">
        <Watchlist odds={odds} onSelectRace={onSelectRace} />
      </div>
    </section>
  );
}
