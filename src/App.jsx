// App shell. The 2026 sections (MacroMetrics, USMap, HouseSection, ...) remain in
// src/components but are not mounted. Only the Presidential section reads the data
// layer so far (PresidentSection: the primaries view). /archive lists past trackers.
import PresidentSection from "./components/PresidentSection";
import ArchivePage from "./components/ArchivePage";
import { usePath, onLinkClick } from "./lib/route";

const SECTIONS = [
  { id: "presidential", title: "Presidential", bare: true, body: <PresidentSection /> },
  { id: "senate", title: "Senate", note: "Coming soon" },
  { id: "house", title: "House", note: "Coming soon" },
  { id: "governors", title: "Governors", note: "Coming soon" },
];

const NAV_LINK =
  "shrink-0 rounded-md border border-ops-border bg-ops-panel-2 px-3 py-1.5 text-xs font-semibold text-ops-text transition-colors hover:border-blue-500/60";

export default function App() {
  const isArchive = usePath() === "/archive";
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-extrabold tracking-tight text-ops-text sm:text-xl">
            <a href="/" onClick={onLinkClick("/")}>
              2028 Election Tracker
            </a>
          </h1>
          <p className="mt-0.5 text-xs text-ops-muted">
            {isArchive ? "Archive" : "Primaries: nomination markets and national polling"}
          </p>
        </div>
        {isArchive ? (
          <a href="/" onClick={onLinkClick("/")} className={NAV_LINK}>
            ← Back to 2028
          </a>
        ) : (
          <a href="/archive" onClick={onLinkClick("/archive")} className={NAV_LINK}>
            Archive
          </a>
        )}
      </header>
      {isArchive ? (
        <ArchivePage />
      ) : (
        SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="rounded-lg border border-ops-border bg-ops-panel p-4">
            {s.bare ? (
              <h2 className="sr-only">{s.title}</h2>
            ) : (
              <h2 className="text-sm font-bold uppercase tracking-wide text-ops-text">{s.title}</h2>
            )}
            {s.note && <p className="mt-1 text-xs text-ops-muted">{s.note}</p>}
            {s.body}
          </section>
        ))
      )}
    </div>
  );
}
