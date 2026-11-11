import { useLayoutEffect, useRef, useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

// Measure the container ourselves (ResizeObserver) and feed recharts an explicit
// pixel width. Avoids ResponsiveContainer's flaky 0-width measurement when a chart
// mounts inside an off-screen slide-in panel or a freshly-expanded section.
function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure(); // synchronous initial measurement (post-layout, pre-paint)
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// `utc` for date-only series (polls, stamped at midnight UTC), which would
// otherwise render as the previous day in US time zones.
const fmtDate = (t, utc) =>
  new Date(t * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(utc && { timeZone: "UTC" }),
  });
const fmtTime = (t) =>
  new Date(t * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// Median of a sorted array of gaps (seconds). Odd/even-safe; Infinity on empty
// input so a 0/1-point series never looks "fine"-grained.
const median = (sorted) => {
  const n = sorted.length;
  if (!n) return Infinity;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const compactNum = (n) => {
  if (n == null) return "";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
};

// Auto-scale Y to the data: pad ~3pts beyond the min/max and snap to a multiple of
// 5 for clean ticks, clamped to [0, 100]. Keeps lines readable instead of squished.
const AUTO_DOMAIN = [
  (min) => Math.max(0, Math.floor((min - 3) / 5) * 5),
  (max) => Math.min(100, Math.ceil((max + 3) / 5) * 5),
];

// `fine` (sub-daily point spacing, see TrendChart below) adds a time-of-day
// alongside the date — otherwise a hovered 24H/7D point only shows its day,
// indistinguishable from every other point hovered that same day.
function TrendTooltip({ active, payload, label, series, volumeKey, fine, utc }) {
  if (!active || !payload?.length) return null;
  const vol = volumeKey ? payload.find((p) => p.dataKey === volumeKey) : null;
  return (
    <div className="rounded-md border border-ops-border bg-ops-panel px-3 py-2 text-xs shadow-lg tabular">
      <div className="mb-1 font-semibold text-ops-text">
        {new Date(label * 1000).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
          ...(utc && { timeZone: "UTC" }),
        })}
        {fine && ` · ${fmtTime(label)}`}
      </div>
      {payload
        .filter((p) => p.dataKey !== volumeKey)
        .map((p) => {
          const s = series.find((x) => x.key === p.dataKey);
          return (
            <div key={p.dataKey} style={{ color: p.color }}>
              {s?.label || p.dataKey}: {p.value}%
            </div>
          );
        })}
      {vol && vol.value != null && (
        <div className="text-ops-muted">Volume: {compactNum(vol.value)}</div>
      )}
    </div>
  );
}

// Generic two-series time-series chart. `data` rows are { t: unixSeconds, [key]: pct }.
// `series` is [{ key, color, label }]. With `volumeKey`, that field renders as faded
// bars on a right-hand axis. Used by odds history, macro poll history, and drawer polling.
// `utcDates` labels days in UTC, for poll series whose points are date-only.
export default function TrendChart({ data, series, volumeKey, height = 224, domain = AUTO_DOMAIN, utcDates = false }) {
  const [ref, width] = useElementWidth();

  // Derived from `data` itself (no new required prop, so every existing
  // caller — daily poll/market history — keeps working unchanged). Only the
  // sub-daily market windows (24H, and sometimes 7D) trip these.
  //   fine: median gap between consecutive points < 1 day -> tooltip adds a
  //     time-of-day, since same-day points would otherwise show identical dates.
  //   intraday: whole series spans <= 2 days -> X axis ticks show time instead
  //     of month/day, since month/day would repeat across every tick.
  // Both are guarded for 0/1-point data (no gaps to measure / no span to compare).
  const gaps =
    data && data.length > 1
      ? data
          .slice(1)
          .map((p, i) => p.t - data[i].t)
          .sort((a, b) => a - b)
      : [];
  const fine = median(gaps) < 86400;
  const intraday = Boolean(data && data.length > 1 && data[data.length - 1].t - data[0].t <= 2 * 86400);

  return (
    <div ref={ref} style={{ height }} className="w-full">
      {width > 0 && (
        <ComposedChart
          width={width}
          height={height}
          data={data}
          margin={{ top: 5, right: volumeKey ? 4 : 10, bottom: 0, left: -8 }}
        >
          <CartesianGrid stroke="#1f2738" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={intraday ? fmtTime : (t) => fmtDate(t, utcDates)}
            tick={{ fill: "#8a97ac", fontSize: 11 }}
            stroke="#1f2738"
            minTickGap={48}
          />
          <YAxis
            yAxisId="pct"
            domain={domain}
            allowDecimals={false}
            tick={{ fill: "#8a97ac", fontSize: 11 }}
            stroke="#1f2738"
            tickFormatter={(v) => `${v}%`}
            width={40}
          />
          {volumeKey && (
            <YAxis
              yAxisId="vol"
              orientation="right"
              tick={{ fill: "#5b6678", fontSize: 10 }}
              stroke="#1f2738"
              tickFormatter={compactNum}
              width={42}
            />
          )}
          <Tooltip content={<TrendTooltip series={series} volumeKey={volumeKey} fine={fine} utc={utcDates} />} />
          <Legend
            iconType="plainline"
            wrapperStyle={{ fontSize: 12, color: "#8a97ac" }}
            formatter={(v) => series.find((x) => x.key === v)?.label || v}
          />
          {/* Volume bars first so the price lines render on top. */}
          {volumeKey && (
            <Bar
              yAxisId="vol"
              dataKey={volumeKey}
              fill="#8a97ac"
              fillOpacity={0.16}
              isAnimationActive={false}
              legendType="none"
            />
          )}
          {series.map((s) => (
            <Line
              yAxisId="pct"
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              connectNulls
              legendType="plainline"
            />
          ))}
        </ComposedChart>
      )}
    </div>
  );
}
