// Range selector shared by POLLING history charts (macro poll trends + the
// race drawer's polling average) and MARKET (betting odds) history charts
// (control-market panels + the race drawer's odds history).

import { POLL_RANGES, sliceRange } from "../lib/ranges";

// Small segmented pill control, styled to match the SourceSwitcher in
// MacroMetrics.jsx. When `data` is passed, ranges that would leave fewer than
// 2 points (a one-dot chart is useless) are disabled rather than hidden —
// "All" is always selectable since it never trims anything away. Market
// callers deliberately don't pass `data`: the server already narrows the
// payload to the requested window, so there's nothing to test client-side —
// an empty range surfaces through the caller's existing "No history yet"
// state instead.
export default function RangeSelector({ value, onChange, ranges = POLL_RANGES, data }) {
  return (
    <div
      role="group"
      aria-label="Chart range"
      className="flex items-center gap-0.5 rounded-full border border-ops-border bg-ops-panel-2/60 px-1 py-0.5"
    >
      {ranges.map((r) => {
        const disabled = r.days != null && data && sliceRange(data, r.days).length < 2;
        const active = value === r.id;
        return (
          <button
            key={r.id}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            title={disabled ? "Not enough polling in this window" : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onChange(r.id);
            }}
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
              disabled
                ? "cursor-not-allowed text-ops-muted/40"
                : active
                  ? "bg-accent/15 text-accent"
                  : "text-ops-muted hover:text-ops-text"
            }`}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
