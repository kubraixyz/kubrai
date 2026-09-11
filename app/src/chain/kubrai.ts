// Chain client shared by every screen. Read side uses Anchor's coder with a read-only
// provider; the write side only *builds* transactions — signing goes through Mobile Wallet Adapter.
import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import idl from "./idl.json";
import { APP } from "../config";

export const programId = new PublicKey(APP.programId);
export function getProgram(connection: Connection) {
  const ro = new AnchorProvider(connection, { publicKey: PublicKey.default, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any, { commitment: "confirmed" });
  return new Program(idl as Idl, ro);
}
export const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
export const marketPda = (id: number | BN) => PublicKey.findProgramAddressSync([Buffer.from("market"), new BN(id).toArrayLike(Buffer, "le", 8)], programId)[0];
export const vaultPda = (m: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("vault"), m.toBuffer()], programId)[0];
export const positionPda = (m: PublicKey, u: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("position"), m.toBuffer(), u.toBuffer()], programId)[0];

export type MarketView = {
  pubkey: PublicKey; id: number; metric: string; thresholds: number[]; nBuckets: number; openTs: number; closeTs: number; resolveAfterTs: number;
  baseline: number; pools: number[]; seed: number; status: number; outcome: number; proposedOutcome: number; proposedValue: number; proposedAt: number; positions: number; positionsOpen: number; feeCollected: number; snapshotHash: string;
};
export const NO_OUTCOME = 255;
export const STATUS = ["Open", "Proposed", "Resolved", "Voided", "Swept"] as const;
export const bucketOf = (m: MarketView, value: number) => m.thresholds.filter((t) => value >= t).length;
export const totalPool = (m: MarketView) => m.pools.reduce((a, b) => a + b, 0);
const tag = (b: number[]) => Buffer.from(b).toString("utf8").replace(/\0+$/, "");
export function toView(pubkey: PublicKey, a: any): MarketView {
  return {
    pubkey, id: a.id.toNumber(), metric: tag(a.metric), nBuckets: a.nBuckets, thresholds: a.thresholds.slice(0, a.nBuckets - 1).map((t: any) => t.toNumber()), openTs: a.openTs.toNumber(), closeTs: a.closeTs.toNumber(), resolveAfterTs: a.resolveAfterTs.toNumber(), baseline: a.baseline.toNumber(),
    pools: a.pools.slice(0, a.nBuckets).map((x: any) => x.toNumber()), seed: a.seedAmount.toNumber(), status: a.status, outcome: a.outcome, proposedOutcome: a.proposedOutcome, proposedValue: a.proposedValue.toNumber(), proposedAt: a.proposedAt.toNumber(),
    positions: a.positions, positionsOpen: a.positionsOpen, feeCollected: a.feeCollected.toNumber(), snapshotHash: Buffer.from(a.snapshotHash).toString("hex"),
  };
}
export async function fetchConfig(connection: Connection) { return (getProgram(connection).account as any).config.fetch(configPda); }
export async function fetchMarkets(connection: Connection): Promise<MarketView[]> {
  const program = getProgram(connection);
  const all = await (program.account as any).market.all([{ dataSize: (program.account as any).market.size }]);
  return all.map((x: any) => toView(x.publicKey, x.account)).sort((a: MarketView, b: MarketView) => b.id - a.id);
}
export async function fetchMarket(connection: Connection, id: number): Promise<MarketView> {
  const pk = marketPda(id); return toView(pk, await (getProgram(connection).account as any).market.fetch(pk));
}
export async function fetchPositionsByOwner(connection: Connection, u: PublicKey) {
  const program = getProgram(connection);
  const all = await (program.account as any).position.all([{ dataSize: (program.account as any).position.size }, { memcmp: { offset: 40, bytes: u.toBase58() } }]);
  return all.map((x: any) => ({ pubkey: x.publicKey as PublicKey, market: x.account.market as PublicKey, amounts: (x.account.amounts as any[]).map((a) => a.toNumber()) as number[], feeW: x.account.feeW as any[] }));
}
export function currentFeeBps(cfg: any, m: MarketView, nowSec = Math.floor(Date.now() / 1000)) {
  let fee: number = cfg.feeBps;
  if (nowSec < m.openTs + cfg.earlyBirdSecs.toNumber()) fee = Math.max(0, fee - cfg.earlyBirdDiscountBps);
  return fee;
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
  const ix = await getProgram(connection).methods.placeBet(bucket, new BN(amountBase))
    .accounts({ config: configPda, market: m.pubkey, position: positionPda(m.pubkey, user), vault: vaultPda(m.pubkey), userToken: getAssociatedTokenAddressSync(mint, user), user, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .instruction();
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
