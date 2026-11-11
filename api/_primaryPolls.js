// 2028 presidential PRIMARY polling (VoteHub), N candidates per party.
//
// Dem: VoteHub publishes an official average (dem_primary_2028) -> candidates + trend
// come from it. Rep has no average key, so candidates + trend are a trailing mean /
// rolling mean computed from the raw polls (the N-candidate generalization of
// averageRecent/rollingTrend in _polls.js, which are fixed left-vs-right). Both
// parties get recentPolls from the raw feed.
//
// Raw-feed data problems handled here: polls labelled with the wrong party
// (filterMislabeled), inconsistent names (candidateId), non-candidate answers.

import { PARTIES, PARTY_IDS, TUNABLES } from "../src/config/president.config.js";
import { candidateId, chooseDisplayName, isNonCandidate } from "../src/lib/candidates.js";
import { UA } from "./_providers.js";
import { downsample, getAverageValues, mean, round1, tsOf } from "./_polls.js";

const VOTEHUB_POLLS = "https://polling.votehub.com/polls";
const PAGE_SIZE = 200;
const MAX_PAGES = 5;

// ---- pure logic ----------------------------------------------------------

// Raw VoteHub poll -> { id, subject, pollster, grade, t, endDate, sampleSize,
// population, url, answers:[{ id|null, name, pct }] }, or null when unusable.
// `id` is null for non-candidate answers (Undecided, Other, ...).
export function normalizePoll(raw) {
  if (!raw || raw.internal) return null;
  const t = tsOf(raw);
  const answers = (raw.answers || [])
    .map((a) => ({ name: String(a.choice ?? ""), pct: Number(a.pct) }))
    .filter((a) => a.name && Number.isFinite(a.pct))
    .map((a) => ({ id: isNonCandidate(a.name) ? null : candidateId(a.name), ...a }));
  if (t <= 0 || !answers.some((a) => a.id)) return null;
  return {
    id: raw.id,
    subject: raw.subject,
    pollster: raw.pollster ?? null,
    grade: raw.pollster_grade ?? null,
    t,
    endDate: raw.end_date,
    sampleSize: raw.sample_size ?? null,
    population: raw.population ?? null,
    url: raw.url ?? null,
    answers,
  };
}

// Drop polls whose answers mostly match ANOTHER subject's frequent candidates and
// not their own subject's. A subject's "frequent" candidates are those named in at
// least `minPolls` of its polls and `minShare` of them, so one bad poll cannot
// poison the set it is mislabelled into. Returns { kept, dropped }.
export function filterMislabeled(polls, { minPolls = 3, minShare = 0.1 } = {}) {
  const stats = new Map(); // subject -> { n, counts: Map<id, polls naming it> }
  for (const p of polls) {
    const s = stats.get(p.subject) || { n: 0, counts: new Map() };
    s.n++;
    for (const id of new Set(p.answers.map((a) => a.id).filter(Boolean))) {
      s.counts.set(id, (s.counts.get(id) || 0) + 1);
    }
    stats.set(p.subject, s);
  }
  const frequent = new Map();
  for (const [subject, s] of stats) {
    frequent.set(
      subject,
      new Set([...s.counts].filter(([, c]) => c >= minPolls && c / s.n >= minShare).map(([id]) => id))
    );
  }
  const kept = [];
  const dropped = [];
  for (const p of polls) {
    const own = frequent.get(p.subject) || new Set();
    const others = new Set();
    for (const [subject, set] of frequent) if (subject !== p.subject) for (const id of set) others.add(id);
    const ids = p.answers.map((a) => a.id).filter(Boolean);
    const ownHits = ids.filter((id) => own.has(id)).length;
    const otherHits = ids.filter((id) => others.has(id) && !own.has(id)).length;
    (otherHits >= 2 && otherHits > ownHits ? dropped : kept).push(p);
  }
  return { kept, dropped };
}

// Display name per candidate id: the most common spelling across the polls.
function displayNames(polls) {
  const names = new Map();
  for (const p of polls) for (const a of p.answers) if (a.id) names.set(a.id, [...(names.get(a.id) || []), a.name]);
  return new Map([...names].map(([id, list]) => [id, chooseDisplayName(list)]));
}

// Trailing mean per candidate over polls within `windowDays` of `now`, widening to
// the newest `minN` polls when fewer fall in the window. A candidate is averaged over
// the polls that name them and needs `minPollsPerCandidate` of them (relaxed to 1 if
// nobody qualifies). -> { candidates:[{id,name,pct,lower:null,upper:null}], n, lastUpdated }
export function trailingMean(
  polls,
  {
    windowDays = TUNABLES.trailingWindowDays,
    minN = TUNABLES.trailingMinPolls,
    minPollsPerCandidate = TUNABLES.minPollsPerCandidate,
    minPct = TUNABLES.minPollPct,
    max = TUNABLES.maxCandidates,
    now = Date.now(),
  } = {}
) {
  const sorted = [...polls].sort((a, b) => b.t - a.t);
  if (!sorted.length) return { candidates: [], n: 0, lastUpdated: null };
  const cutoff = now / 1000 - windowDays * 86400;
  let sel = sorted.filter((p) => p.t >= cutoff);
  if (sel.length < minN) sel = sorted.slice(0, minN);
  const names = displayNames(sel);
  const vals = new Map();
  for (const p of sel) {
    for (const a of p.answers) if (a.id) vals.set(a.id, [...(vals.get(a.id) || []), a.pct]);
  }
  const build = (minPolls) =>
    [...vals]
      .filter(([, v]) => v.length >= minPolls)
      .map(([id, v]) => ({ id, name: names.get(id), pct: round1(mean(v)), lower: null, upper: null }));
  let out = build(minPollsPerCandidate);
  if (!out.length) out = build(1);
  return {
    candidates: out
      .filter((c) => c.pct >= minPct)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, max),
    n: sel.length,
    lastUpdated: new Date(sorted[0].t * 1000).toISOString(),
  };
}

// Rolling trailing-window mean per candidate, one row per poll end date, oldest ->
// newest: [{ t, <candidateId>: pct, ... }] restricted to `ids`, trimmed to maxDays.
export function rollingTrend(
  polls,
  ids,
  { windowDays = TUNABLES.trendWindowDays, maxDays = TUNABLES.trendMaxDays, maxPoints = 130 } = {}
) {
  const keep = new Set(ids);
  const sorted = [...polls].sort((a, b) => a.t - b.t);
  const win = windowDays * 86400;
  const rows = [];
  for (const t of [...new Set(sorted.map((p) => p.t))]) {
    const vals = new Map();
    for (const p of sorted) {
      if (p.t > t || p.t < t - win) continue;
      for (const a of p.answers) if (a.id && keep.has(a.id)) vals.set(a.id, [...(vals.get(a.id) || []), a.pct]);
    }
    if (!vals.size) continue;
    const row = { t };
    for (const [id, v] of vals) row[id] = round1(mean(v));
    rows.push(row);
  }
  if (!rows.length) return [];
  const newest = rows[rows.length - 1].t;
  return downsample(
    rows.filter((r) => r.t >= newest - maxDays * 86400),
    { maxPoints }
  );
}

// VoteHub averages { "YYYY-MM-DD": { "<Name>": {average,lower,upper} } } ->
// { candidates (latest day, sorted), trend:[{t,<id>:pct}], lastUpdated }.
export function candidatesFromAverages(values, { minPct = TUNABLES.minPollPct, max = TUNABLES.maxCandidates } = {}) {
  const dates = Object.keys(values).sort();
  if (!dates.length) return { candidates: [], trend: [], lastUpdated: null };
  const rowFor = (date) => {
    const byId = new Map();
    for (const [name, v] of Object.entries(values[date] || {})) {
      const pct = Number(v?.average);
      if (isNonCandidate(name) || !Number.isFinite(pct)) continue;
      const id = candidateId(name);
      const prev = byId.get(id);
      if (!prev || pct > prev.pct) {
        byId.set(id, { id, name, pct: round1(pct), lower: Number.isFinite(Number(v.lower)) ? round1(Number(v.lower)) : null, upper: Number.isFinite(Number(v.upper)) ? round1(Number(v.upper)) : null });
      }
    }
    return byId;
  };
  const latestDate = dates[dates.length - 1];
  const candidates = [...rowFor(latestDate).values()]
    .filter((c) => c.pct >= minPct)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, max);
  const keep = new Set(candidates.map((c) => c.id));
  const trend = dates
    .map((date) => {
      const row = { t: Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000) };
      for (const [id, c] of rowFor(date)) if (keep.has(id)) row[id] = c.pct;
      return row;
    })
    .filter((r) => Number.isFinite(r.t) && Object.keys(r).length > 1);
  return {
    candidates,
    trend: downsample(trend),
    lastUpdated: new Date(Date.parse(`${latestDate}T00:00:00Z`)).toISOString(),
  };
}

// ---- upstream ------------------------------------------------------------

// All raw presidential-primary polls (both parties), paged with ?offset=.
async function fetchRawPolls() {
  const out = [];
  let total = Infinity;
  for (let page = 0; page < MAX_PAGES && out.length < total; page++) {
    const r = await fetch(`${VOTEHUB_POLLS}?poll_type=presidential-primary&limit=${PAGE_SIZE}&offset=${out.length}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`votehub polls ${r.status}`);
    const d = await r.json();
    const items = d.items || [];
    if (!items.length) break;
    out.push(...items);
    total = Number(d.total) || out.length;
  }
  return out;
}

// Normalized, mislabel-filtered polls for every subject; null when the feed is down.
async function loadPolls() {
  try {
    const polls = (await fetchRawPolls()).map(normalizePoll).filter(Boolean);
    return filterMislabeled(polls).kept;
  } catch {
    return null;
  }
}

const recentOf = (polls) =>
  [...polls]
    .sort((a, b) => b.t - a.t)
    .slice(0, TUNABLES.recentPolls)
    .map((p) => ({
      pollster: p.pollster,
      grade: p.grade,
      endDate: p.endDate,
      sampleSize: p.sampleSize,
      population: p.population,
      url: p.url,
      answers: p.answers.map((a) => ({ id: a.id, name: a.name, pct: a.pct })),
    }));

// One party from the already-loaded poll list (`all`, null if the raw feed failed).
async function buildParty(party, all) {
  const cfg = PARTIES[party];
  const own = all ? all.filter((p) => p.subject === cfg.pollSubject) : null;

  let avg = null;
  if (cfg.votehubAverageKey) {
    try {
      const a = candidatesFromAverages(await getAverageValues(cfg.votehubAverageKey, TUNABLES.trendMaxDays + 190));
      if (a.candidates.length) avg = a;
    } catch {
      // fall through to the raw-poll trailing mean
    }
  }
  if (avg) {
    const cutoff = Date.now() / 1000 - TUNABLES.trailingWindowDays * 86400;
    return {
      party,
      method: "votehub-average",
      lastUpdated: avg.lastUpdated,
      n: own ? own.filter((p) => p.t >= cutoff).length : null,
      candidates: avg.candidates,
      trend: avg.trend,
      recentPolls: own ? recentOf(own) : [],
    };
  }
  if (!own || !own.length) throw new Error(`no ${party} primary polls available`);
  const tm = trailingMean(own);
  return {
    party,
    method: "trailing-mean",
    lastUpdated: tm.lastUpdated,
    n: tm.n,
    candidates: tm.candidates,
    trend: rollingTrend(own, tm.candidates.map((c) => c.id)),
    recentPolls: recentOf(own),
  };
}

export async function getPrimaryPolls(party) {
  if (!PARTIES[party]) throw new Error(`unknown party ${party}`);
  return buildParty(party, await loadPolls());
}

// { dem, rep } from one raw-feed download (what the KV warmer / bootstrap store).
// A party that can't be built comes back null rather than failing the other.
export async function getAllPrimaryPolls() {
  const all = await loadPolls();
  const out = {};
  await Promise.all(
    PARTY_IDS.map(async (p) => {
      try {
        out[p] = await buildParty(p, all);
      } catch {
        out[p] = null;
      }
    })
  );
  return out;
}

// ---- last-good merge (used by the KV warmer) -------------------------------

const polled = (p) => Boolean(p?.candidates?.length);

export function primaryPollsHaveHoles(next) {
  return PARTY_IDS.some((p) => !polled(next?.[p]));
}

// Keep a party's previous entry when this run produced nothing for it.
export function mergePrimaryPollsLastGood(prev, next) {
  if (!next) return prev;
  const out = { ...next };
  for (const p of PARTY_IDS) if (!polled(next[p]) && polled(prev?.[p])) out[p] = prev[p];
  return out;
}
