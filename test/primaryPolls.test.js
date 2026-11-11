import { describe, expect, it } from "vitest";
import {
  filterMislabeled,
  normalizePoll,
  trailingMean,
  rollingTrend,
  candidatesFromAverages,
} from "../api/_primaryPolls.js";

let n = 0;
const raw = (subject, names, end = "2026-10-01", pcts = []) => ({
  id: `p${n++}`,
  subject,
  pollster: "Test",
  sample_size: 500,
  population: "lv",
  end_date: end,
  answers: names.map((choice, i) => ({ choice, pct: pcts[i] ?? 10 })),
});

const DEM = ["Gavin Newsom", "Kamala Harris", "Pete Buttigieg", "Undecided"];
const REP = ["JD Vance", "Marco Rubio", "Donald Trump Jr.", "Other"];

// 6 genuine polls per party plus a McLaughlin-style poll: labelled Democratic but
// listing Republican candidates (spelled "J.D. Vance").
function fixture() {
  const polls = [];
  for (let i = 0; i < 6; i++) polls.push(raw("2028 Democratic", DEM), raw("2028 Republican", REP));
  const bad = raw("2028 Democratic", ["J.D. Vance", "Marco Rubio", "Donald Trump Jr.", "Ron DeSantis", "Bernie Sanders"]);
  bad.pollster = "McLaughlin & Associates";
  return { polls: polls.concat(bad).map(normalizePoll), bad };
}

describe("normalizePoll", () => {
  it("flags non-candidate answers with a null id and merges name variants", () => {
    const p = normalizePoll(raw("2028 Republican", ["J.D. Vance", "Undecided", "Someone else"]));
    expect(p.answers.map((a) => a.id)).toEqual(["jd-vance", null, null]);
    expect(normalizePoll(raw("x", ["JD Vance"])).answers[0].id).toBe("jd-vance");
  });
  it("drops internal polls and polls with no candidates", () => {
    expect(normalizePoll(raw("x", ["Undecided"]))).toBeNull();
    expect(normalizePoll({ ...raw("x", ["JD Vance"]), internal: true })).toBeNull();
  });
});

describe("filterMislabeled", () => {
  it("drops the McLaughlin-style poll that lists Republicans under the Democratic label", () => {
    const { polls, bad } = fixture();
    const { kept, dropped } = filterMislabeled(polls);
    expect(dropped.map((p) => p.pollster)).toEqual(["McLaughlin & Associates"]);
    expect(dropped[0].id).toBe(bad.id);
    expect(kept).toHaveLength(polls.length - 1);
  });
  it("keeps genuine polls of both parties", () => {
    const { polls } = fixture();
    const { kept } = filterMislabeled(polls);
    expect(kept.filter((p) => p.subject === "2028 Democratic")).toHaveLength(6);
    expect(kept.filter((p) => p.subject === "2028 Republican")).toHaveLength(6);
  });
  it("keeps a poll that mostly lists its own party's field", () => {
    const { polls } = fixture();
    const mixed = normalizePoll(raw("2028 Democratic", ["Gavin Newsom", "Kamala Harris", "Marco Rubio"]));
    expect(filterMislabeled([...polls, mixed]).kept).toContain(mixed);
  });
});

describe("trailingMean", () => {
  const now = Date.parse("2026-11-10T00:00:00Z");
  const polls = [
    normalizePoll(raw("s", ["A One", "B Two", "Undecided"], "2026-11-05", [40, 20, 30])),
    normalizePoll(raw("s", ["A One", "B Two"], "2026-10-20", [50, 10])),
    normalizePoll(raw("s", ["A One", "C Three"], "2026-10-01", [30, 5])),
    normalizePoll(raw("s", ["A One", "B Two"], "2025-01-01", [99, 99])), // outside the window
  ];

  it("averages per candidate over the window and excludes non-candidates", () => {
    const r = trailingMean(polls, { now, windowDays: 90, minN: 1, minPollsPerCandidate: 2 });
    expect(r.n).toBe(3);
    const byId = Object.fromEntries(r.candidates.map((c) => [c.id, c.pct]));
    expect(byId).toEqual({ "a-one": 40, "b-two": 15 }); // C Three has 1 poll; Undecided excluded
    expect(r.candidates.map((c) => c.id)).toEqual(["a-one", "b-two"]);
    expect(r.lastUpdated).toBe("2026-11-05T00:00:00.000Z");
  });
  it("widens to the newest minN polls when the window is sparse", () => {
    const r = trailingMean(polls, { now, windowDays: 1, minN: 2, minPollsPerCandidate: 1 });
    expect(r.n).toBe(2);
  });
  it("returns empty for no polls", () => {
    expect(trailingMean([], { now })).toEqual({ candidates: [], n: 0, lastUpdated: null });
  });
});

describe("rollingTrend / candidatesFromAverages", () => {
  it("builds rows keyed by candidate id over a trailing window", () => {
    const polls = [
      normalizePoll(raw("s", ["A One", "B Two"], "2026-10-01", [10, 20])),
      normalizePoll(raw("s", ["A One", "B Two"], "2026-10-10", [30, 20])),
    ];
    const rows = rollingTrend(polls, ["a-one", "b-two"], { windowDays: 30 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ "a-one": 10, "b-two": 20 });
    expect(rows[1]).toMatchObject({ "a-one": 20, "b-two": 20 });
  });
  it("reads VoteHub average values, dropping non-candidates", () => {
    const v = {
      "2026-10-01": { "A One": { average: 10, lower: 8, upper: 12 } },
      "2026-10-02": {
        "A One": { average: 12, lower: 9, upper: 15 },
        "B Two": { average: 5, lower: 1, upper: 9 },
        Undecided: { average: 20 },
      },
    };
    const r = candidatesFromAverages(v);
    expect(r.candidates.map((c) => c.id)).toEqual(["a-one", "b-two"]);
    expect(r.candidates[0]).toMatchObject({ pct: 12, lower: 9, upper: 15 });
    expect(r.trend).toHaveLength(2);
    expect(r.trend[1]).toMatchObject({ "a-one": 12, "b-two": 5 });
  });
});
