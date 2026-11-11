import { ARCHIVE } from "../config/archive.config.js";

export default function ArchivePage() {
  return (
    <section className="rounded-lg border border-ops-border bg-ops-panel p-4">
      <h2 className="text-base font-extrabold tracking-tight text-ops-text">Past election trackers</h2>
      <p className="mt-1 text-xs text-ops-muted">
        Earlier trackers are kept as they were. Each opens as its own site.
      </p>
      {ARCHIVE.length === 0 ? (
        <p className="mt-4 text-sm text-ops-muted">Nothing archived yet.</p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ARCHIVE.map((t) => (
            <li key={t.year}>
              <a
                href={t.url}
                className="group flex h-full flex-col rounded-lg border border-ops-border bg-ops-panel-2 p-4 transition-colors hover:border-blue-500/60 focus-visible:border-blue-500 focus-visible:outline-none"
              >
                <span className="text-2xl font-extrabold tracking-tight text-ops-text">{t.year}</span>
                <span className="mt-1 text-sm font-bold text-ops-text">{t.title}</span>
                <span className="mt-1 text-xs leading-relaxed text-ops-muted">{t.summary}</span>
                <span className="mt-3 text-xs font-semibold text-blue-400 group-hover:text-blue-300">
                  Open the {t.year} tracker →
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
