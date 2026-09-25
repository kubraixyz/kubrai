// Historical window values of a metric from our own snapshots, for bucket design.
//   windowValues(metric, hours, snapDir) -> [{ end: slot, value }] for every window ending at a T00 slot
// Cumulative metrics: value(end) - value(end - hours). Median metrics: median of every hourly slot in (end-hours, end].
import fs from "node:fs";
import path from "node:path";
import { APP_SLUGS } from "./metrics.mjs";
import { APP_METRICS } from "./app-metrics.mjs";
const DAILY = Object.fromEntries(APP_METRICS.filter((m) => m.kind === "defillama_daily").map((m) => [m.id, m.lagDays ?? 2]));
/** DefiLlama-style daily metrics: <id>_next = the number reported for the UTC day that starts at the market close. */
export const dailyLag = (id) => DAILY[id];
export const seriesIn = (b, src) => b?.metrics?.[src]?.raw?.series ?? null;

export const BASE = { ...Object.fromEntries(APP_METRICS.map((m) => [m.id, m.id])), sgt: "sgt_total", skr_ids: "skr_ids_onchain", dapps: "dapp_store_active_apps", reviews: "store_reviews_total", reviewers: "reviewers_7d", skr_staked: "skr_staked", das: "das", skr_price: "skr_price_usd_e8", ore_sol: "ore_deployed_cum", ore_hits: "ore_motherlode_cum", ore_cost: "ore_cost_ema" };
const LEGACY = { skr_staked_med7: { kind: "med7", src: "skr_staked", hours: 168 }, das_med7: { kind: "med7", src: "das", hours: 168 }, skr_price_close: { kind: "close", src: "skr_price_usd_e8", hours: 0 } };
export function parseMetric(metric) {
  if (LEGACY[metric]) return LEGACY[metric];
  let m = metric.match(/^rev_(week|day):(.+)$/); if (m) return APP_SLUGS[m[2]] ? { kind: "cum", src: "rev:" + m[2], hours: m[1] === "day" ? 24 : 168 } : null;
  const n = metric.match(/^(.+)_next$/); if (n && DAILY[n[1]] != null) return { kind: "daily", src: n[1], hours: 24, lagDays: DAILY[n[1]] };
  m = metric.match(/^(.+)_(day|week|dmed|wmed)$/); if (!m || !BASE[m[1]]) return null;
  return { kind: m[2] === "day" || m[2] === "week" ? "cum" : "med", src: BASE[m[1]], hours: m[2] === "day" || m[2] === "dmed" ? 24 : 168 };
}
export function loadSlots(dir) {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})(T\d{2})?\.json$/); if (!m) continue;
    try { out.set(m[1] + (m[2] ?? "T00"), JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))); } catch {}
  }
  return out;
}
export const valueIn = (b, src) => { if (!b) return null; if (src.startsWith("rev:")) { const v = b.metrics?.dapp_reviews?.raw?.[src.slice(4)]?.reviews; return typeof v === "number" ? v : null; } const v = b.metrics?.[src]?.value; return typeof v === "number" ? v : null; };
export const addHours = (slot, n) => new Date(Date.parse(slot + ":00:00Z") + n * 3600e3).toISOString().slice(0, 13);
export const median = (vals) => { const s = [...vals].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : Math.floor((s[s.length / 2 - 1] + s[s.length / 2]) / 2); };
export function windowValues(metric, snapDir) {
  const spec = parseMetric(metric); if (!spec) throw new Error(`unknown metric ${metric}`);
  if (spec.kind === "daily") { const slots = loadSlots(snapDir); const last = [...slots.keys()].sort().reverse().find((k) => seriesIn(slots.get(k), spec.src)); const s = last ? seriesIn(slots.get(last), spec.src) : []; return s.slice(0, -1).slice(-84).map(([d, v]) => ({ end: d, value: v })); }
  const slots = loadSlots(snapDir); const ends = [...slots.keys()].filter((s) => s.endsWith("T00")).sort(); const out = [];
  for (const end of ends) {
    if (spec.kind === "cum") { const a = valueIn(slots.get(addHours(end, -spec.hours)), spec.src), b = valueIn(slots.get(end), spec.src); if (a != null && b != null) out.push({ end, value: b - a }); }
    else { const vals = []; for (let i = 1; i <= spec.hours; i++) { const v = valueIn(slots.get(addHours(end, i - spec.hours)), spec.src); if (v != null) vals.push(v); } if (vals.length >= Math.ceil(spec.hours * 0.75)) out.push({ end, value: median(vals) }); }
  }
  return out;
}
export function quantileThresholds(values, buckets) {
  const s = [...values].sort((a, b) => a - b);
  const q = (p) => { const idx = p * (s.length - 1), lo = Math.floor(idx), hi = Math.ceil(idx); return Math.round(s[lo] + (s[hi] - s[lo]) * (idx - lo)); };
  const t = Array.from({ length: buckets - 1 }, (_, i) => q((i + 1) / buckets));
  for (let i = 1; i < t.length; i++) if (t[i] <= t[i - 1]) t[i] = t[i - 1] + 1;   // keep strictly increasing even when history is flat
  return t;
}
