// 2028 presidential nomination markets (Polymarket + Kalshi), N candidates per
// party. Unlike the two-sided Senate/House code in _providers.js, candidates are
// discovered from the markets themselves and merged across sources by candidateId.
// Reuses _providers.js's edgeFetch-backed getJson/kalshiFetch, retry policies,
// mapLimit and history helpers. Probabilities are 0-100 with one decimal, the same
// unit _providers.js sends the client.

import { PARTIES, TUNABLES } from "../src/config/president.config.js";
import { candidateId, chooseDisplayName } from "../src/lib/candidates.js";
import {
  PATIENT,
  PM_BASE,
  KALSHI_ELECTIONS,
  getJson,
  kalshiFetch,
  kalshiCandles,
  pricesHistory,
  marketYes,
  toPct,
  mapLimit,
  resolveMarketRange,
  sliceSources,
} from "./_providers.js";

const round1 = (x) => Math.round(x * 10) / 10;

// ---- pure merge ----------------------------------------------------------

// Merge per-source market lists into candidates, matched by candidateId.
// `sources`: { polymarket, kalshi }, each [{ name, price (0-100) }] or null when
// that source failed (its values become null). Sorted by avg desc (avg = mean of the
// sources that have a price), then cut to `minOddsPct` and `maxCandidates`.
export function mergeMarketSources(
  sources,
  { maxCandidates = TUNABLES.maxCandidates, minOddsPct = TUNABLES.minOddsPct } = {}
) {
  const byId = new Map();
  for (const key of ["polymarket", "kalshi"]) {
    for (const m of sources[key] || []) {
      if (m.price == null || !Number.isFinite(m.price)) continue;
      const id = candidateId(m.name);
      if (!id) continue;
      const c = byId.get(id) || { id, names: [], polymarket: null, kalshi: null };
      c.names.push(m.name);
      // Two markets for one candidate in a source: keep the higher price.
      c[key] = c[key] == null ? m.price : Math.max(c[key], m.price);
      byId.set(id, c);
    }
  }
  return [...byId.values()]
    .map((c) => {
      const vals = [c.polymarket, c.kalshi].filter((v) => v != null);
      return {
        id: c.id,
        name: chooseDisplayName(c.names),
        polymarket: c.polymarket,
        kalshi: c.kalshi,
        avg: vals.length ? round1(vals.reduce((s, v) => s + v, 0) / vals.length) : null,
      };
    })
    .filter((c) => c.avg != null && c.avg >= minOddsPct)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, maxCandidates);
}

// ---- upstream ------------------------------------------------------------

// Open Polymarket sub-markets of the nominee event -> [{ name, price, token }].
async function loadPolymarket(cfg, opts) {
  try {
    const data = await getJson(`${PM_BASE}/events?slug=${encodeURIComponent(cfg.polymarketSlug)}`, opts);
    const ev = Array.isArray(data) ? data[0] : null;
    if (!ev || !Array.isArray(ev.markets)) throw new Error("no event");
    const markets = [];
    for (const m of ev.markets) {
      if (m.closed || m.active === false || !m.groupItemTitle) continue;
      const yes = marketYes(m);
      if (yes == null) continue;
      let token = null;
      try {
        token = JSON.parse(m.clobTokenIds)?.[0] ?? null;
      } catch {
        // no token -> current odds only, no history
      }
      markets.push({ name: m.groupItemTitle, price: toPct(yes), token });
    }
    const num = (x) => (x == null || Number.isNaN(Number(x)) ? null : Number(x));
    const volume = { total: num(ev.volume), h24: num(ev.volume24hr), week: num(ev.volume1wk), liquidity: num(ev.liquidity) };
    return { ok: markets.length > 0, markets, volume };
  } catch {
    return { ok: false, markets: [], volume: null };
  }
}

// Open Kalshi markets of the nominee series -> [{ name, price, ticker }].
async function loadKalshi(cfg, opts) {
  try {
    const markets = [];
    let cursor = "";
    for (let page = 0; page < 3; page++) {
      const d = await kalshiFetch(
        `${KALSHI_ELECTIONS}/markets?series_ticker=${cfg.kalshiSeries}&status=open&limit=200${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
        }`,
        opts
      );
      for (const m of d.markets || []) {
        if (m.event_ticker !== cfg.kalshiEvent || !m.yes_sub_title) continue;
        const p = m.last_price_dollars;
        if (p == null || p === "") continue;
        markets.push({ name: m.yes_sub_title, price: toPct(p), ticker: m.ticker });
      }
      cursor = d.cursor || "";
      if (!cursor) break;
    }
    return { ok: markets.length > 0, markets };
  } catch {
    return { ok: false, markets: [] };
  }
}

async function loadNomination(party, opts = PATIENT) {
  const cfg = PARTIES[party];
  if (!cfg) throw new Error(`unknown party ${party}`);
  const [pm, ks] = await Promise.all([loadPolymarket(cfg, opts), loadKalshi(cfg, opts)]);
  const candidates = mergeMarketSources({
    polymarket: pm.ok ? pm.markets : null,
    kalshi: ks.ok ? ks.markets : null,
  });
  return { cfg, pm, ks, candidates };
}

export async function getNominationOdds(party) {
  const { pm, ks, candidates } = await loadNomination(party);
  return {
    party,
    updatedAt: new Date().toISOString(),
    candidates,
    sources: { polymarket: { ok: pm.ok, volume: pm.volume }, kalshi: { ok: ks.ok } },
  };
}

// { dem, rep } in one call (what the KV warmer / bootstrap store).
export async function getAllNomination() {
  const [dem, rep] = await Promise.all([getNominationOdds("dem"), getNominationOdds("rep")]);
  return { dem, rep };
}

// ---- history -------------------------------------------------------------

// { [candidateId]: [{ t, p }] } -> [{ t, [id]: p, ... }] bucketed to `bucketSeconds`
// (last point in a bucket wins), sorted oldest -> newest. Matches TrendChart's rows.
export function bucketRows(byCandidate, bucketSeconds) {
  const rows = new Map();
  for (const [id, pts] of Object.entries(byCandidate)) {
    for (const x of pts) {
      const t = Math.floor(x.t / bucketSeconds) * bucketSeconds;
      const row = rows.get(t) || { t };
      row[id] = x.p;
      rows.set(t, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

// Price history for the top N candidates, in the same `sources` shape as the
// two-sided histories (Polymarket and Kalshi kept separate, each bucketed alone):
//   { party, range, candidates:[{id,name}], sources:[{ id, label, points:[{t,<candidateId>:pct}], hasData }] }
// A TrendChart series per candidate is { key: id, label: name } (colors are the caller's).
export async function getNominationHistory(party, range = "all") {
  const { cfg, pm, ks, candidates } = await loadNomination(party);
  const top = candidates.slice(0, TUNABLES.historyCandidates);
  const r = resolveMarketRange(range);
  const tokenOf = new Map(pm.markets.map((m) => [candidateId(m.name), m.token]));
  const tickerOf = new Map(ks.markets.map((m) => [candidateId(m.name), m.ticker]));

  const pmSeries = {};
  const ksSeries = {};
  await mapLimit(top, 3, async (c) => {
    const token = tokenOf.get(c.id);
    const ticker = tickerOf.get(c.id);
    const [a, b] = await Promise.all([
      token ? pricesHistory(token, r.pmInterval, r.pmFidelity) : [],
      ticker
        ? kalshiCandles(cfg.kalshiSeries, ticker, {
            ...PATIENT,
            days: r.kalshiSpanDays,
            periodInterval: r.kalshiPeriodInterval,
          })
        : [],
    ]);
    pmSeries[c.id] = a;
    ksSeries[c.id] = b;
  });

  const pmPoints = bucketRows(pmSeries, r.pmBucketSeconds);
  const ksPoints = bucketRows(ksSeries, r.kalshiBucketSeconds);
  let sources = [
    { id: "polymarket", label: "Polymarket", points: pmPoints, hasData: pmPoints.length > 0, volume: pm.volume },
    { id: "kalshi", label: "Kalshi", points: ksPoints, hasData: ksPoints.length > 0 },
  ];
  // "90d" shares "all"'s upstream params (same edge-cache key) and is narrowed here.
  if (range === "90d") sources = sliceSources(sources, 90);
  return { party, range, candidates: top.map((c) => ({ id: c.id, name: c.name })), sources };
}

// ---- last-good merge (used by the KV warmer) -------------------------------

const okCount = (p) => (p?.sources?.polymarket?.ok ? 1 : 0) + (p?.sources?.kalshi?.ok ? 1 : 0);

// True when any party in a { dem, rep } nomination payload lost a source or its candidates.
export function nominationHasHoles(next) {
  return ["dem", "rep"].some((p) => !next?.[p] || okCount(next[p]) < 2 || !next[p].candidates?.length);
}

// Per party, keep the previous entry when this run is worse (fewer sources up, or no
// candidates). The carried entry keeps its own updatedAt so staleness stays visible.
export function mergeNominationLastGood(prev, next) {
  if (!next) return prev;
  const out = { ...next };
  for (const p of ["dem", "rep"]) {
    const n = next[p];
    const o = prev?.[p];
    if (o && (!n || !n.candidates?.length || okCount(n) < okCount(o))) out[p] = o;
  }
  return out;
}
