// Human copy for each metric id (the on-chain field is a 32-byte tag).
// Tags: <base>_day / <base>_week (cumulative: increase from the opening baseline to the closing snapshot),
//       <base>_dmed / <base>_wmed (level: median of every hourly snapshot inside the market window),
//       rev_day:<app> / rev_week:<app> (per-app store reviews, cumulative), plus a few legacy ids.
// `scale` divides the on-chain integer threshold/observed value for display.
export type SourceKind = "onchain" | "store" | "thirdparty";
export type Cadence = "day" | "week" | "other";
export const SOURCE_LABEL: Record<SourceKind, string> = { onchain: "on-chain, anyone can recompute", store: "Solana dApp Store API (first-party, off-chain), snapshot hash on-chain", thirdparty: "third-party aggregator (seekertracker.com), snapshot hash on-chain" };
export const APP_NAMES: Record<string, string> = { jupiter: "Jupiter Mobile", tokenrun: "TokenRun", mattle: "MattleFun", cherry: "Cherry Messenger", seedvault: "Seed Vault Wallet", lootgo: "LootGO", jito: "Jito", sleepagotchi: "Sleepagotchi", moonwalk: "Moonwalk", ore: "ORE" };
export type MetricInfo = { title: string; unit: string; how: string; scale?: number; digits?: number; source: SourceKind; cumulative?: boolean; cadence: Cadence; key?: string };
const WINDOW = { day: "today", week: "this week" } as const;
const MEDIAN_WINDOW = { dmed: "24-hour median", wmed: "7-day median" } as const;
const KEYS: Record<string, string> = { sgt: "sgt_total", skr_staked: "skr_staked", reviews: "store_reviews_total", dapps: "dapp_store_active_apps", reviewers: "reviewers_7d", skr_ids: "skr_ids_onchain", das: "das", skr_price: "skr_price_usd_e8", ore_sol: "ore_deployed_cum", ore_hits: "ore_motherlode_cum", ore_cost: "ore_cost_ema" };
const BASES: Record<string, { noun: string; unit: string; source: SourceKind; scale?: number; digits?: number; cum: (w: string) => string; med: (w: string) => string; level: string }> = {
  sgt: { noun: "Seekers activated", unit: "phones", source: "onchain", level: "Seeker Genesis Tokens", cum: (w) => `Increase in the number of Seeker Genesis Tokens between the opening baseline and the closing snapshot (${w}). Read from the token group size on the Genesis Token mint GT22…99Te. One soulbound token is minted per activated Seeker, so each unit is a $500 phone.`, med: (w) => `${w} of the Genesis Token count.` },
  skr_staked: { noun: "SKR staked", unit: "SKR", source: "onchain", scale: 1_000_000, level: "SKR staked", cum: (w) => `Change in SKR held by the staking vault 8isV…ZbB8 (${w}).`, med: (w) => `${w} of hourly reads of the SKR staking vault 8isV…ZbB8, whose owner is re-verified against the staking program on every read. A median over the whole window cannot be moved by a last-minute deposit or withdrawal.` },
  reviews: { noun: "Store reviews written", unit: "reviews", source: "store", level: "dApp Store reviews", cum: (w) => `Increase in the total number of reviews across every app in the Solana dApp Store (${w}), read directly from the store API. A review can only be written from a Seeker device, one per device per app, so every review is a phone acting.`, med: (w) => `${w} of the store-wide review total.` },
  dapps: { noun: "New dApp Store listings", unit: "apps", source: "store", level: "dApp Store listings", cum: (w) => `Increase in the number of apps listed in the Solana dApp Store (${w}), counted from the store catalog and deduplicated by package name.`, med: (w) => `${w} of the number of listed apps.` },
  reviewers: { noun: "Reviewing wallets (7-day)", unit: "wallets", source: "store", level: "wallets that reviewed in the last 7 days", cum: (w) => `Change in the number of distinct wallets that wrote a store review in the trailing 7 days (${w}).`, med: (w) => `${w} of the number of distinct wallets that wrote a dApp Store review in the trailing 7 days. Reviews are device-gated, so each wallet is a phone.` },
  skr_ids: { noun: "New .skr IDs", unit: "IDs", source: "onchain", level: ".skr IDs", cum: (w) => `Increase in the number of .skr name records on-chain between the opening baseline and the closing snapshot (${w}), counted directly from the AllDomains name program.`, med: (w) => `${w} of the .skr record count.` },
  das: { noun: "Daily active Seekers", unit: "IDs", source: "thirdparty", level: "daily active Seekers", cum: (w) => `Change in daily active Seekers (${w}).`, med: (w) => `${w} of seekertracker.com/api/das (IDs with ≥1 tx in 24h). Definition belongs to a third party.` },
  skr_price: { noun: "SKR price", unit: "USD", source: "thirdparty", scale: 100_000_000, level: "SKR price", cum: (w) => `Change in the SKR/USD price (${w}).`, med: (w) => `${w} of the Jupiter SKR/USD price.` },
  // ORE: the mining game on Solana mainnet (program oreV3…LvWv). Miners deploy SOL on a 5×5 board every ~60 s round;
  // one square wins 1 ORE, losing squares get 89% of their SOL back. Every number below is read from ORE's own accounts.
  ore_sol: { noun: "SOL deployed by ORE miners", unit: "SOL", source: "onchain", scale: 1_000_000_000, digits: 0, level: "SOL deployed by ORE miners", cum: (w) => `Total SOL deployed across every ORE mining round that finished ${w}: the 25 squares of each round account of the ORE program (oreV3…LvWv), summed by our hourly snapshots as a running total, so the day's figure is close − open. Pushing this up costs real money: ORE returns only 89% of a losing square and 99% of a winning one, so every extra SOL deployed burns about 0.1 SOL.`, med: (w) => `${w} of the running total of SOL deployed in ORE rounds.` },
  ore_hits: { noun: "ORE motherlodes hit", unit: "hits", source: "onchain", digits: 0, level: "ORE motherlode hits", cum: (w) => `Number of ORE rounds that finished ${w} in which the motherlode paid out (round account field motherlode > 0). Whether a round hits is drawn from the round's on-chain randomness: nobody, not the ORE team, not us, can steer it. Recent rate: about one hit a day, and the pot (0.2 ORE added every round) grows until it hits.`, med: (w) => `${w} of the running count of motherlode hits.` },
  ore_cost: { noun: "ORE mining cost", unit: "SOL/ORE", source: "onchain", scale: 1_000_000_000, digits: 4, level: "ORE mining cost", cum: (w) => `Change in the ORE program's production-cost EMA (${w}).`, med: (w) => `${w} of hourly reads of the ORE program's production-cost EMA (board account, lamports per ORE): what miners are currently paying per ORE, smoothed by the protocol itself. A median over the whole window cannot be moved by one heavy round.` },
};
const LEGACY: Record<string, MetricInfo> = {
  skr_staked_med7: { title: "SKR staked (7-day median)", unit: "SKR", scale: 1_000_000, source: "onchain", cadence: "week", how: "Median of the 7 daily reads of the SKR staking vault 8isV…ZbB8, whose owner is re-verified against the staking program every day." },
  das_med7: { title: "Daily active Seekers (7-day median)", unit: "IDs", source: "thirdparty", cadence: "week", how: "Median of 7 daily reads of seekertracker.com/api/das (IDs with ≥1 tx in 24h). Definition belongs to a third party." },
  skr_price_close: { title: "SKR price at close", unit: "USD", scale: 100_000_000, source: "thirdparty", cadence: "other", how: "Jupiter price v3 at the closing snapshot." },
};
// Per-app metrics are configured on the server; the app loads the catalog once (loadMetricCatalog) and resolves unknown ids through it.
type CatalogEntry = { id: string; app: string; noun: string; level: string; unit: string; scale: number; digits: number; source: SourceKind; how: string; pushCost?: string | null };
let catalog: Record<string, CatalogEntry> = {};
export async function loadMetricCatalog(apiBase: string) { try { const r = await fetch(apiBase + "/metrics"); if (r.ok) catalog = (await r.json()).metrics ?? {}; } catch {} }
export function metricInfo(id: string): MetricInfo | undefined {
  if (LEGACY[id]) return LEGACY[id];
  const cm = id.match(/^(.+)_(day|week|dmed|wmed)$/);
  if (cm && catalog[cm[1]]) {
    const c = catalog[cm[1]], k = cm[2];
    if (k === "day" || k === "week") return { title: `Change in ${c.noun} ${WINDOW[k]}`, unit: c.unit, scale: c.scale, digits: c.digits, source: c.source, cumulative: true, cadence: k, key: c.id, how: `${c.how} Resolves on the change between the opening hour's snapshot and the closing hour's.${c.pushCost ? ` Cost to move it: ${c.pushCost}.` : ""}` };
    const w = MEDIAN_WINDOW[k as "dmed" | "wmed"];
    return { title: `${c.level.includes(c.app) ? c.level : `${c.app} · ${c.level}`} (${w})`, unit: c.unit, scale: c.scale, digits: c.digits, source: c.source, cadence: k === "dmed" ? "day" : "week", key: c.id, how: `${c.how} Resolves on the ${w} of every hourly reading inside the window.${c.pushCost ? ` Cost to move it: ${c.pushCost}.` : ""}` };
  }
  let m = id.match(/^rev_(week|day):(.+)$/);
  if (m) { const app = APP_NAMES[m[2]] ?? m[2]; const w = WINDOW[m[1] as "day" | "week"]; return { title: `New ${app} reviews ${w}`, unit: "reviews", cumulative: true, source: "store", cadence: m[1] as Cadence, key: "rev:" + m[2], how: `Increase in ${app}'s total dApp Store reviews between the opening baseline and the closing snapshot (${w}), read directly from the Solana dApp Store API. Reviews can only be written from a Seeker device, one per device per app, so each extra review costs a phone.` }; }
  m = id.match(/^(.+)_(day|week|dmed|wmed)$/); if (!m || !BASES[m[1]]) return undefined;
  const b = BASES[m[1]], k = m[2];
  if (k === "day" || k === "week") return { title: `${b.noun} ${WINDOW[k]}`, unit: b.unit, scale: b.scale, digits: b.digits, source: b.source, cumulative: true, cadence: k, key: KEYS[m[1]], how: b.cum(WINDOW[k]) };
  const w = MEDIAN_WINDOW[k as "dmed" | "wmed"]; const cadence: Cadence = k === "dmed" ? "day" : "week";
  return { title: `${b.level[0].toUpperCase()}${b.level.slice(1)} (${w})`, unit: b.unit, scale: b.scale, digits: b.digits, source: b.source, cadence, how: b.med(w[0].toUpperCase() + w.slice(1)) };
}
export const metricLabel = (id: string) => metricInfo(id)?.title ?? id;
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
