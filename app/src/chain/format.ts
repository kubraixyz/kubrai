import { TOKEN_DECIMALS } from "../config";
import { fmtValue } from "./metrics";
import type { MarketView } from "./kubrai";
export const fmtAmt = (base: number, digits = 2) => (base / 10 ** TOKEN_DECIMALS).toLocaleString("en-US", { maximumFractionDigits: digits });
export const fmtTs = (ts: number) => new Date(ts * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
export const short = (s: string) => s.slice(0, 4) + "…" + s.slice(-4);
export function timeLeft(ts: number) {
  const s = ts - Date.now() / 1000; if (s <= 0) return "closed";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}
export function bucketLabel(m: MarketView, i: number) {
  const f = (v: number) => fmtValue(m.metric, v).replace(/ [^ ]+$/, "");
  const t = m.thresholds, n = m.nBuckets;
  if (n === 2) return i === 1 ? `Yes · ≥ ${f(t[0])}` : `No · < ${f(t[0])}`;
  if (i === 0) return `< ${f(t[0])}`;
  if (i === n - 1) return `≥ ${f(t[n - 2])}`;
  return `${f(t[i - 1])} – ${f(t[i] - 1)}`;
}
const COLORS = ["#c4553f", "#c98a3a", "#a3a03a", "#5f9f4a", "#0f8f7c", "#2f7fb8", "#6a5fb8", "#9a4f9a"];
export const bucketColor = (m: MarketView, i: number) => (m.nBuckets === 2 ? (i === 1 ? "#0f8f7c" : "#c4553f") : COLORS[Math.round((i * (COLORS.length - 1)) / Math.max(1, m.nBuckets - 1))]);
export function statusLabel(m: MarketView) {
  const now = Date.now() / 1000;
  if (m.status === 0) return now < m.openTs ? "Upcoming" : now < m.closeTs ? "Open" : "Awaiting result";
  return ["Open", "Result proposed", "Resolved", "Voided", "Settled"][m.status];
}
