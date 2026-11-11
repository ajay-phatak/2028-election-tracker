// Scaffold shell. The 2026 sections (MacroMetrics, USMap, HouseSection, ...) remain in
// src/components but are not mounted. Only the Presidential section reads the data
// layer so far (PresidentSection: a primary-odds/polls verification readout).
import PresidentSection from "./components/PresidentSection";

const SECTIONS = [
  { id: "presidential", title: "Presidential", note: "Primaries / general election", body: <PresidentSection /> },
  { id: "senate", title: "Senate" },
  { id: "house", title: "House" },
  { id: "governors", title: "Governors" },
];

export default function App() {
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-lg font-extrabold tracking-tight text-ops-text sm:text-xl">
          2028 Election Tracker
        </h1>
        <p className="mt-0.5 text-xs text-ops-muted">Scaffold — sections coming</p>
      </header>
      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="rounded-lg border border-ops-border bg-ops-panel p-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ops-text">{s.title}</h2>
          {s.note && <p className="mt-1 text-xs text-ops-muted">{s.note}</p>}
          {s.body}
        </section>
      ))}
    </div>
  );
}
