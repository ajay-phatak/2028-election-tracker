import { formatMoney } from "../lib/format";

// Compact Polymarket volume/liquidity context shown under a history chart.
export default function VolumeStat({ volume }) {
  if (!volume || volume.total == null) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] uppercase tracking-wide text-ops-muted/80">
      <span>
        <span className="font-semibold text-ops-text">{formatMoney(volume.total)}</span> traded
      </span>
      {volume.h24 != null && (
        <span>
          <span className="font-semibold text-ops-text">{formatMoney(volume.h24)}</span> 24h
        </span>
      )}
      {volume.liquidity != null && (
        <span>
          <span className="font-semibold text-ops-text">{formatMoney(volume.liquidity)}</span> liquidity
        </span>
      )}
    </div>
  );
}
