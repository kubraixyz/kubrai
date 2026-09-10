// Metric sources. Every fetcher returns { value, raw, source } so the snapshot
// bundle carries the evidence, not just the number.
import { Connection, PublicKey } from "@solana/web3.js";

const UA = "kubrai-snapshot/0.1 (+https://kubrai.xyz)";
const SKR_MINT = new PublicKey("SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3");
const SKR_STAKING_PROGRAM = new PublicKey("SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ");
const MAINNET = process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";

async function getJson(url, timeoutMs = 30000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: ac.signal });
    if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// --- SeekerTracker (off-chain aggregator; evidence = raw response) ---
export async function skrIdsTotal() {
  const j = await getJson("https://seekertracker.com/api/activations");
  return { value: j.totalDomains, raw: { totalDomains: j.totalDomains, todayCount: j.todayCount, thisWeekCount: j.thisWeekCount, thisMonthCount: j.thisMonthCount, last: j.data?.slice(-7) }, source: "seekertracker.com/api/activations" };
}
export async function dailyActiveSeekers() {
  const j = await getJson("https://seekertracker.com/api/das");
  return { value: j.das, raw: { das: j.das, was: j.was, mas: j.mas, totalIndexed: j.totalIndexed, updatedAt: j.updatedAt }, source: "seekertracker.com/api/das" };
}
export async function dappStoreActiveApps() {
  const j = await getJson("https://seekertracker.com/api/dappstore", 120000);
  const cats = (j.data?.explore?.units?.edges ?? []).map((u) => ({ cat: u.node.category.name, n: u.node.dApps.edges.length }));
  return { value: j.activeCount, raw: { activeCount: j.activeCount, removedCount: j.removedCount, totalApps: j.totalApps, lastSyncAt: j.lastSyncAt, byCategory: cats }, source: "seekertracker.com/api/dappstore" };
}

// --- On-chain (anyone can recompute against any RPC) ---
export async function skrSupply(conn = new Connection(MAINNET)) {
  const s = await conn.getTokenSupply(SKR_MINT);
  return { value: Number(s.value.amount), raw: s.value, source: "rpc getTokenSupply" };
}
// SKR staking vault (found 2026-09-10 via getTokenLargestAccounts: the largest SKR
// holder, owned by a PDA of the staking program). We re-verify that ownership on
// every snapshot instead of trusting the constant.
const SKR_STAKING_VAULT = new PublicKey("8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8");
export async function skrStaked(conn = new Connection(MAINNET)) {
  const parsed = await conn.getParsedAccountInfo(SKR_STAKING_VAULT);
  const info = parsed.value?.data?.parsed?.info;
  if (!info || info.mint !== SKR_MINT.toBase58()) throw new Error("staking vault is not an SKR token account");
  const owner = new PublicKey(info.owner);
  const ownerAcc = await conn.getAccountInfo(owner);
  const ownedByStaking = ownerAcc?.owner?.equals(SKR_STAKING_PROGRAM) ?? false;
  if (!ownedByStaking) throw new Error("staking vault owner is no longer the staking program");
  return { value: Number(info.tokenAmount.amount), raw: { vault: SKR_STAKING_VAULT.toBase58(), vaultOwner: owner.toBase58(), vaultOwnerProgram: ownerAcc.owner.toBase58(), amount: info.tokenAmount.amount, uiAmount: info.tokenAmount.uiAmountString }, source: "rpc getParsedAccountInfo(staking vault)" };
}
export async function skrPriceUsd() {
  const j = await getJson(`https://lite-api.jup.ag/price/v3?ids=${SKR_MINT.toBase58()}`);
  const p = j[SKR_MINT.toBase58()];
  return { value: Math.round(Number(p.usdPrice) * 1e8), raw: p, source: "jup.ag price v3 (scaled 1e8)" };
}

export const METRICS = {
  skr_ids_total: skrIdsTotal,
  das: dailyActiveSeekers,
  dapp_store_active_apps: dappStoreActiveApps,
  skr_supply: skrSupply,
  skr_staked: skrStaked,
  skr_price_usd_e8: skrPriceUsd,
};
