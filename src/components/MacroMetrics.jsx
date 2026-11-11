import { useEffect, useState } from "react";
import { useDataVersion } from "../lib/liveData";
import { formatDay, formatUpdated } from "../lib/format";
import {
  fetchControl,
  fetchControlHistory,
  fetchPolls,
  prefetchControlHistoryRanges,
  sourceHasData,
} from "../lib/api";
import OverlapBar from "./OverlapBar";
import { overlapInfo } from "../lib/overlap";
import RangeSelector from "./RangeSelector";
import { POLL_RANGES, MARKET_RANGES, sliceRange } from "../lib/ranges";
import SourceTag from "./SourceTag";
import TrendChart from "./LazyTrendChart";
import VolumeStat from "./VolumeStat";

const DEM = "#2563eb";
const REP = "#dc2626";
const APPROVE = "#16a34a";
const DISAPPROVE = "#ea580c"; // orange — distinct from the GOP red

// ---- shared bits --------------------------------------------------------

// Clickable cards are divs (not <button>) so they can contain the source-switcher
// buttons; keyboard + role keep them accessible. Nested buttons stopPropagation.
function CardShell({ title, badge, children, clickable, expanded, onClick }) {
  const interactive = clickable
    ? {
        role: "button",
        tabIndex: 0,
        onClick,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick?.(e);
          }
        },
      }
    : {};
  return (
    <div
      {...interactive}
      aria-expanded={clickable ? expanded : undefined}
      className={`flex min-h-[168px] w-full select-none flex-col gap-3 rounded-xl border p-4 text-left backdrop-blur-sm transition-colors sm:p-5 ${
        expanded ? "border-accent bg-ops-panel" : "border-ops-border bg-ops-panel/80"
      } ${clickable ? "cursor-pointer hover:border-accent/60 focus:outline-none focus-visible:border-accent" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ops-muted">
          {title}
        </h3>
        {badge}
      </div>
      {children}
    </div>
  );
}

function LeadBadge({ leftLabel, rightLabel, leftValue, rightValue, leftColor, rightColor }) {
  const leftLeads = leftValue >= rightValue;
  const color = leftLeads ? leftColor : rightColor;
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color, backgroundColor: `${color}1a` }}
    >
      {leftLeads ? leftLabel : rightLabel} +{Math.round(Math.abs(leftValue - rightValue) * 10) / 10}
    </span>
  );
}

function NumberRow({ leftLabel, rightLabel, leftValue, rightValue, leftColor, rightColor }) {
  return (
    <div className="flex items-end justify-between tabular">
      <div className="flex flex-col">
        <span className="text-2xl font-bold leading-none" style={{ color: leftColor }}>
          {leftValue}%
        </span>
        <span className="mt-1 text-[11px] font-medium text-ops-muted">{leftLabel}</span>
      </div>
      <div className="flex flex-col items-end">
        <span className="text-2xl font-bold leading-none" style={{ color: rightColor }}>
          {rightValue}%
        </span>
        <span className="mt-1 text-[11px] font-medium text-ops-muted">{rightLabel}</span>
      </div>
    </div>
  );
}

function Chevron({ dir }) {
  const d = dir === "left" ? "M11 4L6 8l5 4" : "M5 4l5 4-5 4";
  return (
    <svg width="14" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownChevron({ flipped }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className={`transition-transform ${flipped ? "rotate-180" : ""}`}
    >
      <path d="M2 3.5L5 6.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SourceSwitcher({ source, onPrev, onNext }) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-ops-border bg-ops-panel-2/60 px-1 py-0.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPrev();
        }}
        aria-label="Previous source"
        className="rounded-full p-0.5 text-ops-muted transition-colors hover:text-accent"
      >
        <Chevron dir="left" />
      </button>
      <span className="min-w-[68px] text-center text-[11px] font-semibold text-ops-text">
        {source}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onNext();
        }}
        aria-label="Next source"
        className="rounded-full p-0.5 text-ops-muted transition-colors hover:text-accent"
      >
        <Chevron dir="right" />
      </button>
    </div>
  );
}

function SplitBar({ leftPct, rightPct, leftColor, rightColor }) {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-ops-border">
      <div className="h-full transition-all duration-500" style={{ width: `${leftPct}%`, backgroundColor: leftColor }} />
      <div className="ml-auto h-full transition-all duration-500" style={{ width: `${rightPct}%`, backgroundColor: rightColor }} />
    </div>
  );
}

// ---- poll card (generic ballot, approval) — data-driven, click for history --

function PollCard({
  title,
  status,
  leftLabel,
  rightLabel,
  leftValue,
  rightValue,
  leftColor,
  rightColor,
  lastUpdated,
  expandable,
  expanded,
  onToggle,
}) {
  const ready = status === "ok" && leftValue != null && rightValue != null;
  return (
    <CardShell
      title={title}
      clickable={expandable}
      expanded={expanded}
      onClick={expandable ? onToggle : undefined}
      badge={
        ready ? (
          <LeadBadge
            leftLabel={leftLabel}
            rightLabel={rightLabel}
            leftValue={leftValue}
            rightValue={rightValue}
            leftColor={leftColor}
            rightColor={rightColor}
          />
        ) : null
      }
    >
      {status === "loading" && (
        <div className="flex flex-1 flex-col justify-center gap-3">
          <div className="h-7 w-2/3 animate-pulse rounded bg-ops-border" />
          <div className="h-2.5 w-full animate-pulse rounded-full bg-ops-border" />
        </div>
      )}
      {status === "error" && (
        <div className="flex flex-1 items-center text-xs text-ops-muted">Couldn’t load polling.</div>
      )}
      {status === "ok" &&
        (ready ? (
          <>
            <NumberRow
              leftLabel={leftLabel}
              rightLabel={rightLabel}
              leftValue={leftValue}
              rightValue={rightValue}
              leftColor={leftColor}
              rightColor={rightColor}
            />
            <SplitBar leftPct={leftValue} rightPct={rightValue} leftColor={leftColor} rightColor={rightColor} />
            {/* Same row position as the market cards' overlap/history line so
                "View history" sits on one line across all four cards. */}
            <div className="flex h-4 items-center justify-end">
              {expandable && (
                <span className="flex items-center gap-1 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-accent">
                  <DownChevron flipped={expanded} />
                  {expanded ? "Hide history" : "View history"}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center text-xs text-ops-muted">No polling yet</div>
        ))}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <SourceTag kind="polls" />
        <p className="whitespace-nowrap text-[10px] uppercase tracking-wide text-ops-muted/70">
          Updated {formatDay(lastUpdated)}
        </p>
      </div>
    </CardShell>
  );
}

// ---- market control card (Senate / House) — two-sided, multi-source -----

function MarketControlCard({ title, status, data, isExpanded, onToggle, onSourceChange }) {
  const [index, setIndex] = useState(0);
  const sources = data?.sources || [];
  const current = sources[index] || null;
  const multi = sources.length > 1;
  const hasData = sourceHasData(current);
  const band = hasData ? overlapInfo(current.demYes, current.repYes) : null;

  // History is per-source; keep the open panel pointed at the visible source.
  const changeSource = (delta) => {
    const ni = (index + delta + sources.length) % sources.length;
    setIndex(ni);
    if (isExpanded) onSourceChange(sources[ni]?.id);
  };

  return (
    <CardShell
      title={title}
      clickable={status === "ok" && hasData}
      expanded={isExpanded}
      onClick={() => hasData && onToggle(current.id)}
      badge={
        hasData ? (
          <LeadBadge
            leftLabel="DEM"
            rightLabel="GOP"
            leftValue={current.demYes}
            rightValue={current.repYes}
            leftColor={DEM}
            rightColor={REP}
          />
        ) : null
      }
    >
      {status === "loading" && (
        <div className="flex flex-1 flex-col justify-center gap-3">
          <div className="h-7 w-2/3 animate-pulse rounded bg-ops-border" />
          <div className="h-2.5 w-full animate-pulse rounded-full bg-ops-border" />
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-1 items-center text-xs text-ops-muted">
          Couldn’t load market data.
        </div>
      )}

      {status === "ok" &&
        (hasData ? (
          <>
            <NumberRow
              leftLabel="DEM"
              rightLabel="GOP"
              leftValue={current.demYes}
              rightValue={current.repYes}
              leftColor={DEM}
              rightColor={REP}
            />
            <OverlapBar demYes={current.demYes} repYes={current.repYes} />
            <div className="flex h-4 items-center justify-between">
              {band ? (
                <span className="text-[10px] font-medium tracking-wide" style={{ color: band.color }}>
                  {band.text}
                </span>
              ) : (
                <span />
              )}
              <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-accent">
                <DownChevron flipped={isExpanded} />
                {isExpanded ? "Hide history" : "View history"}
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-ops-border bg-ops-panel-2/40 px-3 py-4 text-center text-xs text-ops-muted">
            No {current?.label || "source"} market yet
          </div>
        ))}

      {/* Provider switcher — the one market-only control, on its own row so the
          footer below stays identical across all four cards. */}
      {status === "ok" && multi && (
        <div className="flex">
          <SourceSwitcher
            source={current?.label}
            onPrev={() => changeSource(-1)}
            onNext={() => changeSource(1)}
          />
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <SourceTag kind="market" />
        <p className="whitespace-nowrap text-[10px] uppercase tracking-wide text-ops-muted/70">
          Updated {formatUpdated(current?.lastUpdated)}
        </p>
      </div>
    </CardShell>
  );
}

// ---- container ----------------------------------------------------------

const GENERIC_SERIES = [
  { key: "dem", color: DEM, label: "Democrat" },
  { key: "rep", color: REP, label: "Republican" },
];
const APPROVAL_SERIES = [
  { key: "approve", color: APPROVE, label: "Approve" },
  { key: "disapprove", color: DISAPPROVE, label: "Disapprove" },
];

// Full-width history panel rendered below the card grid (so expanding doesn't
// distort the 4-card row). Shared by the poll cards and the control cards.
// The range selector only applies to poll history, so it's opt-in: it renders
// only when the caller supplies `range`/`onRangeChange` (control panels don't).
function HistoryPanel({
  title,
  tag,
  status,
  hasData,
  data,
  series,
  volume,
  volumeKey,
  range,
  onRangeChange,
  rangeData,
  ranges = POLL_RANGES,
}) {
  const rangeable = range != null && onRangeChange != null;
  return (
    <div className="rounded-xl border border-ops-border bg-ops-panel/60 p-4 sm:p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ops-muted">
          {title}
          {tag && <SourceTag kind={tag} />}
        </span>
        {rangeable && (
          <RangeSelector value={range} onChange={onRangeChange} data={rangeData} ranges={ranges} />
        )}
      </div>
      {status === "loading" && <div className="h-56 animate-pulse rounded bg-ops-panel-2/60" />}
      {status === "error" && (
        <div className="py-8 text-center text-xs text-ops-muted">Couldn’t load history.</div>
      )}
      {status === "ok" &&
        (hasData ? (
          <>
            <TrendChart data={data} series={series} volumeKey={volumeKey} utcDates={tag === "polls"} />
            {volume && <VolumeStat volume={volume} />}
          </>
        ) : (
          <div className="py-8 text-center text-xs text-ops-muted">No history yet</div>
        ))}
    </div>
  );
}

// Status updater for a failed re-fetch: keep "ok" (and the data already on
// screen) if we had it, otherwise show the error.
const keepOk = (s) => (s === "ok" ? s : "error");

export default function MacroMetrics({ onReady }) {
  const [control, setControl] = useState(null);
  const [status, setStatus] = useState("loading");
  // Keyed by range id ("all"/"90d"/...) so switching the control panel's range
  // selector doesn't discard an already-fetched window — see the effect below.
  // Each entry is { data, version }: after a live-data refresh the old data
  // stays on screen while the newer version is fetched.
  const [controlHistory, setControlHistory] = useState({});
  const version = useDataVersion();
  // The expanded descriptor whose fetch failed. Status is derived per range at
  // render time (see the panel below), so a failure only shows for the request
  // that failed: re-opening or switching range creates a new descriptor, which
  // reads as "loading" while its own fetch runs.
  const [controlHistoryFailed, setControlHistoryFailed] = useState(null);
  const [pollData, setPollData] = useState(null);
  const [pollStatus, setPollStatus] = useState("loading");
  // One expansion at a time:
  //   { type:'poll', id } | { type:'control', chamber, sourceId } | null
  const [expanded, setExpanded] = useState(null);

  // Re-runs on each live-data refresh (`version`). A failed refresh keeps the
  // data already on screen rather than swapping it for an error.
  useEffect(() => {
    let alive = true;
    const ctl = fetchControl()
      .then((d) => alive && (setControl(d), setStatus("ok")))
      .catch(() => alive && setStatus(keepOk));
    const polls = fetchPolls()
      .then((d) => alive && (setPollData(d), setPollStatus("ok")))
      .catch(() => alive && setPollStatus(keepOk));
    // Reveal the dashboard once the above-the-fold market + poll data settles.
    Promise.allSettled([ctl, polls]).then(() => alive && onReady?.());
    return () => {
      alive = false;
    };
  }, [onReady, version]);

  // Control history (heavy Kalshi candle pull) is only shown when a control card
  // is expanded, so fetch it lazily on first expand rather than eagerly on load —
  // eager fetching added to the Kalshi rate-limit burst on Cloudflare. The guard
  // is per-range (not just "have we ever fetched") so switching the range
  // selector — which changes `expanded.range` — actually triggers a refetch
  // instead of silently reusing whatever range loaded first.
  useEffect(() => {
    if (expanded?.type !== "control") return;
    const range = expanded.range || "all";
    if (controlHistory[range]?.version === version) return;
    let alive = true;
    fetchControlHistory(range)
      .then((d) => {
        // Keep the data even if the user has since switched range: it's keyed by
        // range, so it's still valid and saves a refetch on switching back.
        setControlHistory((cur) => ({ ...cur, [range]: { data: d, version } }));
        if (!alive) return;
        // The range the user actually asked for just landed — quietly warm the
        // other four in the background so the range selector feels instant.
        // Only reachable once a control card is expanded (the guard above this
        // effect), never from page load.
        prefetchControlHistoryRanges(range);
      })
      .catch(() => alive && setControlHistoryFailed(expanded));
    return () => {
      alive = false;
    };
  }, [expanded, controlHistory, version]);

  const gb = pollData?.genericBallot;
  const ap = pollData?.approval;

  // Range lives on the expanded descriptor itself (rather than separate state)
  // so opening a *different* poll card always starts a fresh { ..., range: "all" }
  // object — no extra useEffect needed to reset a stale 30D/90D window when the
  // user switches from Generic Ballot to Trump Approval.
  const togglePoll = (id) =>
    setExpanded((cur) =>
      cur?.type === "poll" && cur.id === id ? null : { type: "poll", id, range: "all" }
    );
  const setPollRange = (range) =>
    setExpanded((cur) => (cur?.type === "poll" ? { ...cur, range } : cur));
  const toggleControl = (chamber, sourceId) =>
    setExpanded((cur) =>
      cur?.type === "control" && cur.chamber === chamber
        ? null
        : { type: "control", chamber, sourceId, range: "all" }
    );
  const setControlSource = (chamber, sourceId) =>
    setExpanded((cur) =>
      cur?.type === "control" && cur.chamber === chamber ? { ...cur, sourceId } : cur
    );
  // Switching Polymarket<->Kalshi (setControlSource above) spreads `...cur`, so
  // it preserves whatever range is chosen — only a range-selector click or a
  // fresh chamber open touches `range`.
  const setControlRange = (range) =>
    setExpanded((cur) => (cur?.type === "control" ? { ...cur, range } : cur));
  const ctlExpanded = (chamber) => expanded?.type === "control" && expanded.chamber === chamber;

  // Resolve the active expansion into a HistoryPanel descriptor.
  let panel = null;
  if (expanded?.type === "poll") {
    const isGB = expanded.id === "genericBallot";
    const d = isGB ? gb : ap;
    const range = expanded.range || "all";
    const days = POLL_RANGES.find((r) => r.id === range)?.days ?? null;
    panel = {
      title: `${isGB ? "Generic Ballot" : "Trump Approval"} · polling average over time`,
      tag: "polls",
      status: "ok",
      // Tested against the FULL trend, not the range-sliced one: the range
      // selector already disables windows that are too short, so the panel
      // itself should stay open as long as there's any history at all.
      hasData: (d?.trend?.length || 0) > 1,
      data: sliceRange(d?.trend, days),
      series: isGB ? GENERIC_SERIES : APPROVAL_SERIES,
      range,
      onRangeChange: setPollRange,
      rangeData: d?.trend,
    };
  } else if (expanded?.type === "control") {
    const range = expanded.range || "all";
    const src = controlHistory[range]?.data?.[expanded.chamber]?.sources?.find(
      (s) => s.id === expanded.sourceId
    );
    const isKalshi = expanded.sourceId === "kalshi";
    panel = {
      title: `${expanded.chamber === "senate" ? "Senate" : "House"} Control · ${src?.label || ""} · win probability over time`,
      tag: "market",
      status: controlHistory[range] ? "ok" : controlHistoryFailed === expanded ? "error" : "loading",
      hasData: Boolean(src?.hasData),
      // No client-side slicing here (unlike the poll branch's sliceRange) —
      // the server already returns exactly the requested window.
      data: src?.points,
      series: GENERIC_SERIES,
      // Kalshi candles carry per-day volume -> bars; Polymarket only aggregate -> stat.
      volumeKey: isKalshi ? "volume" : undefined,
      volume: isKalshi ? undefined : src?.volume,
      range,
      onRangeChange: setControlRange,
      ranges: MARKET_RANGES,
    };
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MarketControlCard
          title="Senate Control"
          status={status}
          data={control?.senate}
          isExpanded={ctlExpanded("senate")}
          onToggle={(sid) => toggleControl("senate", sid)}
          onSourceChange={(sid) => setControlSource("senate", sid)}
        />
        <MarketControlCard
          title="House Control"
          status={status}
          data={control?.house}
          isExpanded={ctlExpanded("house")}
          onToggle={(sid) => toggleControl("house", sid)}
          onSourceChange={(sid) => setControlSource("house", sid)}
        />
        <PollCard
          title="Generic Ballot"
          status={pollStatus}
          leftLabel="DEM"
          rightLabel="GOP"
          leftValue={gb?.dem}
          rightValue={gb?.rep}
          leftColor={DEM}
          rightColor={REP}
          lastUpdated={gb?.lastUpdated}
          expandable={pollStatus === "ok" && (gb?.trend?.length || 0) > 1}
          expanded={expanded?.type === "poll" && expanded.id === "genericBallot"}
          onToggle={() => togglePoll("genericBallot")}
        />
        <PollCard
          title="Trump Approval"
          status={pollStatus}
          leftLabel="APPROVE"
          rightLabel="DISAPPROVE"
          leftValue={ap?.approve}
          rightValue={ap?.disapprove}
          leftColor={APPROVE}
          rightColor={DISAPPROVE}
          lastUpdated={ap?.lastUpdated}
          expandable={pollStatus === "ok" && (ap?.trend?.length || 0) > 1}
          expanded={expanded?.type === "poll" && expanded.id === "approval"}
          onToggle={() => togglePoll("approval")}
        />
      </div>

      {panel && <HistoryPanel {...panel} />}
    </div>
  );
}
