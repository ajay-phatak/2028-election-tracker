import { useEffect, useState } from "react";
import { useDataVersion, useElectionNow, useResults } from "../lib/liveData";
import { CALLS_FOOTNOTE, raceCall } from "../lib/calls";
import { isResultsMode, pollsCloseLabel, raceState, stateClosed } from "../lib/electionNight";
import { CATEGORIES, RATINGS } from "../config/races.config";
import { getRaceByCode } from "../lib/races";
import { dedupeArticles } from "../lib/news";
import {
  fetchRaceOdds,
  fetchRaceHistory,
  fetchRacePolls,
  fetchRaceNews,
  prefetchRaceHistoryRanges,
  sourceHasData,
} from "../lib/api";
import CallBadge from "./CallBadge";
import ResultsCredit from "./ResultsCredit";
import OverlapBar from "./OverlapBar";
import { overlapInfo } from "../lib/overlap";
import RangeSelector from "./RangeSelector";
import { POLL_RANGES, MARKET_RANGES, sliceRange } from "../lib/ranges";
import SourceTag from "./SourceTag";
import TrendChart from "./LazyTrendChart";
import VolumeStat from "./VolumeStat";
import { formatDay, formatUpdated, formatRelative } from "../lib/format";

const POLL_SERIES = [
  { key: "dem", color: "#2563eb", label: "Democrat" },
  { key: "rep", color: "#dc2626", label: "Republican" },
];

const DEM = "#2563eb";
const REP = "#dc2626";
const EMPTY_MSG = "No data available for this race";

function PartyBadge({ party }) {
  const isDem = party === "D";
  const color = isDem ? DEM : REP;
  return (
    <span
      className="rounded px-2 py-0.5 text-xs font-bold"
      style={{ color, backgroundColor: `${color}1f` }}
    >
      {isDem ? "Democrat" : "Republican"}
    </span>
  );
}

// "Jon Ossoff (D) vs Mike Collins (R)". The anti-GOP side is an independent
// where the race sets `independent` (Nebraska's Osborn), so it reads "(I)".
function Matchup({ race }) {
  const { dem, rep } = race.candidates;
  return (
    <p className="mt-1.5 text-sm font-semibold">
      <span style={{ color: DEM }}>
        {dem} ({race.independent ? "I" : "D"})
      </span>
      <span className="mx-1.5 text-xs font-normal text-ops-muted">vs</span>
      <span style={{ color: REP }}>{rep} (R)</span>
    </p>
  );
}

function Section({ title, tag, children }) {
  return (
    <section className="border-t border-ops-border px-5 py-5">
      <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ops-muted">
        {title}
        {tag && <SourceTag kind={tag} />}
      </h3>
      {children}
    </section>
  );
}

function EmptyNote() {
  return (
    <div className="rounded-lg border border-dashed border-ops-border bg-ops-panel-2/50 px-4 py-6 text-center text-sm text-ops-muted">
      {EMPTY_MSG}
    </div>
  );
}

// ---- election results (civicAPI) ---------------------------------------

// One candidate's line: name (D)/(I)/(R), votes, percent and a thin bar in the
// party color. The leader is emphasized, the trailing side dimmed.
function ResultRow({ name, tag, color, votes, percent, leading }) {
  return (
    <div className={leading ? "" : "opacity-70"}>
      <div className="flex items-baseline justify-between gap-3 tabular">
        <span className={`text-sm ${leading ? "font-bold" : "font-medium"}`} style={{ color }}>
          {name} ({tag})
        </span>
        <span className="whitespace-nowrap text-sm">
          <span className="text-ops-muted">{votes.toLocaleString()}</span>
          <span className={`ml-2 ${leading ? "font-bold" : "font-medium"}`} style={{ color }}>
            {percent}%
          </span>
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ops-border">
        <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function ResultsSection({ race, result }) {
  const dem = result?.dem;
  const rep = result?.rep;
  const hasVotes = dem && rep && dem.votes + rep.votes > 0;
  const demLeads = hasVotes && dem.votes > rep.votes;
  const repLeads = hasVotes && rep.votes > dem.votes;
  return (
    <Section title="Results">
      {hasVotes ? (
        <>
          <p className="mb-3 text-xs font-semibold text-ops-muted tabular">{result.pct}% reporting</p>
          <div className="flex flex-col gap-3">
            <ResultRow
              name={dem.name}
              tag={race.independent ? "I" : "D"}
              color={DEM}
              votes={dem.votes}
              percent={dem.percent}
              leading={demLeads}
            />
            <ResultRow
              name={rep.name}
              tag="R"
              color={REP}
              votes={rep.votes}
              percent={rep.percent}
              leading={repLeads}
            />
          </div>
          <p className="mt-3 text-[10px] uppercase tracking-wide text-ops-muted/70">
            Updated {formatUpdated(result.updated)} · <ResultsCredit />
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-ops-muted">Waiting for first results</p>
          <p className="mt-2 text-[10px] uppercase tracking-wide text-ops-muted/70">
            <ResultsCredit />
          </p>
        </>
      )}
    </Section>
  );
}

// ---- recent news list --------------------------------------------------

function NewsList({ articles }) {
  return (
    <ul className="flex flex-col gap-2">
      {dedupeArticles(articles).map((a, i) => (
        <li key={a.link || i}>
          <a
            href={a.link}
            target="_blank"
            rel="noopener noreferrer"
            className="group block rounded-lg border border-ops-border bg-ops-panel-2/50 px-3 py-2.5 transition-colors hover:border-accent/60 hover:bg-ops-panel-2"
          >
            <p className="line-clamp-2 text-sm font-medium text-ops-text group-hover:text-accent">
              {a.title}
            </p>
            <p className="mt-1 truncate text-[11px] text-ops-muted">
              {a.source}
              {a.source && a.publishedAt ? " · " : ""}
              {formatRelative(a.publishedAt)}
            </p>
          </a>
        </li>
      ))}
    </ul>
  );
}

// ---- current odds card (click to expand history) -----------------------

function ProviderOdds({ source, expanded, onToggle }) {
  const has = sourceHasData(source);
  const band = has ? overlapInfo(source.demYes, source.repYes) : null;
  const Tag = has ? "button" : "div";
  return (
    <Tag
      type={has ? "button" : undefined}
      onClick={has ? onToggle : undefined}
      aria-expanded={has ? expanded : undefined}
      className={`flex-1 rounded-lg border p-3 text-left transition-colors ${
        expanded ? "border-accent bg-ops-panel-2" : "border-ops-border bg-ops-panel-2/60"
      } ${has ? "cursor-pointer hover:border-accent/60" : ""}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ops-muted">
          {source.label}
        </span>
        {band && (
          <span className="text-[10px] font-medium" style={{ color: band.color }}>
            {band.text}
          </span>
        )}
      </div>
      {has ? (
        <>
          <div className="mb-2 flex items-end justify-between tabular">
            <div className="flex flex-col">
              <span className="text-xl font-bold leading-none" style={{ color: DEM }}>
                {source.demYes}%
              </span>
              <span className="mt-1 text-[11px] font-medium text-ops-muted">Dem</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-xl font-bold leading-none" style={{ color: REP }}>
                {source.repYes}%
              </span>
              <span className="mt-1 text-[11px] font-medium text-ops-muted">Rep</span>
            </div>
          </div>
          <OverlapBar demYes={source.demYes} repYes={source.repYes} />
          <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-accent">
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            >
              <path d="M2 3.5L5 6.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {expanded ? "Hide history" : "View history"}
          </div>
        </>
      ) : (
        <div className="py-4 text-center text-xs text-ops-muted">No data yet</div>
      )}
    </Tag>
  );
}

// Status updater for a failed re-fetch: keep "ok" (and the data already on
// screen) if we had it, otherwise show the error.
const keepOk = (s) => (s === "ok" ? s : "error");

export default function RaceDrawer({ stateCode, onClose }) {
  const open = Boolean(stateCode);
  // Keep the last selected code so content doesn't blank out during the
  // slide-out. Adjusted during render (React's pattern for state derived from a
  // prop) rather than in an effect, so there's no extra render with stale content.
  const [activeCode, setActiveCode] = useState(stateCode);
  if (stateCode && stateCode !== activeCode) setActiveCode(stateCode);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const race = activeCode ? getRaceByCode(activeCode) : null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        className={`drawer-scroll fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto border-l border-ops-border bg-ops-panel shadow-2xl transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {race && <RaceDetails key={activeCode} code={activeCode} race={race} onClose={onClose} />}
      </aside>
    </>
  );
}

// One race's drawer content. Keyed by race code in RaceDrawer, so switching
// races remounts it and all per-race state (odds, polls, news, selected ranges,
// expanded chart) starts fresh.
function RaceDetails({ code, race, onClose }) {
  // Senate races carry a `category`; House districts carry a `rating`.
  const tag = race.category ? CATEGORIES[race.category] : RATINGS[race.rating];

  // Live betting odds + historical series for the selected race.
  const [odds, setOdds] = useState(null);
  const [oddsStatus, setOddsStatus] = useState("loading"); // loading | ok | error
  // { range, data } or { range, error: true } for the most recent history
  // response; status for the selected range is derived from it below.
  const [historyResult, setHistoryResult] = useState(null);
  const [expandedSource, setExpandedSource] = useState(null);
  const [polls, setPolls] = useState(null);
  const [pollsStatus, setPollsStatus] = useState("loading");
  const [pollRange, setPollRange] = useState("all");
  const [marketRange, setMarketRange] = useState("all");
  const [news, setNews] = useState(null);
  const [newsStatus, setNewsStatus] = useState("loading");

  // No per-race resets needed: RaceDrawer remounts this component per race
  // (key={code}), so every piece of state starts fresh, ranges included.
  // Re-runs on each live-data refresh (`version`); a failed refresh keeps the
  // data already on screen rather than swapping it for an error.
  const version = useDataVersion();
  useEffect(() => {
    let alive = true;
    fetchRaceOdds(code)
      .then((d) => alive && (setOdds(d), setOddsStatus("ok")))
      .catch(() => alive && setOddsStatus(keepOk));
    fetchRacePolls(code)
      .then((d) => alive && (setPolls(d), setPollsStatus("ok")))
      .catch(() => alive && setPollsStatus(keepOk));
    fetchRaceNews(code)
      .then((d) => alive && (setNews(d), setNewsStatus("ok")))
      .catch(() => alive && setNewsStatus("error"));
    return () => {
      alive = false;
    };
  }, [code, version]);

  // Odds history is fetched in its own effect, keyed on the selected market
  // range, so changing the RangeSelector re-fetches (the loading skeleton shows
  // until the new range's response lands) without re-fetching odds/polls/news.
  useEffect(() => {
    let alive = true;
    fetchRaceHistory(code, marketRange)
      .then((d) => alive && setHistoryResult({ range: marketRange, data: d }))
      .catch(
        () =>
          alive &&
          // A failed refresh of the range already shown keeps its data.
          setHistoryResult((cur) =>
            cur?.range === marketRange && !cur.error ? cur : { range: marketRange, error: true }
          )
      );
    return () => {
      alive = false;
    };
  }, [code, marketRange, version]);
  const historyCurrent = historyResult?.range === marketRange ? historyResult : null;
  const historyStatus = historyCurrent ? (historyCurrent.error ? "error" : "ok") : "loading";
  const history = historyCurrent?.data ?? null;

  // Quietly warm the other four provider-history ranges once the user has
  // actually expanded a chart (expandedSource set — that's when the range
  // selector becomes visible) AND the range they're looking at has loaded.
  // Deliberately a separate effect from the one above: that effect fetches
  // history on every drawer open regardless of expandedSource, and firing a
  // 4-request sweep before the user has asked to see any history at all would
  // defeat the point of gating this on expand. The `alive` flag is threaded
  // into the sweep as `shouldContinue` so that clicking through several states
  // with a chart expanded can't leave a previous state's sweep still issuing
  // requests after the drawer has moved on — cleanup flips it false and the
  // sweep stops before its next request.
  useEffect(() => {
    if (!expandedSource || historyStatus !== "ok") return;
    let alive = true;
    prefetchRaceHistoryRanges(code, marketRange, () => alive);
    return () => {
      alive = false;
    };
  }, [expandedSource, historyStatus, code, marketRange]);

  const oddsSources = odds?.sources || [];
  const anyOdds = oddsSources.some(sourceHasData);
  const oddsUpdated = oddsSources.find(sourceHasData)?.lastUpdated;
  // Election night: a market call once polls close, "Polls close …" before.
  const now = useElectionNow();
  const result = useResults()?.races?.[code];
  const call = raceCall(race, oddsSources, now, result);
  // The Results section appears once the race's polls have closed.
  const showResults = isResultsMode(now) && stateClosed(raceState(race), now);
  const closesLabel = pollsCloseLabel(raceState(race), now);
  const expandedHistory = expandedSource
    ? (history?.sources || []).find((s) => s.id === expandedSource)
    : null;
  const expandedLabel = oddsSources.find((s) => s.id === expandedSource)?.label;

  return (
    <>
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-start justify-between border-b border-ops-border bg-ops-panel/95 px-5 py-4 backdrop-blur">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-ops-text">
              {race.district ?? race.state}
            </h2>
            <span
              className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ color: tag.color, backgroundColor: `${tag.color}24` }}
            >
              {tag.label}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-sm text-ops-muted">
              {race.district ? `${race.state} · ` : ""}
              {race.incumbent}
            </span>
            <PartyBadge party={race.party} />
            {call && <CallBadge race={race} call={call} />}
          </div>
          {race.candidates && <Matchup race={race} />}
          {call && <p className="mt-1.5 text-[10px] text-ops-muted/70">{CALLS_FOOTNOTE}</p>}
          {closesLabel && (
            <p className="mt-1.5 text-[10px] font-semibold text-accent">{closesLabel}</p>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 rounded-md p-1.5 text-ops-muted transition-colors hover:bg-ops-panel-2 hover:text-ops-text"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {showResults && <ResultsSection race={race} result={result} />}

      {/* Betting Odds — current, two-sided; click a provider for its history */}
      <Section title="Betting Odds — Win Probability" tag="market">
        {oddsStatus === "loading" && (
          <div className="flex gap-3">
            <div className="h-28 flex-1 animate-pulse rounded-lg bg-ops-panel-2/60" />
            <div className="h-28 flex-1 animate-pulse rounded-lg bg-ops-panel-2/60" />
          </div>
        )}
        {oddsStatus === "error" && (
          <div className="rounded-lg border border-dashed border-ops-border bg-ops-panel-2/50 px-4 py-6 text-center text-sm text-ops-muted">
            Couldn’t load market odds.
          </div>
        )}
        {oddsStatus === "ok" &&
          (anyOdds ? (
            <>
              <div className="flex items-stretch gap-3">
                {oddsSources.map((s) => (
                  <ProviderOdds
                    key={s.id}
                    source={s}
                    expanded={expandedSource === s.id}
                    onToggle={() =>
                      setExpandedSource((cur) => (cur === s.id ? null : s.id))
                    }
                  />
                ))}
              </div>

              {/* Expanded historical chart */}
              {expandedSource && (
                <div className="mt-3 rounded-lg border border-ops-border bg-ops-panel-2/40 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ops-muted">
                      {expandedLabel} · win probability over time
                      <SourceTag kind="market" />
                    </div>
                    <RangeSelector value={marketRange} onChange={setMarketRange} ranges={MARKET_RANGES} />
                  </div>
                  {historyStatus === "loading" && (
                    <div className="h-56 animate-pulse rounded bg-ops-panel-2/60" />
                  )}
                  {historyStatus === "error" && (
                    <div className="py-8 text-center text-xs text-ops-muted">
                      Couldn’t load history.
                    </div>
                  )}
                  {historyStatus === "ok" &&
                    (expandedHistory?.hasData ? (
                      <>
                        <TrendChart
                          data={expandedHistory.points}
                          series={POLL_SERIES}
                          volumeKey={expandedSource === "kalshi" ? "volume" : undefined}
                        />
                        {expandedSource !== "kalshi" && expandedHistory.volume && (
                          <VolumeStat volume={expandedHistory.volume} />
                        )}
                      </>
                    ) : (
                      <div className="py-8 text-center text-xs text-ops-muted">
                        No history yet
                      </div>
                    ))}
                </div>
              )}

              {oddsUpdated && (
                <p className="mt-2 text-[10px] uppercase tracking-wide text-ops-muted/70">
                  Updated {formatUpdated(oddsUpdated)}
                </p>
              )}
            </>
          ) : (
            <EmptyNote />
          ))}
      </Section>

      {/* Polling Average — Senate only (no per-district House polls fetched) */}
      {!race.district && (
      <Section title="Polling Average — D vs R" tag="polls">
        {pollsStatus === "loading" && (
          <div className="h-56 animate-pulse rounded bg-ops-panel-2/60" />
        )}
        {pollsStatus === "error" && (
          <div className="rounded-lg border border-dashed border-ops-border bg-ops-panel-2/50 px-4 py-6 text-center text-sm text-ops-muted">
            Couldn’t load polling.
          </div>
        )}
        {pollsStatus === "ok" &&
          (polls && polls.n > 0 ? (
            <>
              <div className="mb-2 flex items-baseline justify-between tabular">
                <span>
                  <span className="text-2xl font-bold" style={{ color: DEM }}>
                    {polls.dem ?? "—"}%
                  </span>
                  <span className="ml-1 text-[11px] text-ops-muted">Dem</span>
                </span>
                <span>
                  <span className="text-2xl font-bold" style={{ color: REP }}>
                    {polls.rep ?? "—"}%
                  </span>
                  <span className="ml-1 text-[11px] text-ops-muted">Rep</span>
                </span>
              </div>
              <OverlapBar demYes={polls.dem} repYes={polls.rep} />
              {polls.trend?.length > 1 && (
                <div className="mt-3">
                  <div className="mb-2 flex justify-end">
                    <RangeSelector value={pollRange} onChange={setPollRange} data={polls.trend} />
                  </div>
                  <TrendChart
                    data={sliceRange(
                      polls.trend,
                      POLL_RANGES.find((r) => r.id === pollRange)?.days ?? null
                    )}
                    series={POLL_SERIES}
                    utcDates
                  />
                </div>
              )}
              <p className="mt-2 text-[10px] uppercase tracking-wide text-ops-muted/70">
                {polls.n} poll{polls.n === 1 ? "" : "s"} · updated {formatDay(polls.lastUpdated)}
              </p>
            </>
          ) : (
            <EmptyNote />
          ))}
      </Section>
      )}

      {/* Recent News — GNews headlines for this race */}
      <Section title="Recent News">
        {newsStatus === "loading" && (
          <div className="flex flex-col gap-2">
            <div className="h-14 animate-pulse rounded-lg bg-ops-panel-2/60" />
            <div className="h-14 animate-pulse rounded-lg bg-ops-panel-2/60" />
            <div className="h-14 animate-pulse rounded-lg bg-ops-panel-2/60" />
          </div>
        )}
        {newsStatus === "error" && (
          <div className="rounded-lg border border-dashed border-ops-border bg-ops-panel-2/50 px-4 py-6 text-center text-sm text-ops-muted">
            Couldn’t load news.
          </div>
        )}
        {newsStatus === "ok" &&
          (news?.articles?.length ? (
            <>
              <NewsList articles={news.articles} />
              <p className="mt-2 text-[10px] uppercase tracking-wide text-ops-muted/70">
                via GNews
              </p>
            </>
          ) : (
            <EmptyNote />
          ))}
      </Section>

      {/* Notes — hidden entirely when empty */}
      {race.notes?.trim() && (
        <Section title="Notes">
          <div
            className="rounded-lg border-l-4 bg-ops-panel-2/60 px-4 py-3 text-sm text-ops-text"
            style={{ borderColor: "#2563eb" }}
          >
            {race.notes}
          </div>
        </Section>
      )}
    </>
  );
}
