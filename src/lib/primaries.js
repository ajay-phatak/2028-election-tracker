// Pure helpers for the presidential primaries view: joining markets + polls,
// takeaway text, and chart-series building. No React, no fetching.
import { formatDay } from "./format.js";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round1 = (v) => Math.round(v * 10) / 10;

// Percent for display, "—" when missing.
export const fmtPct = (v) => (num(v) == null ? "—" : `${v.toFixed(1)}%`);
export const fmtPct0 = (v) => (num(v) == null ? "—" : `${Math.round(v)}%`);

// Join market candidates and poll candidates by id. A candidate in only one source
// still appears, with null for the other. Rows: { id, name, polymarket, kalshi, avg, poll }.
export function joinCandidates(nomination, polls) {
  const rows = [];
  const byId = new Map();
  for (const c of nomination?.candidates || []) {
    if (!c || c.id == null || byId.has(c.id)) continue;
    const row = {
      id: c.id,
      name: c.name ?? c.id,
      polymarket: num(c.polymarket),
      kalshi: num(c.kalshi),
      avg: num(c.avg),
      poll: null,
    };
    byId.set(c.id, row);
    rows.push(row);
  }
  for (const c of polls?.candidates || []) {
    if (!c || c.id == null) continue;
    const hit = byId.get(c.id);
    if (hit) {
      hit.poll = num(c.pct);
    } else {
      const row = { id: c.id, name: c.name ?? c.id, polymarket: null, kalshi: null, avg: null, poll: num(c.pct) };
      byId.set(c.id, row);
      rows.push(row);
    }
  }
  return rows;
}

// Sort by "avg" (markets) or "poll". Missing values last; ties fall back to the
// other metric, then name, for a stable order. Does not mutate.
export function sortRows(rows, by = "avg") {
  const other = by === "avg" ? "poll" : "avg";
  const key = (v) => (v == null ? -Infinity : v);
  const diff = (a, b) => (a === b ? 0 : a < b ? -1 : 1); // avoids Infinity - Infinity = NaN
  return [...rows].sort(
    (a, b) =>
      diff(key(b[by]), key(a[by])) ||
      diff(key(b[other]), key(a[other])) ||
      String(a.name).localeCompare(String(b.name))
  );
}

// Takeaway as segments [{ t: text, b?: true }] so the component can bold numbers.
// Returns null when there is nothing to say.
export function buildTakeaway(rows) {
  const byMarket = sortRows(rows.filter((r) => r.avg != null), "avg");
  const byPoll = sortRows(rows.filter((r) => r.poll != null), "poll");
  const m = byMarket[0];
  const p = byPoll[0];
  const seg = [];
  if (m && p) {
    if (m.id === p.id) {
      seg.push({ t: "Markets and polls both favour " }, { t: m.name, b: true }, { t: " (" }, { t: fmtPct0(m.avg), b: true });
      seg.push({ t: " markets, " }, { t: fmtPct0(p.poll), b: true }, { t: " polls)" });
    } else {
      seg.push({ t: "Markets favour " }, { t: m.name, b: true }, { t: " at " }, { t: fmtPct0(m.avg), b: true });
      seg.push({ t: "; polls have " }, { t: p.name, b: true }, { t: " ahead at " }, { t: fmtPct0(p.poll), b: true });
    }
  } else if (m) {
    seg.push({ t: "Markets favour " }, { t: m.name, b: true }, { t: " at " }, { t: fmtPct0(m.avg), b: true });
    if (byMarket[1]) seg.push({ t: `, ${byMarket[1].name} next at ` }, { t: fmtPct0(byMarket[1].avg), b: true });
  } else if (p) {
    seg.push({ t: "Polls have " }, { t: p.name, b: true }, { t: " ahead at " }, { t: fmtPct0(p.poll), b: true });
  } else {
    return null;
  }
  seg.push({ t: "." });
  return seg;
}

export const segmentsToText = (segs) => (segs || []).map((s) => s.t).join("");

// Which history source to show first: the first with data, else the first.
export function defaultHistorySource(history) {
  const sources = history?.sources || [];
  return (sources.find((s) => s.hasData) || sources[0])?.id ?? null;
}

// Build TrendChart input from rows shaped { t, <id>: pct } for the top `limit`
// candidates. Ranked by newest value, or by an explicit id `order`. Series with
// fewer than 2 points are dropped (a lone dot draws nothing and would only add a
// legend entry). Values are rounded to 0.1.
// Returns { data, series:[{key,label,color}], ok } where ok means there is
// something to draw (>= 1 series and >= 2 rows).
export function buildSeries(points, names, colorOf, { limit = 5, order = null } = {}) {
  const rows = (points || []).filter((r) => r && num(r.t) != null).sort((a, b) => a.t - b.t);
  const counts = new Map();
  const latest = new Map();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (k === "t" || num(v) == null) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
      latest.set(k, v); // rows are time-ordered, so the last write is the newest
    }
  }
  const candidates = [...counts.keys()].filter((id) => counts.get(id) >= 2);
  const ranked = order
    ? [...order.filter((id) => candidates.includes(id)), ...candidates.filter((id) => !order.includes(id))]
    : candidates.sort((a, b) => latest.get(b) - latest.get(a));
  const keep = ranked.slice(0, limit);
  const series = keep.map((id) => ({ key: id, label: names?.get?.(id) ?? id, color: colorOf(id) }));
  const data = rows.map((r) => {
    const out = { t: r.t };
    for (const id of keep) if (num(r[id]) != null) out[id] = round1(r[id]);
    return out;
  });
  return { data, series, ok: series.length > 0 && data.length >= 2 };
}

// Chart input for the nomination-odds history of one source id.
export function buildHistorySeries(history, sourceId, colorOf, limit = 5) {
  const names = new Map((history?.candidates || []).map((c) => [c.id, c.name]));
  const src = (history?.sources || []).find((s) => s.id === sourceId);
  return buildSeries(src?.points, names, colorOf, { limit });
}

// Chart input for the polling trend, ranked by the current poll average.
export function buildPollTrendSeries(polls, colorOf, limit = 5) {
  const names = new Map((polls?.candidates || []).map((c) => [c.id, c.name]));
  const order = (polls?.candidates || []).map((c) => c.id);
  return buildSeries(polls?.trend, names, colorOf, { limit, order });
}

// Caption stating how the polling numbers were produced.
export function pollMethodCaption(polls) {
  if (!polls) return "";
  const method =
    polls.method === "votehub-average"
      ? "VoteHub average"
      : polls.n != null
        ? `Trailing mean of ${polls.n} polls`
        : "Trailing mean of polls";
  const day = polls.lastUpdated ? formatDay(polls.lastUpdated) : null;
  return day && day !== "—" ? `${method} · last updated ${day}` : method;
}

// Highest `n` answers of a raw poll that carry a number.
export function topAnswers(poll, n = 4) {
  return [...(poll?.answers || [])]
    .filter((a) => a && num(a.pct) != null)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, n);
}

// Poll sample as "1,200 RV"; blank parts dropped.
export function sampleLabel(poll) {
  const size = num(poll?.sampleSize) != null ? Math.round(poll.sampleSize).toLocaleString("en-US") : null;
  return [size, poll?.population].filter(Boolean).join(" ") || "—";
}

// Only http(s) links are rendered as links.
export const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);
