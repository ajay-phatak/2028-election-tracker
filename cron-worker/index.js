// Scheduled driver for the KV warmer: each Cron Trigger calls the token-gated
// /api/refresh on the Pages deployment with the matching ?only= group. All the
// real work (and the 50-subrequest budget) lives in that Pages Function; this is
// just a reliable clock. See wrangler.toml for why it isn't a GitHub schedule.

// Markets every 15 min; news every 4h at :07 (sized to GNews' ~100/day quota:
// 12 states x 6 runs = ~72 — recheck whenever senate states are added).
const CRON_MARKETS = "*/15 * * * *";
const CRON_NEWS = "7 */4 * * *";

async function warm(env, only) {
  const res = await fetch(`${env.TARGET_URL.replace(/\/+$/, "")}/api/refresh?only=${only}`, {
    headers: { "X-Refresh-Token": env.REFRESH_TOKEN },
  });
  const body = await res.text();
  // Visible in `npx wrangler tail` and the dashboard's cron event log. 207 means a
  // partial refresh: logged, but not treated as a failed run.
  console.log(`warm ${only} -> ${res.status} ${body.slice(0, 2000)}`);
  if (res.status >= 400) throw new Error(`warm ${only} failed: ${res.status}`);
}

export default {
  // Awaited (not waitUntil) so a failed warm marks the cron run as failed.
  async scheduled(event, env) {
    const only = event.cron === CRON_NEWS ? "news" : event.cron === CRON_MARKETS ? "markets" : null;
    if (!only) throw new Error(`unknown cron ${event.cron}`);
    await warm(env, only);
  },
};
