// One party's panel in the 2028 presidential primaries view (and its compact
// presumptive/nominee form). All joining / text / series logic lives in
// src/lib/primaries.js; colours in src/lib/candidateColors.js.
import { useEffect, useMemo, useRef, useState } from "react";
import { PARTIES } from "../config/president.config";
import { useNomination, useNominationHistory, usePrimaryPolls } from "../lib/liveData";
import { assignCandidateColors } from "../lib/candidateColors";
import { formatDay } from "../lib/format";
import { MARKET_RANGES } from "../lib/ranges";
import {
  buildHistorySeries,
  buildPollTrendSeries,
  buildTakeaway,
  defaultHistorySource,
  fmtPct,
  joinCandidates,
  pollMethodCaption,
  safeUrl,
  sampleLabel,
  sortRows,
  topAnswers,
} from "../lib/primaries";
import LazyTrendChart from "./LazyTrendChart";
import RangeSelector from "./RangeSelector";
import SourceTag from "./SourceTag";
import Takeaway from "./Takeaway";
import VolumeStat from "./VolumeStat";

const DEFAULT_ROWS = 8;
const RECENT_COLLAPSED = 4;
const MARKET_COLOR = "#f59e0b"; // SourceTag "market" amber
const POLLS_COLOR = "#22d3ee"; // SourceTag "polls" teal

// ---- small shared bits ---------------------------------------------------

// Flips to true the first time the element scrolls near the viewport, so the
// history charts fetch only when seen. Falls back to true without IntersectionObserver.
function useSeenOnce() {
  const ref = useRef(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-0.5 rounded-full border border-ops-border bg-ops-panel-2/60 px-1 py-0.5"
    >
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
              active ? "bg-accent/15 text-accent" : "text-ops-muted hover:text-ops-text"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SubPanel({ title, tag, controls, children }) {
  return (
    <div className="rounded-xl border border-ops-border bg-ops-panel/60 p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ops-muted">
          <span className="truncate">{title}</span>
          {tag && <SourceTag kind={tag} />}
        </span>
        {controls}
      </div>
      {children}
    </div>
  );
}

const Quiet = ({ children, className = "" }) => (
  <p className={`py-6 text-center text-xs text-ops-muted ${className}`}>{children}</p>
);

const ChartSkeleton = () => <div className="h-56 animate-pulse rounded bg-ops-panel-2/60" />;

// ---- leaderboard ---------------------------------------------------------

const COLS = "sm:grid-cols-[1rem_minmax(0,1fr)_2.75rem_2.75rem_2.75rem] sm:grid-cols-[1.25rem_minmax(0,1fr)_3.5rem_3.5rem_3.5rem]";

function Leaderboard({ rows, colorOf, sortBy, onSort, expanded, onExpand }) {
  const sorted = useMemo(() => sortRows(rows, sortBy), [rows, sortBy]);
  const shown = expanded ? sorted : sorted.slice(0, DEFAULT_ROWS);
  const maxAvg = Math.max(0, ...shown.map((r) => r.avg ?? 0));
  return (
    <SubPanel
      title="Nomination leaderboard"
      controls={
        <Segmented
          label="Sort leaderboard by"
          value={sortBy}
          onChange={onSort}
          options={[
            { id: "avg", label: "Markets" },
            { id: "poll", label: "Polls" },
          ]}
        />
      }
    >
      <div className={`mb-1 hidden sm:grid ${COLS} items-end gap-x-2 text-[9px] font-semibold uppercase tracking-wide text-ops-muted`}>
        <span />
        <span className="flex items-center gap-1">
          Market avg <SourceTag kind="market" className="!px-1" />
        </span>
        <span className="text-right" title="Polymarket price">
          Poly
        </span>
        <span className="text-right" title="Kalshi price">
          Kalshi
        </span>
        <span className="text-right" title="National primary poll average">
          Polls
        </span>
      </div>
      <ol>
        {shown.map((r, i) => (
          <li key={r.id} className={`flex flex-col gap-1 sm:grid ${COLS} sm:items-center sm:gap-x-2 border-t border-ops-border/50 py-1.5 text-xs`}>
            <span className="tabular hidden text-[10px] text-ops-muted sm:block">{i + 1}</span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="tabular shrink-0 text-[10px] text-ops-muted sm:hidden">{i + 1}.</span>
                <span className="min-w-0 break-words font-medium text-ops-text sm:truncate" title={r.name}>
                  {r.name}
                </span>
                <span className="tabular ml-auto shrink-0 text-[11px] font-semibold text-ops-text">{fmtPct(r.avg)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ops-panel-2">
                {r.avg != null && maxAvg > 0 && (
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(2, (r.avg / maxAvg) * 100)}%`, backgroundColor: colorOf(r.id) }}
                  />
                )}
              </div>
            </div>
            <div className="tabular flex flex-wrap gap-x-3 pl-4 text-[11px] sm:hidden">
              <span style={{ color: MARKET_COLOR }}>Poly {fmtPct(r.polymarket)}</span>
              <span style={{ color: MARKET_COLOR }}>Kalshi {fmtPct(r.kalshi)}</span>
              <span style={{ color: POLLS_COLOR }}>Polls {fmtPct(r.poll)}</span>
            </div>
            <span className="tabular hidden text-right sm:block" style={{ color: MARKET_COLOR }}>
              {fmtPct(r.polymarket)}
            </span>
            <span className="tabular hidden text-right sm:block" style={{ color: MARKET_COLOR }}>
              {fmtPct(r.kalshi)}
            </span>
            <span className="tabular hidden text-right sm:block" style={{ color: POLLS_COLOR }}>
              {fmtPct(r.poll)}
            </span>
          </li>
        ))}
      </ol>
      {sorted.length > DEFAULT_ROWS && (
        <button
          type="button"
          onClick={() => onExpand(!expanded)}
          aria-expanded={expanded}
          className="mt-2 text-[11px] font-semibold text-accent hover:underline"
        >
          {expanded ? "Show fewer" : `Show all ${sorted.length}`}
        </button>
      )}
    </SubPanel>
  );
}

// ---- charts --------------------------------------------------------------

// Nomination odds history. Lazy: nothing is fetched until `enabled`.
function OddsHistory({ party, priorityIds, enabled }) {
  const [range, setRange] = useState("all");
  const [pickedSource, setPickedSource] = useState(null);
  const hist = useNominationHistory(party, range, enabled);
  const sourceId = pickedSource ?? defaultHistorySource(hist.data);
  const sources = hist.data?.sources || [];
  const view = useMemo(() => {
    const colorOf = assignCandidateColors(
      priorityIds,
      (hist.data?.candidates || []).map((c) => c.id)
    );
    return buildHistorySeries(hist.data, sourceId, colorOf);
  }, [hist.data, sourceId, priorityIds]);
  const volume = sources.find((s) => s.id === sourceId)?.volume;

  return (
    <SubPanel
      title="Nomination odds over time"
      tag="market"
      controls={
        <div className="flex flex-wrap items-center gap-1.5">
          {sources.length > 1 && (
            <Segmented
              label="Market source"
              value={sourceId}
              onChange={setPickedSource}
              options={sources.map((s) => ({ id: s.id, label: s.label }))}
            />
          )}
          <RangeSelector value={range} onChange={setRange} ranges={MARKET_RANGES} />
        </div>
      }
    >
      {!enabled || hist.loading ? (
        <ChartSkeleton />
      ) : hist.error ? (
        <Quiet>Couldn’t load odds history.</Quiet>
      ) : view.ok ? (
        <>
          <LazyTrendChart data={view.data} series={view.series} />
          {sourceId === "polymarket" && <VolumeStat volume={volume} />}
        </>
      ) : (
        <Quiet>No history in this window yet.</Quiet>
      )}
    </SubPanel>
  );
}

function PollTrend({ polls, colorOf }) {
  const view = useMemo(() => buildPollTrendSeries(polls.data, colorOf), [polls.data, colorOf]);
  return (
    <SubPanel title="National primary polling" tag="polls">
      {polls.loading ? (
        <ChartSkeleton />
      ) : polls.error ? (
        <Quiet>Couldn’t load polling.</Quiet>
      ) : view.ok ? (
        <>
          <LazyTrendChart data={view.data} series={view.series} utcDates />
          <p className="mt-2 text-[10px] text-ops-muted">{pollMethodCaption(polls.data)}</p>
        </>
      ) : (
        <>
          <Quiet className="pb-2">Not enough polling history to chart a trend yet.</Quiet>
          {polls.data && <p className="text-[10px] text-ops-muted">{pollMethodCaption(polls.data)}</p>}
        </>
      )}
    </SubPanel>
  );
}

// ---- recent polls --------------------------------------------------------

function RecentPolls({ polls, colorOf }) {
  const [open, setOpen] = useState(false);
  const all = polls.data?.recentPolls || [];
  const shown = open ? all : all.slice(0, RECENT_COLLAPSED);
  return (
    <SubPanel title="Recent polls" tag="polls">
      {polls.loading ? (
        <div className="h-24 animate-pulse rounded bg-ops-panel-2/60" />
      ) : polls.error ? (
        <Quiet>Couldn’t load recent polls.</Quiet>
      ) : !all.length ? (
        <Quiet>No recent polls.</Quiet>
      ) : (
        <>
          <ul>
            {shown.map((p, i) => {
              const url = safeUrl(p.url);
              const name = p.pollster || "Unknown pollster";
              return (
                <li key={`${p.pollster}-${p.endDate}-${i}`} className="border-t border-ops-border/50 py-2 text-xs first:border-t-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="min-w-0 max-w-full truncate font-medium text-ops-text">
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">
                          {name}
                        </a>
                      ) : (
                        name
                      )}
                      {p.grade && <span className="ml-1.5 rounded bg-ops-panel-2 px-1 text-[10px] text-ops-muted">{p.grade}</span>}
                    </span>
                    <span className="tabular shrink-0 text-[10px] text-ops-muted">
                      {formatDay(p.endDate)} · {sampleLabel(p)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {topAnswers(p, 4).map((a) => (
                      <span key={a.id ?? a.name} className="flex min-w-0 max-w-full items-center gap-1 text-[11px] text-ops-muted">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(a.id) }} />
                        <span className="truncate">{a.name ?? a.id}</span>
                        <span className="tabular shrink-0 font-semibold text-ops-text">{Math.round(a.pct)}%</span>
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          {all.length > RECENT_COLLAPSED && (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              className="mt-1 text-[11px] font-semibold text-accent hover:underline"
            >
              {open ? "Show fewer" : `Show all ${all.length}`}
            </button>
          )}
        </>
      )}
    </SubPanel>
  );
}

// ---- panel shells --------------------------------------------------------

const ACCENT = { dem: "border-t-dem", rep: "border-t-rep" };
const DOT = { dem: "bg-dem", rep: "bg-rep" };

function PanelFrame({ party, phaseLabel, children }) {
  return (
    <div className={`min-w-0 space-y-3 rounded-xl border border-ops-border border-t-2 bg-ops-panel/80 p-3 sm:p-4 ${ACCENT[party]}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[party]}`} aria-hidden="true" />
        <h3 className="text-sm font-bold uppercase tracking-wide text-ops-text">{PARTIES[party].label}</h3>
        {phaseLabel && <span className="text-[10px] uppercase tracking-wide text-ops-muted">{phaseLabel}</span>}
      </div>
      {children}
    </div>
  );
}

function SourceNotes({ nom, polls }) {
  const s = nom.data?.sources;
  const down = s ? [!s.polymarket?.ok && "Polymarket", !s.kalshi?.ok && "Kalshi"].filter(Boolean) : [];
  const notes = [
    nom.error && "Market odds unavailable.",
    polls.error && "Polling unavailable.",
    down.length && `${down.join(" and ")} ${down.length > 1 ? "are" : "is"} not responding; showing the rest.`,
  ].filter(Boolean);
  if (!notes.length) return null;
  return <p className="text-[10px] text-ops-muted">{notes.join(" ")}</p>;
}

export function PrimaryPanel({ party }) {
  const nom = useNomination(party);
  const polls = usePrimaryPolls(party);
  const [sortBy, setSortBy] = useState("avg");
  const [expanded, setExpanded] = useState(false);
  const [seenRef, seen] = useSeenOnce();

  const rows = useMemo(() => joinCandidates(nom.data, polls.data), [nom.data, polls.data]);
  const priorityIds = useMemo(
    () => [...sortRows(rows.filter((r) => r.avg != null), "avg"), ...sortRows(rows.filter((r) => r.avg == null), "poll")].map((r) => r.id),
    [rows]
  );
  const colorOf = useMemo(() => assignCandidateColors(priorityIds), [priorityIds]);
  const takeaway = useMemo(() => buildTakeaway(rows), [rows]);
  const loading = nom.loading && polls.loading;

  return (
    <PanelFrame party={party} phaseLabel="Primary">
      <div ref={seenRef} className="space-y-3">
        {takeaway && (
          <Takeaway>
            {takeaway.map((s, i) => (s.b ? <b key={i}>{s.t}</b> : s.t))}
          </Takeaway>
        )}
        <SourceNotes nom={nom} polls={polls} />
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-ops-panel-2/60" />
            ))}
          </div>
        ) : rows.length ? (
          <Leaderboard rows={rows} colorOf={colorOf} sortBy={sortBy} onSort={setSortBy} expanded={expanded} onExpand={setExpanded} />
        ) : (
          <SubPanel title="Nomination leaderboard">
            <Quiet>No candidate data yet.</Quiet>
          </SubPanel>
        )}
        <OddsHistory party={party} priorityIds={priorityIds} enabled={seen} />
        <PollTrend polls={polls} colorOf={colorOf} />
        <RecentPolls polls={polls} colorOf={colorOf} />
      </div>
    </PanelFrame>
  );
}

// presumptive / nominee: configured name + the odds trend, collapsed.
export function CompactPanel({ party }) {
  const cfg = PARTIES[party];
  const [open, setOpen] = useState(false);
  const label = cfg.phase === "nominee" ? "Nominee" : "Presumptive nominee";
  return (
    <PanelFrame party={party}>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-ops-muted">{label}</div>
        <div className="mt-0.5 truncate text-lg font-bold text-ops-text">{cfg.nominee || "Name not set"}</div>
      </div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-[11px] font-semibold text-accent hover:underline"
      >
        {open ? "Hide nomination odds" : "Show nomination odds"}
      </button>
      {open && <OddsHistory party={party} priorityIds={[]} enabled />}
    </PanelFrame>
  );
}
