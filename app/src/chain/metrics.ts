// Human copy for each metric id (the on-chain field is a 32-byte tag).
// `scale` divides the on-chain integer threshold/observed value for display.
export type SourceKind = "onchain" | "store" | "thirdparty";
export const SOURCE_LABEL: Record<SourceKind, string> = { onchain: "on-chain, anyone can recompute", store: "Solana dApp Store API (first-party, off-chain), snapshot hash on-chain", thirdparty: "third-party index, snapshot hash on-chain" };
export const APP_NAMES: Record<string, string> = { jupiter: "Jupiter Mobile", tokenrun: "TokenRun", mattle: "MattleFun", cherry: "Cherry Messenger", seedvault: "Seed Vault Wallet", lootgo: "LootGO", jito: "Jito", sleepagotchi: "Sleepagotchi", moonwalk: "Moonwalk Fitness", ore: "ORE" };
export const METRIC_COPY: Record<string, { title: string; unit: string; how: string; scale?: number; source: SourceKind; cumulative?: boolean }> = {
  sgt_week: { title: "Seekers activated this week", unit: "phones", cumulative: true, source: "onchain", how: "Increase in the number of Seeker Genesis Tokens between the opening baseline and the closing 00:05 UTC snapshot, read from the token group size on the Genesis Token mint GT22…99Te. One soulbound token is minted per activated Seeker device, so each unit is a $500 phone." },
  skr_ids_week: { title: "New .skr IDs this week", unit: "IDs", cumulative: true, source: "onchain", how: "Increase in the number of .skr name records on-chain between the opening baseline and the closing 00:05 UTC snapshot (counted directly from the AllDomains name program). Each ID needs a Seeker Genesis Token, i.e. a $500 device." },
  skr_staked_med7: { title: "SKR staked (7-day median)", unit: "SKR", scale: 1_000_000, source: "onchain", how: "Median of the 7 daily reads of the SKR staking vault 8isV…ZbB8, whose owner is re-verified against the staking program every day." },
  das_med7: { title: "Daily active Seekers (7-day median)", unit: "IDs", source: "thirdparty", how: "Median of 7 daily reads of seekertracker.com/api/das (IDs with ≥1 tx in 24h). Definition belongs to SeekerTracker." },
  dapps_week: { title: "New dApp Store listings this week", unit: "apps", cumulative: true, source: "store", how: "Increase in listed apps between the opening baseline and the closing snapshot, counted directly from the Solana dApp Store API across all categories (deduplicated). Listings pass Solana Mobile review, so they cannot be spammed within a week." },
  skr_price_close: { title: "SKR price at close", unit: "USD", scale: 100_000_000, source: "thirdparty", how: "Jupiter price v3 at the closing snapshot." },
};
export function metricInfo(id: string) {
  if (id.startsWith("rev_week:")) { const slug = id.slice(9); const app = APP_NAMES[slug] ?? slug; return { title: `New ${app} reviews this week`, unit: "reviews", cumulative: true, source: "store" as SourceKind, how: `Increase in ${app}'s total dApp Store reviews between the opening baseline and the closing snapshot, read directly from the Solana dApp Store API. Reviews can only be written from a Seeker device, one per device per app, so each extra review costs a phone.` }; }
  return METRIC_COPY[id];
}
export const metricLabel = (id: string) => metricInfo(id)?.title ?? id;
export const fmtValue = (id: string, v: number) => {
  const c = metricInfo(id); const x = c?.scale ? v / c.scale : v;
  return x.toLocaleString("en-US", { maximumFractionDigits: c?.scale && c.scale > 1_000_000 ? 4 : 0 }) + (c?.unit ? " " + c.unit : "");
};
