// Data-provenance chip: every graphic is tagged as betting-market odds (amber,
// trend line) or polling average (teal, list bars) so the two read differently
// at a glance. Color + icon + word so it survives colorblindness and skimming.
const KINDS = {
  market: {
    label: "Market",
    title: "Betting-market odds — where real money is",
    color: "#f59e0b",
    icon: (
      <path
        d="M1 8.5L3.8 5l2.1 1.9L9 3"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  polls: {
    label: "Polls",
    title: "Polling average — what surveys say",
    color: "#22d3ee",
    icon: (
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <line x1="1.5" y1="2.5" x2="8.5" y2="2.5" />
        <line x1="1.5" y1="5" x2="6" y2="5" />
        <line x1="1.5" y1="7.5" x2="7.5" y2="7.5" />
      </g>
    ),
  },
  rating: {
    label: "Rating",
    title: "Race rating — analyst judgment",
    color: "#a78bfa",
    icon: (
      <path
        d="M2.5 1.5h5v7L5 6.6 2.5 8.5z"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
        strokeLinejoin="round"
      />
    ),
  },
};

export default function SourceTag({ kind, className = "" }) {
  const k = KINDS[kind];
  if (!k) return null;
  return (
    <span
      title={k.title}
      className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${className}`}
      style={{ color: k.color, backgroundColor: `${k.color}1f` }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        {k.icon}
      </svg>
      {k.label}
    </span>
  );
}
