// TODO(2028): fill in from a verified source (e.g. 270toWin poll closing times) once
// published for the 2028 general election.
// When ALL polls in each state have closed on Election Day, keyed by postal code, as
// ISO instants with an explicit ET offset: { GA: "2028-11-07T19:00:00-05:00", ... }.
// ET is UTC-5 on election day (DST has ended). States that span time zones use their
// latest close.
export const POLL_CLOSINGS = {};
