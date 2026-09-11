// Bucket design helper: thresholds = quantiles of the metric's own historical window values (from hourly snapshots).
//   node server/buckets.mjs <metric> [buckets=4]
import path from "node:path";
import { windowValues, quantileThresholds } from "./history.mjs";
const [metric, nb = "4"] = process.argv.slice(2);
if (!metric) { console.error("usage: node buckets.mjs <metric> [buckets]"); process.exit(2); }
const SNAP = process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots");
const w = windowValues(metric, SNAP); const N = Number(nb);
console.log(`${w.length} historical windows for ${metric}`);
if (w.length === 0) process.exit(1);
const vals = w.map((x) => x.value); console.log(`values: ${vals.join(", ")}`);
const t = quantileThresholds(vals, N); const counts = Array.from({ length: N }, (_, b) => vals.filter((v) => t.filter((x) => v >= x).length === b).length);
console.log(`thresholds (${N} buckets): ${t.join(",")}   historical hits per bucket: ${counts.join(" / ")}`);
