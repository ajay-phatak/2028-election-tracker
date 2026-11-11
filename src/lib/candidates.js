// Candidate-name normalization shared by the client and the api code (pure, no deps
// beyond the config). "J.D. Vance" and "JD Vance" must resolve to the same id.
import { CANDIDATE_ALIASES } from "../config/president.config.js";

// Lowercase, strip diacritics, drop periods/apostrophes ("J.D." -> "jd"), turn any
// other punctuation into spaces ("Ocasio-Cortez" -> "ocasio cortez"), collapse spaces.
export function normalizeName(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Stable slug id for a candidate name, after applying the alias map.
export function candidateId(name, aliases = CANDIDATE_ALIASES) {
  const n = normalizeName(name);
  return (aliases[n] ?? n).trim().replace(/\s+/g, "-");
}

// Display name from the observed spellings: the most common one, ties going to the
// earliest (callers list the market form first).
export function chooseDisplayName(names) {
  const counts = new Map();
  for (const n of names) if (n) counts.set(n, (counts.get(n) || 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [n, c] of counts) {
    if (c > bestCount) {
      best = n;
      bestCount = c;
    }
  }
  return best;
}

// Poll answers that aren't people.
const NON_CANDIDATE =
  /^(undecided|other|others|someone else|somebody else|dont know|unsure|not sure|none|none of the above|no one|nobody|no opinion|refused|neither|would not vote|wont vote|dk|na|n a|other candidate|another candidate|dont know undecided|undecided dont know|undecided other|not sure undecided)$/;

export function isNonCandidate(name) {
  const n = normalizeName(name);
  return !n || NON_CANDIDATE.test(n);
}
