import { TOKEN_DECIMALS } from "../config";
import { t } from "../i18n";
import { fmtExact, metricInfo, question } from "./metrics";
import { STATUS, type MarketView } from "./kubrai";
export { fmtTs, fmtTsShort, fmtRange, fmtStamp, fmtHm, fmtDay, inWords, timeLeft, zoneLabel, zoneShort } from "./time";
export { question };
export const fmtAmt = (base: number, digits = 2) => (base / 10 ** TOKEN_DECIMALS).toLocaleString("en-US", { maximumFractionDigits: digits });
export const short = (s: string) => s.slice(0, 4) + "…" + s.slice(-4);
/** Where a market stands, as the website's status pill names it and colours it (open / awaiting / proposed / voided). */
export type StatusKind = "upcoming" | "open" | "awaiting" | "proposed" | "resolved" | "voided" | "swept";
export function statusKind(m: MarketView, now = Date.now() / 1000): StatusKind {
  if (m.status === 0) return now < m.openTs ? "upcoming" : now < m.closeTs ? "open" : "awaiting";
  return STATUS[m.status].toLowerCase() as StatusKind;
}
export const statusLabel = (m: MarketView) => t("status." + statusKind(m));
/** Human label of bucket i: "< t0", "t0 – t1", "≥ tlast". Yes/no markets read "No · < t" / "Yes · ≥ t". Edges are printed
 *  exactly (fmtExact, never rounded): the program compares the on-chain integer, so must the label. A middle range of a
 *  whole-number metric ends at the last whole number inside it ("11 – 12", or "= 10" when only one number fits); a scaled
 *  one is written "A – <B". Same as the website (web/src/ui.ts). */
export function bucketLabel(m: MarketView, i: number) {
  const f = (v: number) => fmtExact(m.metric, v).replace(/ [^ ]+$/, "");
  const th = m.thresholds, n = m.nBuckets, scaled = !!metricInfo(m.metric)?.scale;
  if (n === 2) return i === 1 ? `${t("bucket.yes")} · ≥ ${f(th[0])}` : `${t("bucket.no")} · < ${f(th[0])}`;
  if (i === 0) return `< ${f(th[0])}`;
  if (i === n - 1) return `≥ ${f(th[n - 2])}`;
  if (scaled) return `${f(th[i - 1])} – <${f(th[i])}`;
  return th[i] - th[i - 1] === 1 ? `= ${f(th[i - 1])}` : `${f(th[i - 1])} – ${f(th[i] - 1)}`;
}
const COLORS = ["#c4553f", "#c98a3a", "#a3a03a", "#5f9f4a", "#0f8f7c", "#2f7fb8", "#6a5fb8", "#9a4f9a"];
/** A range's colour. Yes / No take the theme's own green and red (lighter in the dark theme), like the website's
 *  var(--yes) / var(--no); ranges run red → violet. */
export const bucketColor = (m: MarketView, i: number, dark = false) => (m.nBuckets === 2 ? (i === 1 ? (dark ? "#4fc3b2" : "#0f8f7c") : (dark ? "#d9826b" : "#c4553f")) : COLORS[Math.round((i * (COLORS.length - 1)) / Math.max(1, m.nBuckets - 1))]);
