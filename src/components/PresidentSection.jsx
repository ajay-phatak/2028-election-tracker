// Verification readout for the 2028 presidential primary data layer: one compact
// table per party (candidate, Polymarket, Kalshi, poll average). Not final design.
import { PARTIES, PARTY_IDS } from "../config/president.config";
import { useNomination, usePrimaryPolls } from "../lib/liveData";
import SourceTag from "./SourceTag";

const pct = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);

// Market candidates first (by market average), then poll-only candidates, joined by id.
function buildRows(nomination, polls) {
  const pollById = new Map((polls?.candidates || []).map((c) => [c.id, c]));
  const rows = (nomination?.candidates || []).map((c) => ({ ...c, poll: pollById.get(c.id)?.pct ?? null }));
  const seen = new Set(rows.map((r) => r.id));
  for (const c of polls?.candidates || []) {
    if (!seen.has(c.id)) rows.push({ id: c.id, name: c.name, polymarket: null, kalshi: null, avg: null, poll: c.pct });
  }
  return rows;
}

function PartyTable({ party }) {
  const cfg = PARTIES[party];
  const nom = useNomination(party);
  const polls = usePrimaryPolls(party);

  const rows = buildRows(nom.data, polls.data);
  const pollNote = polls.data
    ? polls.data.method === "votehub-average"
      ? "VoteHub average"
      : `trailing mean of ${polls.data.n} polls`
    : null;

  return (
    <div className="min-w-0">
      <h3 className="text-xs font-bold uppercase tracking-wide text-ops-text">
        {cfg.label} nomination <span className="font-normal normal-case text-ops-muted">({cfg.phase})</span>
      </h3>
      {nom.loading && polls.loading ? (
        <p className="mt-2 text-xs text-ops-muted">Loading…</p>
      ) : (
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="border-b border-ops-border text-left text-[10px] uppercase tracking-wide text-ops-muted">
              <th className="py-1 pr-2 font-semibold">Candidate</th>
              <th className="px-2 py-1 text-right font-semibold">Polymarket</th>
              <th className="px-2 py-1 text-right font-semibold">Kalshi</th>
              <th className="py-1 pl-2 text-right font-semibold">Poll avg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-ops-border/50">
                <td className="py-1 pr-2 text-ops-text">{r.name}</td>
                <td className="px-2 py-1 text-right tabular-nums">{pct(r.polymarket)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{pct(r.kalshi)}</td>
                <td className="py-1 pl-2 text-right tabular-nums">{pct(r.poll)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="py-2 text-ops-muted">
                  No data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-ops-muted">
        <SourceTag kind="market" />
        {nom.error ? (
          <span className="text-red-400">odds failed to load</span>
        ) : nom.data && !(nom.data.sources.polymarket.ok && nom.data.sources.kalshi.ok) ? (
          <span className="text-amber-400">
            partial: {!nom.data.sources.polymarket.ok && "Polymarket down"}
            {!nom.data.sources.polymarket.ok && !nom.data.sources.kalshi.ok && ", "}
            {!nom.data.sources.kalshi.ok && "Kalshi down"}
          </span>
        ) : null}
        <SourceTag kind="polls" />
        {polls.error ? <span className="text-red-400">polls failed to load</span> : pollNote && <span>{pollNote}</span>}
      </div>
    </div>
  );
}

export default function PresidentSection() {
  return (
    <div className="mt-3 grid gap-6 md:grid-cols-2">
      {PARTY_IDS.map((p) => (
        <PartyTable key={p} party={p} />
      ))}
    </div>
  );
}
