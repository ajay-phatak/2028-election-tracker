import { describe, expect, it } from "vitest";
import { candidateId, chooseDisplayName, isNonCandidate } from "../src/lib/candidates.js";

describe("candidateId", () => {
  it("merges J.D. Vance and JD Vance", () => {
    expect(candidateId("J.D. Vance")).toBe(candidateId("JD Vance"));
    expect(candidateId("J.D. Vance")).toBe("jd-vance");
  });
  it("strips diacritics, punctuation and extra spaces", () => {
    expect(candidateId("  Alexandria  Ocasio-Cortez ")).toBe("alexandria-ocasio-cortez");
    expect(candidateId("José Núñez")).toBe("jose-nunez");
    expect(candidateId("Stephen A. Smith")).toBe("stephen-a-smith");
  });
  it("applies aliases (keys/values are normalized names)", () => {
    const aliases = { aoc: "alexandria ocasio cortez" };
    expect(candidateId("AOC", aliases)).toBe("alexandria-ocasio-cortez");
    expect(candidateId("A.O.C.", aliases)).toBe("alexandria-ocasio-cortez");
    expect(candidateId("Alexandria Ocasio-Cortez", aliases)).toBe("alexandria-ocasio-cortez");
  });
});

describe("chooseDisplayName", () => {
  it("prefers the most common spelling, then the first seen", () => {
    expect(chooseDisplayName(["JD Vance", "J.D. Vance", "J.D. Vance"])).toBe("J.D. Vance");
    expect(chooseDisplayName(["JD Vance", "J.D. Vance"])).toBe("JD Vance");
  });
});

describe("isNonCandidate", () => {
  it.each(["Undecided", "Other", "Someone else", "Don't know", "Not sure", "None of the above", "Unsure"])(
    "flags %s",
    (n) => expect(isNonCandidate(n)).toBe(true)
  );
  it("keeps real names", () => {
    expect(isNonCandidate("Gavin Newsom")).toBe(false);
    expect(isNonCandidate("Mark Cuban")).toBe(false);
  });
});
