// Human copy for each metric id (the on-chain field is a 32-byte tag).
// Tags: <base>_day / <base>_week (cumulative: increase from the opening baseline to the closing snapshot),
//       <base>_dmed / <base>_wmed (level: median of every hourly snapshot inside the market window),
//       rev_day:<app> / rev_week:<app> (per-app store reviews, cumulative), plus a few legacy ids.
// `scale` divides the on-chain integer threshold/observed value for display.
import { t } from "./i18n";
export type SourceKind = "onchain" | "store" | "thirdparty";
export type Cadence = "day" | "week" | "other";
export const SOURCE_LABEL: Record<SourceKind, string> = { onchain: t("srcl.onchain"), store: t("srcl.store"), thirdparty: t("srcl.thirdparty") };
export const APP_NAMES: Record<string, string> = { jupiter: "Jupiter Mobile", tokenrun: "TokenRun", mattle: "MattleFun", cherry: "Cherry Messenger", seedvault: "Seed Vault Wallet", lootgo: "LootGO", jito: "Jito", sleepagotchi: "Sleepagotchi", moonwalk: "Moonwalk", ore: "ORE" };
export type MetricInfo = { title: string; unit: string; how: string; scale?: number; digits?: number; source: SourceKind; cumulative?: boolean; cadence: Cadence; key?: string };
const WINDOW = { day: t("win.day"), week: t("win.week") };
const MEDIAN_WINDOW = { dmed: t("win.dmed"), wmed: t("win.wmed") };
const KEYS: Record<string, string> = { sgt: "sgt_total", skr_staked: "skr_staked", reviews: "store_reviews_total", dapps: "dapp_store_active_apps", reviewers: "reviewers_7d", skr_ids: "skr_ids_onchain", das: "das", skr_price: "skr_price_usd_e8", ore_sol: "ore_deployed_cum", ore_hits: "ore_motherlode_cum", ore_cost: "ore_cost_ema" };
const BASES: Record<string, { noun: string; unit: string; source: SourceKind; scale?: number; digits?: number; cum: (w: string) => string; med: (w: string) => string; level: string }> = {
  sgt: { noun: t("m.sgt.noun"), unit: "phones", source: "onchain", level: t("m.sgt.level"), cum: (w) => t("m.sgt.cum", { w }), med: (w) => t("m.sgt.med", { w }) },
  skr_staked: { noun: t("m.skr_staked.noun"), unit: "SKR", source: "onchain", scale: 1_000_000, level: t("m.skr_staked.level"), cum: (w) => t("m.skr_staked.cum", { w }), med: (w) => t("m.skr_staked.med", { w }) },
  reviews: { noun: t("m.reviews.noun"), unit: "reviews", source: "store", level: t("m.reviews.level"), cum: (w) => t("m.reviews.cum", { w }), med: (w) => t("m.reviews.med", { w }) },
  dapps: { noun: t("m.dapps.noun"), unit: "apps", source: "store", level: t("m.dapps.level"), cum: (w) => t("m.dapps.cum", { w }), med: (w) => t("m.dapps.med", { w }) },
  reviewers: { noun: t("m.reviewers.noun"), unit: "wallets", source: "store", level: t("m.reviewers.level"), cum: (w) => t("m.reviewers.cum", { w }), med: (w) => t("m.reviewers.med", { w }) },
  skr_ids: { noun: t("m.skr_ids.noun"), unit: "IDs", source: "onchain", level: t("m.skr_ids.level"), cum: (w) => t("m.skr_ids.cum", { w }), med: (w) => t("m.skr_ids.med", { w }) },
  das: { noun: t("m.das.noun"), unit: "IDs", source: "thirdparty", level: t("m.das.level"), cum: (w) => t("m.das.cum", { w }), med: (w) => t("m.das.med", { w }) },
  skr_price: { noun: t("m.skr_price.noun"), unit: "USD", source: "thirdparty", scale: 100_000_000, level: t("m.skr_price.level"), cum: (w) => t("m.skr_price.cum", { w }), med: (w) => t("m.skr_price.med", { w }) },
  // ORE: the mining game on Solana mainnet (program oreV3…LvWv). Miners deploy SOL on a 5×5 board every ~60 s round;
  // one square wins 1 ORE, losing squares get 89% of their SOL back. Every number below is read from ORE's own accounts.
  ore_sol: { noun: t("m.ore_sol.noun"), unit: "SOL", source: "onchain", scale: 1_000_000_000, digits: 0, level: t("m.ore_sol.level"), cum: (w) => t("m.ore_sol.cum", { w }), med: (w) => t("m.ore_sol.med", { w }) },
  ore_hits: { noun: t("m.ore_hits.noun"), unit: "hits", source: "onchain", digits: 0, level: t("m.ore_hits.level"), cum: (w) => t("m.ore_hits.cum", { w }), med: (w) => t("m.ore_hits.med", { w }) },
  ore_cost: { noun: t("m.ore_cost.noun"), unit: "SOL/ORE", source: "onchain", scale: 1_000_000_000, digits: 4, level: t("m.ore_cost.level"), cum: (w) => t("m.ore_cost.cum", { w }), med: (w) => t("m.ore_cost.med", { w }) },
};
const LEGACY: Record<string, MetricInfo> = {
  skr_staked_med7: { title: t("m.skr_staked_med7.title"), unit: "SKR", scale: 1_000_000, source: "onchain", cadence: "week", how: t("m.skr_staked_med7.how") },
  das_med7: { title: t("m.das_med7.title"), unit: "IDs", source: "thirdparty", cadence: "week", how: t("m.das_med7.how") },
  skr_price_close: { title: t("m.skr_price_close.title"), unit: "USD", scale: 100_000_000, source: "thirdparty", cadence: "other", how: t("m.skr_price_close.how") },
};
export function metricInfo(id: string): MetricInfo | undefined {
  if (LEGACY[id]) return LEGACY[id];
  let m = id.match(/^rev_(week|day):(.+)$/);
  if (m) { const app = APP_NAMES[m[2]] ?? m[2]; const w = WINDOW[m[1] as "day" | "week"]; return { title: t("m.rev.title", { app, w }), unit: "reviews", cumulative: true, source: "store", cadence: m[1] as Cadence, key: "rev:" + m[2], how: t("m.rev.how", { app, w }) }; }
  m = id.match(/^(.+)_(day|week|dmed|wmed)$/); if (!m || !BASES[m[1]]) return undefined;
  const b = BASES[m[1]], k = m[2];
  if (k === "day" || k === "week") return { title: t("m.cumTitle", { noun: b.noun, w: WINDOW[k] }), unit: b.unit, scale: b.scale, digits: b.digits, source: b.source, cumulative: true, cadence: k, key: KEYS[m[1]], how: b.cum(WINDOW[k]) };
  const w = MEDIAN_WINDOW[k as "dmed" | "wmed"]; const cadence: Cadence = k === "dmed" ? "day" : "week";
  return { title: t("m.medTitle", { level: b.level[0].toUpperCase() + b.level.slice(1), w }), unit: b.unit, scale: b.scale, digits: b.digits, source: b.source, cadence, how: b.med(w[0].toUpperCase() + w.slice(1)) };
}
export const metricLabel = (id: string) => metricInfo(id)?.title ?? t("m.unknown");
export const metricCadence = (id: string): Cadence => metricInfo(id)?.cadence ?? "other";
export const fmtValue = (id: string, v: number) => {
  const c = metricInfo(id); const x = c?.scale ? v / c.scale : v;
  return x.toLocaleString("en-US", { maximumFractionDigits: c?.digits ?? (c?.scale && c.scale > 1_000_000 ? 4 : 0) }) + (c?.unit ? " " + c.unit : "");
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
