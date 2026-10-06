// Human copy for each metric id (the on-chain field is a 32-byte tag).
// Tags: <base>_day / <base>_week (cumulative: increase from the opening baseline to the closing snapshot),
//       <base>_dmed / <base>_wmed (level: median of every hourly snapshot inside the market window),
//       rev_day:<app> / rev_week:<app> (per-app store reviews, cumulative), plus a few legacy ids.
// `scale` divides the on-chain integer threshold/observed value for display.
import { t } from "./i18n";
import { fmtRange, fmtRangeHtml, fmtWait } from "./time";
export type SourceKind = "onchain" | "store" | "thirdparty";
export type Cadence = "day" | "week" | "other";
export const SOURCE_LABEL: Record<SourceKind, string> = { onchain: t("srcl.onchain"), store: t("srcl.store"), thirdparty: t("srcl.thirdparty") };
/** The source line of a market page names the third party. The broad kind alone printed "third-party aggregator
 *  (seekertracker.com)" on every DefiLlama and Jupiter-price market until 2026-10-03. `kind` is the catalog's reader. */
const sourceLabelOf = (source: SourceKind, kind?: string) => (kind?.startsWith("defillama") ? t("srcl.defillama") : kind === "jup_price" ? t("srcl.jupprice") : SOURCE_LABEL[source]);
export const APP_NAMES: Record<string, string> = { jupiter: "Jupiter Mobile", tokenrun: "TokenRun", mattle: "MattleFun", cherry: "Cherry Messenger", seedvault: "Seed Vault Wallet", lootgo: "LootGO", jito: "Jito", sleepagotchi: "Sleepagotchi", moonwalk: "Moonwalk", ore: "ORE" };
export type MetricInfo = { title: string; unit: string; rangeUnit?: string; how: string; scale?: number; digits?: number; source: SourceKind; sourceLabel?: string; cumulative?: boolean; cadence: Cadence; key?: string };
const WINDOW = { day: t("win.day"), week: t("win.week") };
const MEDIAN_WINDOW = { dmed: t("win.dmed"), wmed: t("win.wmed") };
const KEYS: Record<string, string> = { sgt: "sgt_total", skr_staked: "skr_staked", reviews: "store_reviews_total", dapps: "dapp_store_active_apps", reviewers: "reviewers_7d", skr_ids: "skr_ids_onchain", das: "das", skr_price: "skr_price_usd_e8", ore_sol: "ore_deployed_cum", ore_hits: "ore_motherlode_cum", ore_cost: "ore_cost_ema" };
const BASES: Record<string, { noun: string; unit: string; source: SourceKind; scale?: number; digits?: number; cum: (w: string) => string; med: (w: string) => string; level: string }> = {
  sgt: { noun: t("m.sgt.noun"), unit: t("m.sgt.unit"), source: "onchain", level: t("m.sgt.level"), cum: (w) => t("m.sgt.cum", { w }), med: (w) => t("m.sgt.med", { w }) },
  skr_staked: { noun: t("m.skr_staked.noun"), unit: t("m.skr_staked.unit"), source: "onchain", scale: 1_000_000, level: t("m.skr_staked.level"), cum: (w) => t("m.skr_staked.cum", { w }), med: (w) => t("m.skr_staked.med", { w }) },
  reviews: { noun: t("m.reviews.noun"), unit: t("m.reviews.unit"), source: "store", level: t("m.reviews.level"), cum: (w) => t("m.reviews.cum", { w }), med: (w) => t("m.reviews.med", { w }) },
  dapps: { noun: t("m.dapps.noun"), unit: t("m.dapps.unit"), source: "store", level: t("m.dapps.level"), cum: (w) => t("m.dapps.cum", { w }), med: (w) => t("m.dapps.med", { w }) },
  reviewers: { noun: t("m.reviewers.noun"), unit: t("m.reviewers.unit"), source: "store", level: t("m.reviewers.level"), cum: (w) => t("m.reviewers.cum", { w }), med: (w) => t("m.reviewers.med", { w }) },
  skr_ids: { noun: t("m.skr_ids.noun"), unit: t("m.skr_ids.unit"), source: "onchain", level: t("m.skr_ids.level"), cum: (w) => t("m.skr_ids.cum", { w }), med: (w) => t("m.skr_ids.med", { w }) },
  das: { noun: t("m.das.noun"), unit: t("m.das.unit"), source: "thirdparty", level: t("m.das.level"), cum: (w) => t("m.das.cum", { w }), med: (w) => t("m.das.med", { w }) },
  skr_price: { noun: t("m.skr_price.noun"), unit: t("m.skr_price.unit"), source: "thirdparty", scale: 100_000_000, level: t("m.skr_price.level"), cum: (w) => t("m.skr_price.cum", { w }), med: (w) => t("m.skr_price.med", { w }) },
  // ORE: the mining game on Solana mainnet (program oreV3…LvWv). Miners deploy SOL on a 5×5 board every ~60 s round;
  // one square wins 1 ORE, losing squares get 89% of their SOL back. Every number below is read from ORE's own accounts.
  ore_sol: { noun: t("m.ore_sol.noun"), unit: t("m.ore_sol.unit"), source: "onchain", scale: 1_000_000_000, digits: 0, level: t("m.ore_sol.level"), cum: (w) => t("m.ore_sol.cum", { w }), med: (w) => t("m.ore_sol.med", { w }) },
  ore_hits: { noun: t("m.ore_hits.noun"), unit: t("m.ore_hits.unit"), source: "onchain", digits: 0, level: t("m.ore_hits.level"), cum: (w) => t("m.ore_hits.cum", { w }), med: (w) => t("m.ore_hits.med", { w }) },
  ore_cost: { noun: t("m.ore_cost.noun"), unit: t("m.ore_cost.unit"), source: "onchain", scale: 1_000_000_000, digits: 4, level: t("m.ore_cost.level"), cum: (w) => t("m.ore_cost.cum", { w }), med: (w) => t("m.ore_cost.med", { w }) },
};
const LEGACY: Record<string, MetricInfo> = {
  skr_staked_med7: { title: t("m.skr_staked_med7.title"), unit: t("u.SKR"), scale: 1_000_000, source: "onchain", cadence: "week", how: t("m.skr_staked_med7.how") },
  das_med7: { title: t("m.das_med7.title"), unit: t("u.IDs"), source: "thirdparty", cadence: "week", how: t("m.das_med7.how") },
  skr_price_close: { title: t("m.skr_price_close.title"), unit: t("u.USD"), scale: 100_000_000, source: "thirdparty", sourceLabel: t("srcl.jupprice"), cadence: "other", how: t("m.skr_price_close.how") },
};
// Per-app metrics are configured on the server (server/app-metrics.json) and described by /metrics; the page gets that
// catalog embedded (window.__BOOT__.metricCatalog). Unknown ids resolve through it, so a new app market needs no web build.
type CatalogEntry = { id: string; category?: string; kind?: string; readAfterHours?: number; lagDays?: number; app: string; noun: string; level: string; unit: string; scale: number; digits: number; source: SourceKind; how: string; pushCost?: string | null };
const catalog: Record<string, CatalogEntry> = ((globalThis as any).__BOOT__?.metricCatalog as Record<string, CatalogEntry>) ?? {};
export const catalogEntry = (id: string) => catalog[id];
/** How long after its day ends a DefiLlama market's number is read, in seconds. It is the market's own: the gap
 *  between the end of the counted day and its on-chain resolve_after (2–3 days for markets opened up to 2026-10-02,
 *  6–48 hours since). Without a market it is what the catalog says a market opened now would get. */
const dailyWait = (c: CatalogEntry, dayEnd?: number, resolveAfterTs?: number) => (dayEnd && resolveAfterTs && resolveAfterTs >= dayEnd ? resolveAfterTs - dayEnd : (c.readAfterHours ?? (c.lagDays ?? 2) * 24) * 3600);
/** closeTs (when known) lets a "tomorrow" market name its day as the viewer's own clock shows it, not as a UTC date;
 *  with resolveAfterTs as well, a daily-source market states its own wait. */
// "Jupiter: Jupiter swap volume" named the app twice: a noun that already begins with the app's name stands alone.
const appTitle = (app: string, noun: string) => (noun.toLowerCase().startsWith(app.toLowerCase()) ? noun : t("m.nextTitle", { app, noun }));
// A range market's question is the only place its unit can go: the ranges themselves are bare numbers ("< 443,845,076" of what?).
const rangeUnitTag = (m: { metric: string; closeTs: number }) => { const u = metricInfo(m.metric, m.closeTs)?.rangeUnit; return u ? ` (${u})` : ""; };
export function metricInfo(id: string, closeTs?: number, resolveAfterTs?: number): MetricInfo | undefined {
  if (LEGACY[id]) return LEGACY[id];
  const td = id.match(/^(.+)_today$/);
  if (td && catalog[td[1]]) { const c = catalog[td[1]]; return { title: appTitle(c.app, c.noun), unit: c.unit, rangeUnit: c.unit, scale: c.scale, digits: c.digits, source: c.source, sourceLabel: sourceLabelOf(c.source, c.kind), cadence: "day", key: c.id, how: `${c.how} ${t("m.todayHow", { wait: fmtWait(dailyWait(c, closeTs && closeTs % 86400 === 12 * 3600 ? closeTs + 12 * 3600 : undefined, resolveAfterTs)) })}${c.pushCost ? ` ${t("m.pushCost", { cost: c.pushCost })}` : ""}` }; }
  const nx = id.match(/^(.+)_next$/);   // retired 2026-09-27 (the day after close); kept for the markets opened before
  if (nx && catalog[nx[1]]) { const c = catalog[nx[1]]; return { title: appTitle(c.app, c.noun), unit: c.unit, rangeUnit: c.unit, scale: c.scale, digits: c.digits, source: c.source, sourceLabel: sourceLabelOf(c.source, c.kind), cadence: "day", key: c.id, how: `${c.how} ${t("m.nextHow", { lag: Math.round(dailyWait(c, closeTs ? closeTs + 86400 : undefined, resolveAfterTs) / 86400), window: closeTs ? fmtRange(closeTs, closeTs + 86400) : t("m.nextWindowGeneric") })}${c.pushCost ? ` ${t("m.pushCost", { cost: c.pushCost })}` : ""}` }; }
  const cm = id.match(/^(.+)_(day|week|dmed|wmed)$/);
  if (cm && catalog[cm[1]]) {
    const c = catalog[cm[1]], k = cm[2];
    if (k === "day" || k === "week") return { title: t("m.cumTitle", { noun: t("m.appChange", { noun: c.noun }), w: WINDOW[k] }), unit: c.unit, scale: c.scale, digits: c.digits, source: c.source, sourceLabel: sourceLabelOf(c.source, c.kind), cumulative: true, cadence: k, key: c.id, how: `${c.how} ${t("m.appCumHow", { w: WINDOW[k] })}${c.pushCost ? ` ${t("m.pushCost", { cost: c.pushCost })}` : ""}` };
    const w = MEDIAN_WINDOW[k as "dmed" | "wmed"];
    return { title: t("m.medTitle", { level: c.level.includes(c.app) ? c.level : `${c.app} · ${c.level}`, w }), unit: c.unit, scale: c.scale, digits: c.digits, source: c.source, sourceLabel: sourceLabelOf(c.source, c.kind), cadence: k === "dmed" ? "day" : "week", key: c.id, how: `${c.how} ${t("m.appMedHow", { w })}${c.pushCost ? ` ${t("m.pushCost", { cost: c.pushCost })}` : ""}` };
  }
  let m = id.match(/^rev_(week|day):(.+)$/);
  if (m) { const app = APP_NAMES[m[2]] ?? m[2]; const w = WINDOW[m[1] as "day" | "week"]; return { title: t("m.rev.title", { app, w }), unit: t("u.reviews"), cumulative: true, source: "store", cadence: m[1] as Cadence, key: "rev:" + m[2], how: t("m.rev.how", { app, w }) }; }
  m = id.match(/^(.+)_(day|week|dmed|wmed)$/); if (!m || !BASES[m[1]]) return undefined;
  const b = BASES[m[1]], k = m[2];
  const sourceLabel = m[1] === "skr_price" ? t("srcl.jupprice") : undefined;   // the one built-in number that is a Jupiter quote
  if (k === "day" || k === "week") return { title: t("m.cumTitle", { noun: b.noun, w: WINDOW[k] }), unit: b.unit, scale: b.scale, digits: b.digits, source: b.source, sourceLabel, cumulative: true, cadence: k, key: KEYS[m[1]], how: b.cum(WINDOW[k]) };
  const w = MEDIAN_WINDOW[k as "dmed" | "wmed"]; const cadence: Cadence = k === "dmed" ? "day" : "week";
  return { title: t("m.medTitle", { level: b.level[0].toUpperCase() + b.level.slice(1), w }), unit: b.unit, scale: b.scale, digits: b.digits, source: b.source, sourceLabel, cadence, how: b.med(w[0].toUpperCase() + w.slice(1)) };
}
/** The period whose number decides the market (mirrors server/history.mjs countedWindow):
 *  betting closes at 12:00 UTC (the schedule since 2026-09-26) → the whole UTC day it closes in; an older "_next" market →
 *  the 24 hours after close; any other older market → the betting window itself. */
export const countedWindow = (m: { metric: string; openTs: number; closeTs: number }): [number, number] => {
  if (m.closeTs % 86400 === 12 * 3600) { const d = m.closeTs - 12 * 3600; return [d, d + 86400]; }
  return /_next$/.test(m.metric) ? [m.closeTs, m.closeTs + 86400] : [m.openTs, m.closeTs];
};
/** A metric's title without its "today" / "this week": for wherever the period is written out beside it. */
export const bareTitle = (m: { metric: string; closeTs: number }) => (metricInfo(m.metric, m.closeTs)?.title ?? t("m.unknown")).split(WINDOW.day).join("").split(WINDOW.week).join("").replace(/[（(]\s*[）)]/g, "").replace(/\s+/g, " ").trim();
/** The question as SharePot asks it: the period on the viewer's clock, never "today"/"tomorrow".
 *  "Jupiter swap volume, 27 Sept, 08:00 – 28 Sept, 08:00 GMT+8: which range?" (value/threshold HTML is the caller's) */
export function question(m: { metric: string; openTs: number; closeTs: number; nBuckets: number }, vHtml: string) {
  const range = fmtRangeHtml(...countedWindow(m));
  return m.nBuckets === 2 ? t("q.yesnoAt", { q: bareTitle(m), range, v: vHtml }) : t("q.rangeAt", { q: bareTitle(m) + rangeUnitTag(m), range });
}
export const metricLabel = (id: string) => metricInfo(id)?.title ?? t("m.unknown");
export const metricCadence = (id: string): Cadence => metricInfo(id)?.cadence ?? "other";
/** Store-style category of a market: per-app metrics carry one in the catalog; the built-in ones are Seeker / Store / ORE. */
export function metricCategory(id: string): string {
  const base = id.replace(/_(next|today|day|week|dmed|wmed|med7)$/, "");
  if (catalog[base]?.category) return catalog[base].category!;
  if (/^ore_/.test(base)) return "ORE";
  if (/^(dapps|reviews|reviewers|rev)/.test(base)) return "Store";
  return "Seeker";
}
/** Ranges fixed by hand instead of cut from the metric's history (server/market-templates.json "auto": false): ORE
 *  motherlode hits, whose natural steps are none / one / two or more. The market page says so instead of "quantiles". */
export const rangesFixed = (metric: string) => /^ore_hits_/.test(metric);
export const CATEGORY_ORDER = ["Seeker", "DeFi", "Trading", "DEX", "Lending", "Staking", "Wallets", "Launchpads", "Tools", "ORE", "Chain", "DePIN", "Memes", "Store", "Other"];
/** Decimals the pages print for a metric: `digits` when set, else 4 for prices and lamport-scaled numbers (scale > 1e6), else none. */
export const displayDigits = (id: string) => { const c = metricInfo(id); return c?.digits ?? (c?.scale && c.scale > 1_000_000 ? 4 : 0); };
/** A range edge exactly as the program compares it: the on-chain integer over `scale` with every decimal kept (trailing
 *  zeros dropped) and no rounding at all — the program does not round, so a label must not either (2026-09-29: #139 had
 *  82.71735795 on-chain and "≥ 82.72" on the page; a reading of 82.7150 would have shown as "82.72 → No · < 82.72"). */
export function fmtExact(id: string, v: number) {
  const c = metricInfo(id); const scale = c?.scale ?? 1; const dec = Math.max(0, Math.round(Math.log10(scale)));
  const neg = v < 0; let s = String(Math.round(Math.abs(v))).padStart(dec + 1, "0");
  const cut = s.length - dec; let int = s.slice(0, cut); const frac = dec ? s.slice(cut).replace(/0+$/, "") : "";
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + int + (frac ? "." + frac : "") + (c?.unit ? " " + c.unit : "");
}
/** A reading, rounded for display — unless rounding would put it on the other side of one of `edges` (the market's
 *  thresholds) than the program sees it; then it is printed exactly, so "observed X → range" never contradicts itself. */
export const fmtValue = (id: string, v: number, edges?: number[]) => {
  const c = metricInfo(id); const scale = c?.scale ?? 1; const d = displayDigits(id);
  if (edges?.length) { const unit = scale / 10 ** d; const r = Math.round(v / unit) * unit; if (edges.some((t) => (v >= t) !== (r >= t))) return fmtExact(id, v); }
  return (v / scale).toLocaleString("en-US", { maximumFractionDigits: d }) + (c?.unit ? " " + c.unit : "");
};
/** Opening value of a cumulative market. Markets opened since 2026-09-12 carry baseline 0 on-chain: the value is the
 *  T00 snapshot of the opening day (taken right after the hour), fetched from the public API. Returns null until that snapshot exists. */
export async function openingValue(apiBase: string, id: string, openTs: number, onchainBaseline: number): Promise<number | null> {
  if (onchainBaseline !== 0) return onchainBaseline;
  const key = metricInfo(id)?.key; if (!key) return null;
  const slot = new Date(openTs * 1000).toISOString().slice(0, 13);
  try {
    const r = await fetch(`${apiBase}/snapshots/${slot}`); if (!r.ok) return null;
    const b = (await r.json()).bundle;
    const v = key.startsWith("rev:") ? b?.metrics?.dapp_reviews?.raw?.[key.slice(4)]?.reviews : b?.metrics?.[key]?.value;
    return typeof v === "number" ? v : null;
  } catch { return null; }
}
