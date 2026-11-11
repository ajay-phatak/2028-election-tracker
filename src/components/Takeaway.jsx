// Highlighted one-line takeaway — an accent-tinted pill for the single stat a
// viewer should leave with. Wrap the key numbers in <b> to make them pop.
export default function Takeaway({ className = "", children }) {
  return (
    <p
      className={`rounded-lg border border-accent/25 bg-accent/10 px-3 py-1.5 text-xs leading-relaxed text-ops-muted [&_b]:font-semibold [&_b]:text-ops-text ${className}`}
    >
      {children}
    </p>
  );
}
