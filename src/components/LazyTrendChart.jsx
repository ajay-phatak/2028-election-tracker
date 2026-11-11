import { lazy, Suspense } from "react";

// Recharts is heavy; load it out of the initial bundle. The fallback reserves
// the chart's exact height so nothing shifts when it arrives.
const TrendChart = lazy(() => import("./TrendChart"));

export default function LazyTrendChart(props) {
  const height = props.height ?? 224;
  return (
    <Suspense
      fallback={<div style={{ height }} className="w-full animate-pulse rounded-lg bg-ops-panel-2/60" />}
    >
      <TrendChart {...props} />
    </Suspense>
  );
}
