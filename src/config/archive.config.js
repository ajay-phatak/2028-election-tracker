// Past election trackers, newest first. The current tracker always lives at the site
// root; each past one is served under /<year>/ on the same host.
//
// A past tracker stays its own deployed project. `origin` is where it really runs, and
// functions/<year>/[[path]].js proxies /<year>/* to it (src/lib/archiveProxy.js).
// `origin` must be that project's own address, never the shared hostname, or the
// proxy would loop back to itself.
//
// Adding a year: add an entry here, add functions/<year>/[[path]].js, and make sure
// that tracker is built with relative asset and API paths.
export const ARCHIVE = [
  {
    year: 2026,
    title: "2026 Midterms",
    summary: "Senate and House races: prediction markets, polling, race ratings and election-night results.",
    path: "/2026/",
    origin: "https://2026-election-tracker.pages.dev",
  },
];

export const archiveFor = (year) => ARCHIVE.find((t) => t.year === Number(year)) || null;
