// Bucket design helper: thresholds = quantiles of the historical weekly values, so
// every bucket starts roughly equally likely. Usage:
//   node server/buckets.mjs <metric> [buckets=4] [weeks=12]
// History comes from our own snapshots when ≥ weeks of them exist; for skr_ids the
// SeekerTracker per-day registration history is used as a design aid only (settlement
// still uses the on-chain count).
import fs from "node:fs";
import path from "node:path";
const [metric, nb = "4", wk = "12"] = process.argv.slice(2);
const N = Number(nb), W = Number(wk);
const SNAP = process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots");
const SOURCE = { skr_ids_week: ["skr_ids_onchain", "skr_ids_total"], dapps_week: ["dapp_store_active_apps"], skr_staked_med7: ["skr_staked"] };
const dayVal = (b, m) => { if (m.startsWith("rev_week:")) return b.metrics?.dapp_reviews?.raw?.[m.slice(9)]?.reviews; for (const f of SOURCE[m] ?? []) { const v = b.metrics?.[f]?.value; if (typeof v === "number") return v; } };

let weekly = [];
const days = fs.existsSync(SNAP) ? fs.readdirSync(SNAP).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : [];
if (days.length >= 7 * W + 1) {
  const series = days.map((f) => dayVal(JSON.parse(fs.readFileSync(path.join(SNAP, f), "utf8")), metric));
  for (let i = series.length - 1; i - 7 >= 0 && weekly.length < W; i -= 7) if (series[i] != null && series[i - 7] != null) weekly.unshift(series[i] - series[i - 7]);
  console.log(`source: own snapshots (${days.length} days)`);
} else if (metric === "skr_ids_week") {
  const r = await fetch("https://seekertracker.com/api/domains?page=1&pageSize=1", { headers: { "user-agent": "kubrai-buckets/0.1" } });
  const byDate = (await r.json()).domainsByDate;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (let w = 1; w <= W; w++) { let s = 0; for (let i = 0; i < 7; i++) { const d = new Date(today.getTime() - (7 * w + i) * 864e5).toISOString().slice(0, 10); s += byDate[d] ?? 0; } weekly.unshift(s); }
  console.log("source: seekertracker per-day registrations (design aid only)");
} else {
  console.log(`not enough history for ${metric}: have ${days.length} snapshot days, need ${7 * W + 1}. Keep this market yes/no at a single threshold until then.`); process.exit(2);
}
const sorted = [...weekly].sort((a, b) => a - b);
const q = (p) => { const idx = p * (sorted.length - 1), lo = Math.floor(idx), hi = Math.ceil(idx); return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)); };
const thresholds = Array.from({ length: N - 1 }, (_, i) => q((i + 1) / N));
const counts = Array.from({ length: N }, (_, b) => weekly.filter((v) => thresholds.filter((t) => v >= t).length === b).length);
console.log(`last ${weekly.length} weekly values: ${weekly.join(", ")}`);
console.log(`min ${sorted[0]} median ${q(0.5)} max ${sorted.at(-1)}`);
console.log(`thresholds (${N} buckets): ${thresholds.join(",")}`);
console.log(`historical hits per bucket: ${counts.join(" / ")}`);
