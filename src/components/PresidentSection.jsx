// 2028 Presidential Race: the primaries view. Per-party phase decides between the
// full panel (primary) and the compact one (presumptive / nominee). No dates,
// delegates or calendar: everything shown comes from the data hooks or config.
import { PARTIES, PARTY_IDS } from "../config/president.config";
import { formatUpdated } from "../lib/format";
import { useDataAsOf } from "../lib/liveData";
import { CompactPanel, PrimaryPanel } from "./PartyPanel";

export default function PresidentSection() {
  const asOf = useDataAsOf();
  const allNominees = PARTY_IDS.every((p) => PARTIES[p].phase === "nominee");
  const anyPrimary = PARTY_IDS.some((p) => PARTIES[p].phase === "primary");

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-extrabold tracking-tight text-ops-text">
          2028 Presidential Race
          {anyPrimary && (
            <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide text-ops-muted">
              Primaries
            </span>
          )}
        </h3>
        {asOf != null && (
          <span className="tabular text-[10px] text-ops-muted">Updated {formatUpdated(new Date(asOf).toISOString())}</span>
        )}
      </div>
      {allNominees ? (
        <p className="mt-3 rounded-xl border border-ops-border bg-ops-panel/60 p-6 text-center text-sm text-ops-muted">
          Both nominees are set. The general-election view is coming.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {PARTY_IDS.map((p) =>
            PARTIES[p].phase === "primary" ? <PrimaryPanel key={p} party={p} /> : <CompactPanel key={p} party={p} />
          )}
        </div>
      )}
    </div>
  );
}
