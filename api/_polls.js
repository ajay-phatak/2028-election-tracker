// VoteHub polling proxy + normalization. Framework-agnostic (plain async + global
// fetch) so it runs both as a Vercel function and under the Vite dev middleware.
//
// VoteHub runs two API hosts, and as of mid-2026 neither covers everything:
//   - polling.votehub.com (current) — official time-weighted averages with daily
//     values; fresh for generic ballot + Trump approval, but its us-senator feed
//     lacks the current-cycle general-election races (as of 2026).
//   - api.votehub.com (legacy) — raw polls; stopped ingesting generic-ballot and
//     approval polls ~2026-06-30 but still updates us-senator.
// So macro numbers come from the current host's averages, and per-race senate
// numbers are still computed here from the legacy host's raw polls (trailing
// mean + rolling-average `trend` for the click-to-expand history charts).

import { WATCHED_RACES } from "../src/config/races.config.js";
import { YEAR } from "../src/config/election.js";

const VOTEHUB = "https://api.votehub.com/polls";
const VOTEHUB_AVERAGES = "https://polling.votehub.com/averages";
const UA = `${YEAR}-election-tracker/1.0 (dashboard)`;

// VoteHub honors ?poll_type= server-side, so fetch only the slice we need
// (us-senator is ~113 KB vs the full ~2.4 MB list).
async function getPolls(pollType) {
  const url = pollType ? `${VOTEHUB}?poll_type=${encodeURIComponent(pollType)}` : VOTEHUB;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`votehub ${r.status}`);
  return r.json();
}

export const tsOf = (p) => {
  const d = new Date(p.end_date);
  return Number.isNaN(d.getTime()) ? 0 : Math.floor(d.getTime() / 1000);
};

export const round1 = (x) => Math.round(x * 10) / 10;
export const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// One poll -> { left, right } averaged pct of the answers matching each side.
function pollSides(poll, isLeft, isRight) {
  const l = [];
  const r = [];
  for (const a of poll.answers || []) {
    const c = a.choice || "";
    const v = Number(a.pct);
    if (!Number.isFinite(v)) continue;
    if (isLeft(c)) l.push(v);
    else if (isRight(c)) r.push(v);
  }
  return { left: mean(l), right: mean(r) };
}

// Only polls where BOTH sides matched count. A one-sided match is a different
// matchup (a withdrawn nominee, a primary loser), and keeping its matched side
// would blend two races into one average.
function points(polls, isLeft, isRight) {
  return polls
    .filter((p) => !p.internal)
    .map((p) => ({ t: tsOf(p), ...pollSides(p, isLeft, isRight) }))
    .filter((p) => p.t > 0 && p.left != null && p.right != null)
    .sort((a, b) => a.t - b.t);
}

// Trailing average: polls within `windowDays`, falling back to the most recent `minN`.
function averageRecent(polls, isLeft, isRight, { windowDays = 90, minN = 5 } = {}) {
  const pts = points(polls, isLeft, isRight).sort((a, b) => b.t - a.t); // newest first
  if (!pts.length) return { left: null, right: null, n: 0, lastUpdated: null };
  const cutoff = Date.now() / 1000 - windowDays * 86400;
  let sel = pts.filter((p) => p.t >= cutoff);
  if (sel.length < minN) sel = pts.slice(0, minN);
  const side = (k) => {
    const m = mean(sel.map((p) => p[k]).filter((x) => x != null));
    return m == null ? null : round1(m);
  };
  return {
    left: side("left"),
    right: side("right"),
    n: sel.length,
    lastUpdated: new Date(pts[0].t * 1000).toISOString(),
  };
}

// Rolling trailing-window average, oldest -> newest, trimmed/downsampled for charts.
function rollingTrend(polls, isLeft, isRight, { windowDays = 30, maxDays = 540, maxPoints = 130 } = {}) {
  const pts = points(polls, isLeft, isRight);
  if (!pts.length) return [];
  const win = windowDays * 86400;
  let out = pts.map((cur) => {
    const w = pts.filter((p) => p.t <= cur.t && p.t >= cur.t - win);
    const side = (k) => {
      const m = mean(w.map((p) => p[k]).filter((x) => x != null));
      return m == null ? null : round1(m);
    };
    return { t: cur.t, left: side("left"), right: side("right") };
  });
  const newest = out[out.length - 1].t;
  out = out.filter((p) => p.t >= newest - maxDays * 86400);
  return downsample(out, { maxPoints });
}

const nameTrend = (trend, leftKey, rightKey) =>
  trend.map((p) => ({ t: p.t, [leftKey]: p.left, [rightKey]: p.right }));

// Shared downsampler for rollingTrend + averageTrend. A flat "one point per N"
// thinning (the old behavior) treats the whole series uniformly, so a 540-day
// "All" window at maxPoints=130 works out to ~1 point every 5 days — fine for
// the full view, but it also starves a 30D/90D range selector down to a
// handful of dots. Instead only the tail OLDER than `keepRecentDays` gets
// thinned; the recent window stays at full daily resolution so the range
// selector always has real data to zoom into. `out` must already be sorted
// oldest -> newest. This still caps the payload at roughly maxPoints (older)
// + keepRecentDays (recent) points, which matters because these trends ship
// inside the single /api/bootstrap first-paint payload.
export function downsample(out, { maxPoints = 130, keepRecentDays = 90 } = {}) {
  if (out.length <= maxPoints) return out;
  const cutoff = out[out.length - 1].t - keepRecentDays * 86400;
  const older = out.filter((p) => p.t < cutoff);
  const recent = out.filter((p) => p.t >= cutoff);
  if (older.length <= maxPoints) return out;
  const step = Math.ceil(older.length / maxPoints);
  return [...older.filter((_, i) => i % step === 0), ...recent];
}

// ---- matchers ----
const lc = (c) => (c || "").toLowerCase();

// ---- official averages (polling.votehub.com) ----

// GET /averages/{key}/values -> { "YYYY-MM-DD": { dem: {average,lower,upper}, ... } }
export async function getAverageValues(key, sinceDays) {
  const start = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const r = await fetch(`${VOTEHUB_AVERAGES}/${encodeURIComponent(key)}/values?start_date=${start}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`votehub averages ${r.status}`);
  return r.json();
}

// Date-keyed daily values -> sorted [{ t, <leftKey>, <rightKey> }], downsampled for charts.
function averageTrend(values, leftKey, rightKey, { maxPoints = 130 } = {}) {
  let out = Object.entries(values)
    .map(([date, sides]) => {
      const side = (k) => {
        const v = Number(sides?.[k]?.average);
        return Number.isFinite(v) ? round1(v) : null;
      };
      return { t: Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000), [leftKey]: side(leftKey), [rightKey]: side(rightKey) };
    })
    .filter((p) => Number.isFinite(p.t) && (p[leftKey] != null || p[rightKey] != null))
    .sort((a, b) => a.t - b.t);
  return downsample(out, { maxPoints });
}

// ---- public API ----
export async function getMacroPolls() {
  const [gbVals, apVals] = await Promise.all([
    getAverageValues(`generic_ballot_${YEAR}`, 540) /* TODO(2028): verify endpoint name */,
    getAverageValues("trump_approval", 540),
  ]);

  const gbTrend = averageTrend(gbVals, "dem", "rep");
  const apTrend = averageTrend(apVals, "approve", "disapprove");
  const gbLast = gbTrend[gbTrend.length - 1] || {};
  const apLast = apTrend[apTrend.length - 1] || {};
  const iso = (t) => (t ? new Date(t * 1000).toISOString() : null);

  // n (poll count behind the average) isn't part of the averages feed; the macro
  // cards don't render it, so it's null rather than a second upstream call.
  return {
    genericBallot: { dem: gbLast.dem ?? null, rep: gbLast.rep ?? null, n: null, lastUpdated: iso(gbLast.t), trend: gbTrend },
    approval: { approve: apLast.approve ?? null, disapprove: apLast.disapprove ?? null, n: null, lastUpdated: iso(apLast.t), trend: apTrend },
  };
}

// Compute one race's polling from an already-fetched poll list (no network).
function racePollsFor(race, all) {
  const polls = all.filter(
    (p) => p.poll_type === "us-senator" && p.subject === `${YEAR} ${race.state}` /* TODO(2028): verify subject format */
  );
  const demFrags = (race.pollParties?.dem || []).map(lc);
  const repFrags = (race.pollParties?.rep || []).map(lc);
  const isDem = (c) => lc(c) === "democrat" || demFrags.some((f) => lc(c).includes(f));
  const isRep = (c) => lc(c) === "republican" || repFrags.some((f) => lc(c).includes(f));

  const avg = averageRecent(polls, isDem, isRep, { windowDays: 120, minN: 4 });
  const trend = nameTrend(
    rollingTrend(polls, isDem, isRep, { windowDays: 45, maxDays: 730 }),
    "dem",
    "rep"
  );
  return {
    stateCode: race.stateCode,
    dem: avg.left,
    rep: avg.right,
    n: avg.n,
    lastUpdated: avg.lastUpdated,
    trend,
  };
}

export async function getRacePolls(stateCode) {
  const race = WATCHED_RACES.senate.find((r) => r.stateCode === stateCode);
  if (!race) return null;
  const all = await getPolls("us-senator");
  return racePollsFor(race, all);
}

// All watched races from a single (filtered) VoteHub fetch -> { GA: {...}, MI: {...}, ... }
export async function getAllRacePolls() {
  const all = await getPolls("us-senator");
  const out = {};
  for (const race of WATCHED_RACES.senate) out[race.stateCode] = racePollsFor(race, all);
  return out;
}
