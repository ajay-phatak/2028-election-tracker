import { describe, expect, it } from "vitest";
import {
  buildHistorySeries,
  buildPollTrendSeries,
  buildTakeaway,
  defaultHistorySource,
  joinCandidates,
  pollMethodCaption,
  safeUrl,
  sampleLabel,
  segmentsToText,
  sortRows,
  topAnswers,
} from "../src/lib/primaries.js";
import { assignCandidateColors, CANDIDATE_PALETTE, NEUTRAL_COLOR } from "../src/lib/candidateColors.js";

const nomination = {
  candidates: [
    { id: "a", name: "Alice", polymarket: 30, kalshi: 22, avg: 26 },
    { id: "b", name: "Bob", polymarket: null, kalshi: 10, avg: 10 },
  ],
};
const polls = {
  candidates: [
    { id: "c", name: "Carol", pct: 30 },
    { id: "a", name: "Alice", pct: 25 },
  ],
};

describe("joinCandidates", () => {
  it("joins by id and keeps candidates present in only one source", () => {
    const rows = joinCandidates(nomination, polls);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(rows[0].poll).toBe(25);
    expect(rows[1]).toMatchObject({ polymarket: null, poll: null });
    expect(rows[2]).toMatchObject({ avg: null, polymarket: null, kalshi: null, poll: 30 });
  });
  it("tolerates null / empty inputs", () => {
    expect(joinCandidates(null, null)).toEqual([]);
    expect(joinCandidates({ candidates: [] }, { candidates: null })).toEqual([]);
  });
});

describe("sortRows", () => {
  const rows = joinCandidates(nomination, polls);
  it("sorts by market with missing last", () => {
    expect(sortRows(rows, "avg").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("sorts by polls with missing last, without mutating", () => {
    expect(sortRows(rows, "poll").map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("buildTakeaway", () => {
  it("names a different market and poll leader", () => {
    const t = segmentsToText(buildTakeaway(joinCandidates(nomination, polls)));
    expect(t).toBe("Markets favour Alice at 26%; polls have Carol ahead at 30%.");
  });
  it("handles the same leader", () => {
    const t = segmentsToText(
      buildTakeaway(joinCandidates(nomination, { candidates: [{ id: "a", name: "Alice", pct: 25 }] }))
    );
    expect(t).toBe("Markets and polls both favour Alice (26% markets, 25% polls).");
  });
  it("handles a single source or none", () => {
    expect(segmentsToText(buildTakeaway(joinCandidates(nomination, null)))).toBe(
      "Markets favour Alice at 26%, Bob next at 10%."
    );
    expect(segmentsToText(buildTakeaway(joinCandidates(null, polls)))).toBe("Polls have Carol ahead at 30%.");
    expect(buildTakeaway([])).toBeNull();
  });
});

describe("colours", () => {
  it("assigns in fixed order, stable across lists, neutral beyond the palette", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const colorOf = assignCandidateColors(ids.slice(0, 3), ids);
    expect(colorOf("c0")).toBe(CANDIDATE_PALETTE[0]);
    expect(colorOf("c2")).toBe(CANDIDATE_PALETTE[2]);
    expect(colorOf("c7")).toBe(CANDIDATE_PALETTE[7]);
    expect(colorOf("c8")).toBe(NEUTRAL_COLOR);
    expect(colorOf("unknown")).toBe(NEUTRAL_COLOR);
  });
  it("gives distinct colours within the palette", () => {
    expect(new Set(CANDIDATE_PALETTE).size).toBe(CANDIDATE_PALETTE.length);
  });
});

describe("history series", () => {
  const history = {
    candidates: [
      { id: "a", name: "Alice" },
      { id: "b", name: "Bob" },
      { id: "z", name: "Zed" },
    ],
    sources: [
      { id: "polymarket", label: "Polymarket", hasData: false, points: [] },
      {
        id: "kalshi",
        label: "Kalshi",
        hasData: true,
        points: [
          { t: 2, a: 31.234, b: 20 },
          { t: 1, a: 30, b: 18, z: 5 },
          { t: 3, a: 33, b: 40 },
        ],
      },
    ],
  };
  const colorOf = assignCandidateColors(["a", "b"]);
  it("defaults to the first source with data", () => {
    expect(defaultHistorySource(history)).toBe("kalshi");
    expect(defaultHistorySource({ sources: [{ id: "x", hasData: false }] })).toBe("x");
    expect(defaultHistorySource(null)).toBeNull();
  });
  it("ranks by latest value, sorts by time, rounds, and drops 1-point series", () => {
    const { data, series, ok } = buildHistorySeries(history, "kalshi", colorOf);
    expect(ok).toBe(true);
    expect(series.map((s) => s.key)).toEqual(["b", "a"]);
    expect(series[0]).toEqual({ key: "b", label: "Bob", color: CANDIDATE_PALETTE[1] });
    expect(data.map((r) => r.t)).toEqual([1, 2, 3]);
    expect(data[1].a).toBe(31.2);
    expect(data[0].z).toBeUndefined();
  });
  it("respects the candidate limit and reports empty sources", () => {
    expect(buildHistorySeries(history, "kalshi", colorOf, 1).series).toHaveLength(1);
    expect(buildHistorySeries(history, "polymarket", colorOf).ok).toBe(false);
    expect(buildHistorySeries(null, "kalshi", colorOf).ok).toBe(false);
  });
});

describe("poll trend series", () => {
  const colorOf = assignCandidateColors(["a", "c"]);
  it("orders by current poll average and flags a short trend", () => {
    const p = {
      candidates: [
        { id: "c", name: "Carol", pct: 30 },
        { id: "a", name: "Alice", pct: 25 },
      ],
      trend: [
        { t: 1, a: 24, c: 20 },
        { t: 2, a: 25, c: 30 },
      ],
    };
    const out = buildPollTrendSeries(p, colorOf);
    expect(out.series.map((s) => s.key)).toEqual(["c", "a"]);
    expect(out.ok).toBe(true);
    expect(buildPollTrendSeries({ ...p, trend: [p.trend[0]] }, colorOf).ok).toBe(false);
    expect(buildPollTrendSeries({ candidates: [], trend: [] }, colorOf).ok).toBe(false);
  });
});

describe("poll helpers", () => {
  it("states the method", () => {
    expect(pollMethodCaption({ method: "votehub-average", lastUpdated: "2028-09-28T00:00:00Z" })).toBe(
      "VoteHub average · last updated Sep 28"
    );
    expect(pollMethodCaption({ method: "trailing-mean", n: 12, lastUpdated: null })).toBe("Trailing mean of 12 polls");
    expect(pollMethodCaption(null)).toBe("");
  });
  it("picks top answers, labels samples, validates urls", () => {
    const poll = { answers: [{ id: "a", pct: 10 }, { id: "b", pct: 40 }, { id: "c", pct: null }, { id: "d", pct: 25 }] };
    expect(topAnswers(poll, 2).map((a) => a.id)).toEqual(["b", "d"]);
    expect(topAnswers(null)).toEqual([]);
    expect(sampleLabel({ sampleSize: 1200, population: "RV" })).toBe("1,200 RV");
    expect(sampleLabel({})).toBe("—");
    expect(safeUrl("https://x.test/p")).toBe("https://x.test/p");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
  });
});
