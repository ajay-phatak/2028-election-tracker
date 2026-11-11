import { useMemo } from "react";
import { HOUSE_OUTLOOK, SENATE_OUTLOOK } from "../config/races.config";
import { YEAR } from "../config/election";
import { CALLS_FOOTNOTE, houseTally, senateTally } from "../lib/calls";
import { isElectionNight } from "../lib/electionNight";
import { useElectionNow, useHouseOdds, useResults, useSenateOdds } from "../lib/liveData";

const DEM = "#2563eb";
const REP = "#dc2626";

// Stacked bar: Dem segments from the left, GOP from the right, uncalled grey in
// between, and a line at the majority mark. `segs` are { n, color, opacity?, title }.
function SeatBar({ total, majority, dem, rep }) {
  const w = (n) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div className="relative flex h-3 w-full overflow-hidden rounded-full bg-ops-border">
      {dem.map((s) => (
        <div key={s.title} title={`${s.title}: ${s.n}`} style={{ width: w(s.n), backgroundColor: DEM, opacity: s.opacity ?? 1 }} />
      ))}
      <div className="flex-1" />
      {[...rep].reverse().map((s) => (
        <div key={s.title} title={`${s.title}: ${s.n}`} style={{ width: w(s.n), backgroundColor: REP, opacity: s.opacity ?? 1 }} />
      ))}
      <div className="absolute top-[-2px] h-[calc(100%+4px)] w-px bg-ops-text/80" style={{ left: w(majority) }} />
    </div>
  );
}

function Totals({ dem, rep, majority, note }) {
  return (
    <div className="mb-2 flex items-end justify-between text-xs">
      <span className="font-semibold tabular" style={{ color: DEM }}>
        {dem} <span className="text-ops-muted">DEM</span>
      </span>
      <span className="text-[10px] uppercase tracking-wide text-ops-muted" title={note}>
        {majority} for majority
      </span>
      <span className="font-semibold tabular" style={{ color: REP }}>
        <span className="text-ops-muted">GOP</span> {rep}
      </span>
    </div>
  );
}

function SenateTally({ odds, now, results }) {
  const t = useMemo(() => senateTally(odds, now, results), [odds, now, results]);
  const { majority, holdovers, total } = SENATE_OUTLOOK;
  const indText = t.ind ? ` · ${t.ind} independent` : "";
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ops-muted">Senate</div>
      <Totals
        dem={t.dem}
        rep={t.rep}
        majority={majority}
        note="50-50 is broken by the vice president, a Republican"
      />
      <SeatBar
        total={total}
        majority={majority}
        dem={[
          { n: holdovers.dem, title: `Not up in ${YEAR}`, opacity: 0.55 },
          { n: t.safeDem, title: "Safe seats (by holding party)", opacity: 0.55 },
          { n: t.calledDem, title: "Called (results or markets)" },
        ]}
        rep={[
          { n: holdovers.rep, title: `Not up in ${YEAR}`, opacity: 0.55 },
          { n: t.safeRep, title: "Safe seats (by holding party)", opacity: 0.55 },
          { n: t.calledRep, title: "Called (results or markets)" },
        ]}
      />
      <p className="mt-2 text-[11px] leading-relaxed text-ops-muted">
        Not up in {YEAR}: <b className="text-ops-text">{holdovers.dem} D</b> (incl. independents who
        caucus with Democrats) · <b className="text-ops-text">{holdovers.rep} R</b>
        <br />
        Called (results or markets): <b className="text-ops-text">{t.calledDem} D</b> ·{" "}
        <b className="text-ops-text">{t.calledRep} R</b>
        {indText}
        <br />
        Safe seats (by holding party): <b className="text-ops-text">{t.safeDem} D</b> ·{" "}
        <b className="text-ops-text">{t.safeRep} R</b> — untracked seats up, counted once polls close
        <br />
        Uncalled: <b className="text-ops-text">{t.uncalled}</b> · 50-50 goes to the VP’s party
      </p>
    </div>
  );
}

function HouseTally({ odds, now, results }) {
  const t = useMemo(() => houseTally(odds, now, results), [odds, now, results]);
  const { majority, total } = HOUSE_OUTLOOK;
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ops-muted">House</div>
      <Totals dem={t.dem} rep={t.rep} majority={majority} />
      <SeatBar
        total={total}
        majority={majority}
        dem={[
          { n: t.safeDem, title: "Safe seats (by rating)", opacity: 0.55 },
          { n: t.calledDem, title: "Called (results or markets)" },
        ]}
        rep={[
          { n: t.safeRep, title: "Safe seats (by rating)", opacity: 0.55 },
          { n: t.calledRep, title: "Called (results or markets)" },
        ]}
      />
      <p className="mt-2 text-[11px] leading-relaxed text-ops-muted">
        Called (results or markets): <b className="text-ops-text">{t.calledDem} D</b> ·{" "}
        <b className="text-ops-text">{t.calledRep} R</b>
        <br />
        Safe seats (by rating): <b className="text-ops-text">{t.safeDem} D</b> ·{" "}
        <b className="text-ops-text">{t.safeRep} R</b> — Cook Safe/Solid seats in states whose polls
        have closed
        <br />
        Uncalled: <b className="text-ops-text">{t.uncalled}</b>
      </p>
    </div>
  );
}

// Election-night seat counts; renders nothing outside election-night mode.
export default function SeatTally() {
  const now = useElectionNow();
  const senateOdds = useSenateOdds();
  const houseOdds = useHouseOdds();
  const results = useResults()?.races;
  if (!isElectionNight(now)) return null;
  return (
    <section className="rounded-2xl border border-ops-border bg-ops-panel/40 p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ops-text">
        Election Night · Seats
      </h2>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <SenateTally odds={senateOdds} now={now} results={results} />
        <HouseTally odds={houseOdds} now={now} results={results} />
      </div>
      <p className="mt-3 text-[10px] uppercase tracking-wide text-ops-muted/60">{CALLS_FOOTNOTE}</p>
    </section>
  );
}
