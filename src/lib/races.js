import { WATCHED_RACES } from "../config/races.config";

// Flat list of every watched race across chambers (senate + house).
export const ALL_RACES = Object.values(WATCHED_RACES).flat();

// Unique key per race: senate uses stateCode (GA), house uses code (CA-41).
const byCode = new Map(ALL_RACES.map((r) => [r.code ?? r.stateCode, r]));
// Senate-only by full state name — used to color the state map (house districts
// must never key on a state name or they'd paint whole states).
const senateByName = new Map(WATCHED_RACES.senate.map((r) => [r.state, r]));

// Resolve any watched race (senate or house) by its unique code.
export function getRaceByCode(code) {
  return byCode.get(code) ?? null;
}

// Back-compat alias: the drawer/map historically called this with a state code.
export function getRaceByStateCode(code) {
  return byCode.get(code) ?? null;
}

export function getRaceByStateName(name) {
  return senateByName.get(name) ?? null;
}
