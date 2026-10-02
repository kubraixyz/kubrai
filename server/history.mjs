// Historical window values of a metric from our own snapshots, for bucket design.
//   windowValues(metric, hours, snapDir) -> [{ end: slot, value }] for every window ending at a T00 slot
// Cumulative metrics: value(end) - value(end - hours). Median metrics: median of every hourly slot in (end-hours, end].
import fs from "node:fs";
import path from "node:path";
import { APP_SLUGS } from "./metrics.mjs";
import { APP_METRICS, APP_METRIC_CATALOG, readAfterHours } from "./app-metrics.mjs";
const DAILY = Object.fromEntries(APP_METRICS.filter((m) => m.kind === "defillama_daily").map((m) => [m.id, readAfterHours(m)]));
/** DefiLlama-style daily metrics, one number per UTC day:
 *   <id>_today = the day the market is open for bets (the same 24 hours as every other daily market; from 2026-09-27)
 *   <id>_next  = the day that starts at the market close (retired: bettors found "today vs tomorrow" confusing)
 *  dailyLag: hours after that day ends at which today's config reads the number (a market keeps the one it opened with). */
export const dailyLag = (id) => DAILY[id];
/** The period a market counts, [from, to) in unix seconds. One rule for the opener, resolver, verifier, API and pages:
 *   - betting closes at 12:00 UTC (the schedule since 2026-09-26, SharePot's): the whole UTC day it closes in. Bets
 *     open 13 h before that day starts and stop halfway through it, so nobody bets with more than half the day seen;
 *   - DefiLlama "_next" markets opened before that: the UTC day that starts at close;
 *   - every other earlier market: betting open → close. */
export const DAY_LOCK_SECS = 12 * 3600, DAY_OPEN_LEAD_SECS = 13 * 3600;
export function countedWindow(spec, openTs, closeTs) {
  if (closeTs % 86400 === DAY_LOCK_SECS) { const d = closeTs - DAY_LOCK_SECS; return { from: d, to: d + 86400 }; }
  if (spec?.kind === "daily" && spec.dayFrom === "close") return { from: closeTs, to: closeTs + 86400 };
  return { from: openTs, to: closeTs };
}
/** Start (unix s) of the UTC day a daily (DefiLlama) market is about. */
export const dailyDayStart = (spec, openTs, closeTs) => countedWindow(spec, openTs, closeTs).from;
/** When a daily (DefiLlama) market's number is read, unix s. It is the market's own resolve_after: the wait is fixed
 *  on-chain when the market opens (2–3 days for markets opened up to 2026-10-02, 6–48 hours after), so changing the
 *  config never moves the hour an existing market reads. Without a market (resolveAfterTs absent or 0) it is what a
 *  market opened now would get: the end of the day plus the configured hours. */
export const dailyReadTs = (spec, openTs, closeTs, resolveAfterTs) => (resolveAfterTs > 0 ? resolveAfterTs : dailyDayStart(spec, openTs, closeTs) + 86400 + spec.lagHours * 3600);
export const seriesIn = (b, src) => b?.metrics?.[src]?.raw?.series ?? null;

export const BASE = { ...Object.fromEntries(APP_METRICS.map((m) => [m.id, m.id])), sgt: "sgt_total", skr_ids: "skr_ids_onchain", dapps: "dapp_store_active_apps", reviews: "store_reviews_total", reviewers: "reviewers_7d", skr_staked: "skr_staked", das: "das", skr_price: "skr_price_usd_e8", ore_sol: "ore_deployed_cum", ore_hits: "ore_motherlode_cum", ore_cost: "ore_cost_ema" };
const LEGACY = { skr_staked_med7: { kind: "med7", src: "skr_staked", hours: 168 }, das_med7: { kind: "med7", src: "das", hours: 168 }, skr_price_close: { kind: "close", src: "skr_price_usd_e8", hours: 0 } };
export function parseMetric(metric) {
  if (LEGACY[metric]) return LEGACY[metric];
  let m = metric.match(/^rev_(week|day):(.+)$/); if (m) return APP_SLUGS[m[2]] ? { kind: "cum", src: "rev:" + m[2], hours: m[1] === "day" ? 24 : 168 } : null;
  const n = metric.match(/^(.+)_(next|today)$/); if (n && DAILY[n[1]] != null) return { kind: "daily", src: n[1], hours: 24, lagHours: DAILY[n[1]], dayFrom: n[2] === "today" ? "open" : "close" };
  m = metric.match(/^(.+)_(day|week|dmed|wmed)$/); if (!m || !BASE[m[1]]) return null;
  return { kind: m[2] === "day" || m[2] === "week" ? "cum" : "med", src: BASE[m[1]], hours: m[2] === "day" || m[2] === "dmed" ? 24 : 168 };
}
// Parsed bundles are cached per directory: a slot file is written once and never edited (its hash is on-chain), so the
// directory's mtime — which moves when a file is added — is the whole cache key. Before this every /evidence request
// re-read and re-parsed every bundle (422 files, 24 MB, ~0.4 s of CPU each; 2026-09-29).
const slotsCache = new Map();   // dir → { stamp, slots }
export function loadSlots(dir) {
  if (!fs.existsSync(dir)) return new Map();
  const stamp = fs.statSync(dir).mtimeMs; const hit = slotsCache.get(dir); if (hit && hit.stamp === stamp) return hit.slots;
  const out = new Map();
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})(T\d{2})?\.json$/); if (!m) continue;
    try { out.set(m[1] + (m[2] ?? "T00"), JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))); } catch {}
  }
  slotsCache.set(dir, { stamp, slots: out }); return out;
}
export const valueIn = (b, src) => { if (!b) return null; if (src.startsWith("rev:")) { const v = b.metrics?.dapp_reviews?.raw?.[src.slice(4)]?.reviews; return typeof v === "number" ? v : null; } const v = b.metrics?.[src]?.value; return typeof v === "number" ? v : null; };
export const addHours = (slot, n) => new Date(Date.parse(slot + ":00:00Z") + n * 3600e3).toISOString().slice(0, 13);
export const median = (vals) => { const s = [...vals].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : Math.floor((s[s.length / 2 - 1] + s[s.length / 2]) / 2); };
export function windowValues(metric, snapDir) {
  const spec = parseMetric(metric); if (!spec) throw new Error(`unknown metric ${metric}`);
  if (spec.kind === "daily") { const slots = loadSlots(snapDir); const last = [...slots.keys()].sort().reverse().find((k) => seriesIn(slots.get(k), spec.src)); const s = last ? seriesIn(slots.get(last), spec.src) : [];
    // the last 28 complete days, without gap days (a source outage reads 0 or a sliver of a normal day)
    const days = s.slice(0, -1).slice(-28), med = median(days.map(([, v]) => v)); return days.filter(([, v]) => v > 0 && v >= med * 0.05).map(([d, v]) => ({ end: d, value: v })); }
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

/** Display precision of a metric — base units per shown unit and the decimals the pages print — mirroring
 *  web/src/metrics.ts (BASES) and the app-metric catalog. A yes/no threshold is rounded to this when the market opens, so
 *  the number on the page IS the number the program compares (2026-09-29: #139 carried 82.71735795 on-chain and the page
 *  said "≥ 82.72"; a reading of 82.7150 would have shown as "82.72 → No · < 82.72"). Metrics without a scale are whole numbers. */
const BUILTIN_DISPLAY = { skr_staked: { scale: 1e6 }, skr_price: { scale: 1e8 }, ore_sol: { scale: 1e9, digits: 0 }, ore_cost: { scale: 1e9, digits: 4 } };
export function displayUnit(metric) {
  const base = metric.replace(/_(next|today|day|week|dmed|wmed|med7|close)$/, "");
  const c = APP_METRIC_CATALOG[base] ?? BUILTIN_DISPLAY[base]; if (!c?.scale) return 1;
  const digits = c.digits ?? (c.scale > 1e6 ? 4 : 0);   // the pages' default (web/src/metrics.ts fmtValue)
  return Math.max(1, c.scale / 10 ** digits);
}
export const roundToDisplay = (metric, v) => { const u = displayUnit(metric); return Math.round(v / u) * u; };
