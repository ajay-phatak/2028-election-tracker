import { describe, expect, it } from "vitest";
import { mergeMarketSources, bucketRows, mergeNominationLastGood } from "../api/_nomination.js";

describe("mergeMarketSources", () => {
  const pm = [
    { name: "JD Vance", price: 50 },
    { name: "Marco Rubio", price: 10 },
    { name: "Long Shot", price: 0.2 },
  ];
  const ks = [
    { name: "J.D. Vance", price: 52 },
    { name: "Donald Trump Jr.", price: 4 },
    { name: "Long Shot", price: 0.1 },
  ];

  it("merges the same candidate across sources and averages", () => {
    const out = mergeMarketSources({ polymarket: pm, kalshi: ks });
    const vance = out.find((c) => c.id === "jd-vance");
    expect(vance).toEqual({ id: "jd-vance", name: "JD Vance", polymarket: 50, kalshi: 52, avg: 51 });
    expect(out.filter((c) => c.id === "jd-vance")).toHaveLength(1);
  });
  it("keeps single-source candidates, sorts by avg, applies the threshold", () => {
    const out = mergeMarketSources({ polymarket: pm, kalshi: ks }, { minOddsPct: 1 });
    expect(out.map((c) => c.id)).toEqual(["jd-vance", "marco-rubio", "donald-trump-jr"]);
    expect(out[1]).toMatchObject({ polymarket: 10, kalshi: null, avg: 10 });
  });
  it("cuts to maxCandidates", () => {
    expect(mergeMarketSources({ polymarket: pm, kalshi: ks }, { maxCandidates: 2 })).toHaveLength(2);
  });
  it("a failed source (null) leaves its values null without failing", () => {
    const out = mergeMarketSources({ polymarket: null, kalshi: ks });
    expect(out[0]).toMatchObject({ id: "jd-vance", polymarket: null, kalshi: 52, avg: 52 });
  });
});

describe("bucketRows / last-good", () => {
  it("aligns candidates into one row per bucket", () => {
    const rows = bucketRows({ a: [{ t: 100, p: 1 }, { t: 90000, p: 2 }], b: [{ t: 110, p: 3 }] }, 86400);
    expect(rows).toEqual([{ t: 0, a: 1, b: 3 }, { t: 86400, a: 2 }]);
  });
  it("keeps the previous party entry when a source dropped out", () => {
    const entry = (k, ok) => ({ candidates: [{ id: "x" }], sources: { polymarket: { ok: true }, kalshi: { ok } }, k });
    const merged = mergeNominationLastGood(
      { dem: entry("old", true), rep: entry("old", true) },
      { dem: entry("new", false), rep: entry("new", true) }
    );
    expect(merged.dem.k).toBe("old");
    expect(merged.rep.k).toBe("new");
  });
});
