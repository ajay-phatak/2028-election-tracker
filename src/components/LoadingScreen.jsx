// Full-screen loader shown during the initial data fetch so users see a
// branded "fetching" state instead of a blank/grey screen. Fades out once
// the primary market + polling data has resolved.
export default function LoadingScreen({ visible }) {
  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-ops-bg transition-opacity duration-500 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div className="relative h-16 w-16">
        {/* US-map mark in the center of the spinner */}
        <img
          src="/favicon.svg"
          alt=""
          className="absolute inset-0 m-auto h-9 w-9 animate-pulse rounded"
        />
        {/* Rotating accent ring */}
        <svg className="h-16 w-16 animate-spin text-accent" viewBox="0 0 50 50" fill="none">
          <circle cx="25" cy="25" r="20" stroke="currentColor" strokeOpacity="0.15" strokeWidth="4" />
          <path
            d="M45 25a20 20 0 0 0-20-20"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <div className="flex flex-col items-center gap-3">
        <p className="text-sm font-semibold uppercase tracking-widest text-ops-text">
          Fetching live data
        </p>
        {/* Indeterminate progress bar */}
        <div className="h-1 w-40 overflow-hidden rounded-full bg-ops-border">
          <div className="loading-bar h-full w-1/3 rounded-full bg-accent" />
        </div>
        <p className="text-[10px] uppercase tracking-widest text-ops-muted/70">
          Polymarket · Kalshi · VoteHub
        </p>
      </div>
    </div>
  );
}
