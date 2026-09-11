// Chain client shared by every screen. Reads decode raw account bytes (see raw.ts) and
// writes hand-encode instructions — no Anchor at runtime, which does not survive Hermes.
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { APP } from "../config";
import { DISC, SIZE, decodeConfig, decodeMarket, decodePosition, discBase58, placeBetIx, type RawConfig } from "./raw";

export const programId = new PublicKey(APP.programId);
const u64le = (n: number) => { const b = Buffer.alloc(8); b.writeUInt32LE(n % 4294967296, 0); b.writeUInt32LE(Math.floor(n / 4294967296), 4); return b; };
export const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
export const marketPda = (id: number) => PublicKey.findProgramAddressSync([Buffer.from("market"), u64le(id)], programId)[0];
export const vaultPda = (m: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("vault"), m.toBuffer()], programId)[0];
export const positionPda = (m: PublicKey, u: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("position"), m.toBuffer(), u.toBuffer()], programId)[0];
/** Config shaped like the old Anchor object where screens expect .toNumber(). */
export type ConfigView = RawConfig & { earlyBirdSecs: any; disputeWindowSecs: any; minBet: any; mint: any };
const bnLike = (n: number) => ({ toNumber: () => n, toString: () => String(n) });

export type MarketView = {
  pubkey: PublicKey; id: number; metric: string; thresholds: number[]; nBuckets: number; openTs: number; closeTs: number; resolveAfterTs: number;
  baseline: number; pools: number[]; seed: number; status: number; outcome: number; proposedOutcome: number; proposedValue: number; proposedAt: number; positions: number; positionsOpen: number; feeCollected: number; snapshotHash: string;
};
export const NO_OUTCOME = 255;
export const STATUS = ["Open", "Proposed", "Resolved", "Voided", "Swept"] as const;
export type { RawConfig };
export const bucketOf = (m: MarketView, value: number) => m.thresholds.filter((t) => value >= t).length;
export const totalPool = (m: MarketView) => m.pools.reduce((a, b) => a + b, 0);
export function toView(pubkey: PublicKey, data: Uint8Array): MarketView {
  const m = decodeMarket(data);
  return { pubkey, id: m.id, metric: m.metric, nBuckets: m.nBuckets, thresholds: m.thresholds, openTs: m.openTs, closeTs: m.closeTs, resolveAfterTs: m.resolveAfterTs, baseline: m.baseline, pools: m.pools, seed: m.seedAmount, status: m.status, outcome: m.outcome, proposedOutcome: m.proposedOutcome, proposedValue: m.proposedValue, proposedAt: m.proposedAt, positions: m.positions, positionsOpen: m.positionsOpen, feeCollected: m.feeCollected, snapshotHash: Buffer.from(m.snapshotHash).toString("hex") };
}
export async function fetchConfig(connection: Connection): Promise<ConfigView> {
  const info = await connection.getAccountInfo(configPda, "confirmed"); if (!info) throw new Error("config account not found");
  const c = decodeConfig(new Uint8Array(info.data));
  return { ...c, earlyBirdSecs: bnLike(c.earlyBirdSecs), disputeWindowSecs: bnLike(c.disputeWindowSecs), minBet: bnLike(c.minBet), mint: c.mint } as any;
}
export async function fetchMarkets(connection: Connection): Promise<MarketView[]> {
  const accts = await connection.getProgramAccounts(programId, { commitment: "confirmed", filters: [{ dataSize: SIZE.market }, { memcmp: { offset: 0, bytes: discBase58(DISC.market) } }] });
  return accts.map((a) => toView(a.pubkey, new Uint8Array(a.account.data))).sort((a, b) => b.id - a.id);
}
export async function fetchMarket(connection: Connection, id: number): Promise<MarketView> {
  const pk = marketPda(id); const info = await connection.getAccountInfo(pk, "confirmed"); if (!info) throw new Error(`market #${id} not found`);
  return toView(pk, new Uint8Array(info.data));
}
export async function fetchPositionsByOwner(connection: Connection, u: PublicKey) {
  const accts = await connection.getProgramAccounts(programId, { commitment: "confirmed", filters: [{ dataSize: SIZE.position }, { memcmp: { offset: 0, bytes: discBase58(DISC.position) } }, { memcmp: { offset: 40, bytes: u.toBase58() } }] });
  return accts.map((a) => { const p = decodePosition(new Uint8Array(a.account.data)); return { pubkey: a.pubkey, market: p.market, amounts: p.amounts, feeW: p.feeW }; });
}
export function currentFeeBps(cfg: any, m: MarketView, nowSec = Math.floor(Date.now() / 1000)) {
  let fee: number = cfg.feeBps;
  if (nowSec < earlyBirdUntil(cfg, m)) fee = Math.max(0, fee - cfg.earlyBirdDiscountBps);
  return fee;
}
/** End of the early-bird window: first quarter of the betting window, capped by config (mirrors on-chain). */
export function earlyBirdUntil(cfg: any, m: MarketView) {
  const quarter = Math.floor((m.closeTs - m.openTs) / 4);
  return m.openTs + Math.max(0, Math.min(cfg.earlyBirdSecs.toNumber(), quarter));
}
export function impliedPayout(m: MarketView, bucket: number, stake: number, feeBps: number) {
  const win = m.pools[bucket] + stake, lose = totalPool(m) - m.pools[bucket];
  const fromLosers = win ? (lose * stake) / win : 0, fromSeed = win ? (m.seed * stake) / win : 0;
  const fee = (fromLosers * feeBps) / 10000;
  return { fromLosers, fromSeed, fee, total: stake + fromLosers - fee + fromSeed };
}
export function payoutIfBucket(m: MarketView, amounts: number[], feeBpsByBucket: number[], w: number) {
  const total = amounts.reduce((a, b) => a + b, 0);
  if (m.status === 3) return { payout: total, kind: "refund" as const };
  const winPool = m.pools[w], losePool = totalPool(m) - winPool, stake = amounts[w] ?? 0;
  if (winPool === 0) return { payout: total, kind: "refund" as const };
  if (stake === 0) return { payout: 0, kind: "lost" as const };
  const gross = (losePool * stake) / winPool, fee = (gross * (feeBpsByBucket[w] ?? 0)) / 10000, seed = (m.seed * stake) / winPool;
  return { payout: stake + gross - fee + seed, kind: "won" as const };
}
export async function buildPlaceBetTx(connection: Connection, user: PublicKey, m: MarketView, bucket: number, amountBase: number, mint: PublicKey) {
  const ix = placeBetIx(programId, { config: configPda, market: m.pubkey, position: positionPda(m.pubkey, user), vault: vaultPda(m.pubkey), userToken: getAssociatedTokenAddressSync(mint, user), user, tokenProgram: TOKEN_PROGRAM_ID }, bucket, amountBase);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: user, blockhash, lastValidBlockHeight }).add(ix);
  return { tx, minContextSlot: await connection.getSlot("confirmed") };
}
export async function confirmBySig(connection: Connection, sig: string, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = (await connection.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw new Error("Transaction failed: " + JSON.stringify(st.err));
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error("Not confirmed after " + timeoutMs / 1000 + "s");
}
export async function fetchBalances(connection: Connection, owner: PublicKey, mint: PublicKey) {
  const [sol, tok] = await Promise.all([
    connection.getBalance(owner),
    connection.getTokenAccountBalance(getAssociatedTokenAddressSync(mint, owner)).then((r) => Number(r.value.amount)).catch(() => 0),
  ]);
  return { sol: sol / 1e9, token: tok };
}
