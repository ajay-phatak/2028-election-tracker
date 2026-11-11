# election-tracker-cron

Cron-only Worker that keeps the tracker's KV cache warm by calling
`/api/refresh` on schedule (markets every 15 min, news every 4 h).

One-time setup, from this folder:

```sh
npx wrangler login
npx wrangler deploy
npx wrangler secret put REFRESH_TOKEN   # same value as the Pages REFRESH_TOKEN
```

Check that it's firing with `npx wrangler tail election-tracker-cron`, or under
Workers & Pages → election-tracker-cron → Logs in the dashboard.

KV budget: the markets warm writes ~8 keys, so 96 runs/day is ~770 of the free
tier's 1,000 writes/day. Don't also run the GitHub schedule, and don't speed the
markets cron up without moving to paid KV.

Manual warm (e.g. right after a Pages deploy) still goes through GitHub:
`gh workflow run refresh.yml -f only=markets`.
