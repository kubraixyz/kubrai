// Human copy for each metric id (the on-chain field is a 32-byte tag).
// `scale` divides the on-chain integer threshold/observed value for display.
export const METRIC_COPY: Record<string, { title: string; unit: string; how: string; scale?: number }> = {
  skr_ids_week: { title: "New .skr IDs this week", unit: "IDs", how: "Weekly increase of total .skr Seeker IDs, from the daily 00:05 UTC snapshot of seekertracker.com/api/activations. Manipulation cost: one $500 device per ID." },
  skr_staked_med7: { title: "SKR staked (7-day median)", unit: "SKR", scale: 1_000_000, how: "Median of 7 daily reads of the staking vault 8isV…ZbB8, verified on-chain against the staking program." },
  das_med7: { title: "Daily active Seekers (7-day median)", unit: "IDs", how: "Median of 7 daily reads of seekertracker.com/api/das (IDs with ≥1 tx in 24h)." },
  dapps_week: { title: "New dApp Store listings this week", unit: "apps", how: "Weekly increase of active listings from the daily dApp Store catalog snapshot." },
  skr_price_close: { title: "SKR price at close", unit: "USD", scale: 100_000_000, how: "Jupiter price v3 at the closing snapshot." },
};
export const metricLabel = (id: string) => METRIC_COPY[id]?.title ?? id;
export const fmtValue = (id: string, v: number) => {
  const c = METRIC_COPY[id]; const x = c?.scale ? v / c.scale : v;
  return x.toLocaleString("en-US", { maximumFractionDigits: c?.scale && c.scale > 1_000_000 ? 4 : 0 }) + (c?.unit ? " " + c.unit : "");
};
