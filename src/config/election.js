// Election-cycle constants derived from ELECTION_DAY (races.config.js), the single
// source of truth. Plain ESM with no extensionless imports so both the client and the
// Node/Workers api code (api/*.js, functions/api/*.js) can import it.
import { ELECTION_DAY } from "./races.config.js";

export const YEAR = Number(ELECTION_DAY.slice(0, 4));
export const YY = String(YEAR).slice(-2); // "28", for Kalshi tickers like <SERIES>-28-D

// Election Day always falls after DST ends (first Sunday of November), so ET is
// UTC-5 on that day and the days after.
const ET = "-05:00";
const DAY_MS = 86400000;
const at = (date, time) => Date.parse(`${date}T${time}${ET}`);
// Calendar date (YYYY-MM-DD) `n` days after ELECTION_DAY.
const plusDays = (n) => new Date(Date.parse(`${ELECTION_DAY}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// Election night: 6 PM ET on election day through midnight two days later.
export const NIGHT_START = at(ELECTION_DAY, "18:00:00");
export const NIGHT_END = at(plusDays(2), "00:00:00");
// Results mode (live vote counts): first poll close through Dec 15 of the election year.
export const RESULTS_END = at(`${YEAR}-12-15`, "00:00:00");
// Morning snapshot: 6 AM ET on election day.
export const MORNING_AT = at(ELECTION_DAY, "06:00:00");
