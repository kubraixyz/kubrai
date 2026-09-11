// Human copy for each metric id (the on-chain field is a 32-byte tag).
// Tags: <base>_day / <base>_week (cumulative: increase from the opening baseline to the closing snapshot),
//       <base>_dmed / <base>_wmed (level: median of every hourly snapshot inside the market window),
//       rev_day:<app> / rev_week:<app> (per-app store reviews, cumulative), plus a few legacy ids.
// `scale` divides the on-chain integer threshold/observed value for display.
export type SourceKind = "onchain" | "store" | "thirdparty";
export type Cadence = "day" | "week" | "other";
export const SOURCE_LABEL: Record<SourceKind, string> = { onchain: "on-chain, anyone can recompute", store: "Solana dApp Store API (first-party, off-chain), snapshot hash on-chain", thirdparty: "third-party aggregator (seekertracker.com), snapshot hash on-chain" };
export const APP_NAMES: Record<string, string> = { jupiter: "Jupiter Mobile", tokenrun: "TokenRun", mattle: "MattleFun", cherry: "Cherry Messenger", seedvault: "Seed Vault Wallet", lootgo: "LootGO", jito: "Jito", sleepagotchi: "Sleepagotchi", moonwalk: "Moonwalk", ore: "ORE" };
export type MetricInfo = { title: string; unit: string; how: string; scale?: number; source: SourceKind; cumulative?: boolean; cadence: Cadence; key?: string };
const WINDOW = { day: "today", week: "this week" } as const;
const MEDIAN_WINDOW = { dmed: "24-hour median", wmed: "7-day median" } as const;
const KEYS: Record<string, string> = { sgt: "sgt_total", skr_staked: "skr_staked", reviews: "store_reviews_total", dapps: "dapp_store_active_apps", reviewers: "reviewers_7d", skr_ids: "skr_ids_onchain", das: "das", skr_price: "skr_price_usd_e8" };
const BASES: Record<string, { noun: string; unit: string; source: SourceKind; scale?: number; cum: (w: string) => string; med: (w: string) => string; level: string }> = {
  sgt: { noun: "Seekers activated", unit: "phones", source: "onchain", level: "Seeker Genesis Tokens", cum: (w) => `Increase in the number of Seeker Genesis Tokens between the opening baseline and the closing snapshot (${w}). Read from the token group size on the Genesis Token mint GT22…99Te. One soulbound token is minted per activated Seeker, so each unit is a $500 phone.`, med: (w) => `${w} of the Genesis Token count.` },
  skr_staked: { noun: "SKR staked", unit: "SKR", source: "onchain", scale: 1_000_000, level: "SKR staked", cum: (w) => `Change in SKR held by the staking vault 8isV…ZbB8 (${w}).`, med: (w) => `${w} of hourly reads of the SKR staking vault 8isV…ZbB8, whose owner is re-verified against the staking program on every read. A median over the whole window cannot be moved by a last-minute deposit or withdrawal.` },
  reviews: { noun: "Store reviews written", unit: "reviews", source: "store", level: "dApp Store reviews", cum: (w) => `Increase in the total number of reviews across every app in the Solana dApp Store (${w}), read directly from the store API. A review can only be written from a Seeker device, one per device per app, so every review is a phone acting.`, med: (w) => `${w} of the store-wide review total.` },
  dapps: { noun: "New dApp Store listings", unit: "apps", source: "store", level: "dApp Store listings", cum: (w) => `Increase in the number of apps listed in the Solana dApp Store (${w}), counted from the store catalog and deduplicated by package name.`, med: (w) => `${w} of the number of listed apps.` },
  reviewers: { noun: "Reviewing wallets (7-day)", unit: "wallets", source: "store", level: "wallets that reviewed in the last 7 days", cum: (w) => `Change in the number of distinct wallets that wrote a store review in the trailing 7 days (${w}).`, med: (w) => `${w} of the number of distinct wallets that wrote a dApp Store review in the trailing 7 days. Reviews are device-gated, so each wallet is a phone.` },
  skr_ids: { noun: "New .skr IDs", unit: "IDs", source: "onchain", level: ".skr IDs", cum: (w) => `Increase in the number of .skr name records on-chain between the opening baseline and the closing snapshot (${w}), counted directly from the AllDomains name program.`, med: (w) => `${w} of the .skr record count.` },
  das: { noun: "Daily active Seekers", unit: "IDs", source: "thirdparty", level: "daily active Seekers", cum: (w) => `Change in daily active Seekers (${w}).`, med: (w) => `${w} of seekertracker.com/api/das (IDs with ≥1 tx in 24h). Definition belongs to a third party.` },
  skr_price: { noun: "SKR price", unit: "USD", source: "thirdparty", scale: 100_000_000, level: "SKR price", cum: (w) => `Change in the SKR/USD price (${w}).`, med: (w) => `${w} of the Jupiter SKR/USD price.` },
};
const LEGACY: Record<string, MetricInfo> = {
  skr_staked_med7: { title: "SKR staked (7-day median)", unit: "SKR", scale: 1_000_000, source: "onchain", cadence: "week", how: "Median of the 7 daily reads of the SKR staking vault 8isV…ZbB8, whose owner is re-verified against the staking program every day." },
  das_med7: { title: "Daily active Seekers (7-day median)", unit: "IDs", source: "thirdparty", cadence: "week", how: "Median of 7 daily reads of seekertracker.com/api/das (IDs with ≥1 tx in 24h). Definition belongs to a third party." },
  skr_price_close: { title: "SKR price at close", unit: "USD", scale: 100_000_000, source: "thirdparty", cadence: "other", how: "Jupiter price v3 at the closing snapshot." },
};
export function metricInfo(id: string): MetricInfo | undefined {
  if (LEGACY[id]) return LEGACY[id];
  let m = id.match(/^rev_(week|day):(.+)$/);
  if (m) { const app = APP_NAMES[m[2]] ?? m[2]; const w = WINDOW[m[1] as "day" | "week"]; return { title: `New ${app} reviews ${w}`, unit: "reviews", cumulative: true, source: "store", cadence: m[1] as Cadence, key: "rev:" + m[2], how: `Increase in ${app}'s total dApp Store reviews between the opening baseline and the closing snapshot (${w}), read directly from the Solana dApp Store API. Reviews can only be written from a Seeker device, one per device per app, so each extra review costs a phone.` }; }
  m = id.match(/^(.+)_(day|week|dmed|wmed)$/); if (!m || !BASES[m[1]]) return undefined;
  const b = BASES[m[1]], k = m[2];
  if (k === "day" || k === "week") return { title: `${b.noun} ${WINDOW[k]}`, unit: b.unit, scale: b.scale, source: b.source, cumulative: true, cadence: k, key: KEYS[m[1]], how: b.cum(WINDOW[k]) };
  const w = MEDIAN_WINDOW[k as "dmed" | "wmed"]; const cadence: Cadence = k === "dmed" ? "day" : "week";
  return { title: `${b.level[0].toUpperCase()}${b.level.slice(1)} (${w})`, unit: b.unit, scale: b.scale, source: b.source, cadence, how: b.med(w[0].toUpperCase() + w.slice(1)) };
}
export const metricLabel = (id: string) => metricInfo(id)?.title ?? id;
export const metricCadence = (id: string): Cadence => metricInfo(id)?.cadence ?? "other";
export const fmtValue = (id: string, v: number) => {
  const c = metricInfo(id); const x = c?.scale ? v / c.scale : v;
  return x.toLocaleString("en-US", { maximumFractionDigits: c?.scale && c.scale > 1_000_000 ? 4 : 0 }) + (c?.unit ? " " + c.unit : "");
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
