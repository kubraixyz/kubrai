import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, Transaction, type TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import idl from "../../idl/kubrai.json";
import { API_BASE, PROGRAM_ID, RPC_URL } from "./config";

export const connection = new Connection(RPC_URL, { commitment: "confirmed", disableRetryOnRateLimit: false });

/** Confirm by polling signature status (no websocket: works behind tunnels, on mobile data, and on flaky public RPCs). */
export async function confirmBySig(sig: string, timeoutMs = 60000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = (await connection.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw new Error("Transaction failed: " + JSON.stringify(st.err));
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error("Not confirmed after " + timeoutMs / 1000 + "s. Check signature " + sig);
}
export const programId = new PublicKey(PROGRAM_ID);
const readOnlyProvider = new AnchorProvider(connection, { publicKey: PublicKey.default, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any, { commitment: "confirmed" });
export const program = new Program(idl as Idl, readOnlyProvider);

export const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
export const marketPda = (id: number | BN) => PublicKey.findProgramAddressSync([Buffer.from("market"), new BN(id).toArrayLike(Buffer, "le", 8)], programId)[0];
export const vaultPda = (m: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("vault"), m.toBuffer()], programId)[0];
export const positionPda = (m: PublicKey, u: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("position"), m.toBuffer(), u.toBuffer()], programId)[0];

export type MarketView = {
  pubkey: PublicKey; id: number; metric: string; thresholds: number[]; nBuckets: number; openTs: number; closeTs: number; resolveAfterTs: number;
  baseline: number; pools: number[]; seed: number; status: number; outcome: number; proposedOutcome: number; proposedValue: number; proposedAt: number; positions: number; positionsOpen: number; feeCollected: number; snapshotHash: string;
};
export const NO_OUTCOME = 255;
/** Same rule as on-chain Market::bucket_of. */
export const bucketOf = (m: MarketView, value: number) => m.thresholds.filter((t) => value >= t).length;
export const totalPool = (m: MarketView) => m.pools.reduce((a, b) => a + b, 0);
export const STATUS = ["Open", "Proposed", "Resolved", "Voided", "Swept"] as const;
const tag = (b: number[]) => Buffer.from(b).toString("utf8").replace(/\0+$/, "");

export function toView(pubkey: PublicKey, a: any): MarketView {
  return {
    pubkey, id: a.id.toNumber(), metric: tag(a.metric), nBuckets: a.nBuckets, thresholds: a.thresholds.slice(0, a.nBuckets - 1).map((t: any) => t.toNumber()), openTs: a.openTs.toNumber(), closeTs: a.closeTs.toNumber(), resolveAfterTs: a.resolveAfterTs.toNumber(), baseline: a.baseline.toNumber(),
    pools: a.pools.slice(0, a.nBuckets).map((x: any) => x.toNumber()), seed: a.seedAmount.toNumber(), status: a.status, outcome: a.outcome, proposedOutcome: a.proposedOutcome, proposedValue: a.proposedValue.toNumber(), proposedAt: a.proposedAt.toNumber(),
    positions: a.positions, positionsOpen: a.positionsOpen, feeCollected: a.feeCollected.toNumber(), snapshotHash: Buffer.from(a.snapshotHash).toString("hex"),
  };
}
// Reads go through the API's 15 s cache first (one small JSON instead of a getProgramAccounts round-trip on every page
// view) and fall back to the RPC. `fresh: true` forces the RPC, used right after the user's own transaction.
// The page arrives with the market list and config embedded (window.__BOOT__, written by the API when it serves the
// HTML); for the first 30 s that answers /markets and /config without a network round trip.
const boot = (globalThis as any).__BOOT__ as { at: number; markets: any[]; config: any } | undefined;
const fromApi = async (p: string) => {
  if (boot && Date.now() - boot.at < 30_000) { if (p === "/markets") return { at: boot.at, markets: boot.markets }; if (p === "/config") return { at: boot.at, config: boot.config }; const mm = p.match(/^\/markets\/(\d+)$/); if (mm) { const m = boot.markets.find((x) => x.id === Number(mm[1])); if (m) return { at: boot.at, market: m, config: boot.config }; } }
  if (!API_BASE) throw new Error("no api"); const r = await fetch(API_BASE + p); if (!r.ok) throw new Error("api " + r.status); return r.json(); };
const viewFromJson = (j: any): MarketView => ({ ...j, pubkey: new PublicKey(j.pubkey) });
const cfgFromJson = (c: any) => ({ ...c, admin: new PublicKey(c.admin), proposer: new PublicKey(c.proposer), treasury: new PublicKey(c.treasury), mint: new PublicKey(c.mint), earlyBirdSecs: new BN(c.earlyBirdSecs), disputeWindowSecs: new BN(c.disputeWindowSecs), minBet: new BN(c.minBet), marketCount: new BN(c.marketCount) });
export const feeTiersPda = PublicKey.findProgramAddressSync([Buffer.from("fee_tiers")], programId)[0];
const tiersView = (t: any) => t ? { sgtGroupMint: t.sgtGroupMint.toBase58(), sgtDiscountBps: t.sgtDiscountBps, stakeProgram: t.stakeProgram.toBase58(), stakeOwnerOffset: t.stakeOwnerOffset, stakeAmountOffset: t.stakeAmountOffset, stakeMinAmount: t.stakeMinAmount.toNumber(), stakeDiscountBps: t.stakeDiscountBps, minFeeBps: t.minFeeBps } : null;
/** Config plus the holder-discount tiers (`feeTiers`, null when the admin has not set them). */
export async function fetchConfig(opts: { fresh?: boolean } = {}) {
  if (!opts.fresh) { try { return cfgFromJson((await fromApi("/config")).config); } catch {} }
  const [c, t] = await Promise.all([(program.account as any).config.fetch(configPda), (program.account as any).feeTiers.fetchNullable(feeTiersPda).catch(() => null)]);
  return { ...c, feeTiers: tiersView(t) };
}
export async function fetchMarkets(opts: { fresh?: boolean } = {}): Promise<MarketView[]> {
  if (!opts.fresh) { try { return (await fromApi("/markets")).markets.map(viewFromJson); } catch {} }
  const all = await (program.account as any).market.all([{ dataSize: (program.account as any).market.size }]); // skip legacy-layout accounts
  return all.map((x: any) => toView(x.publicKey, x.account)).sort((a: MarketView, b: MarketView) => b.id - a.id);
}
export async function fetchMarket(id: number, opts: { fresh?: boolean } = {}): Promise<MarketView> {
  if (!opts.fresh) { try { return viewFromJson((await fromApi("/markets/" + id)).market); } catch {} }
  const pk = marketPda(id); return toView(pk, await (program.account as any).market.fetch(pk));
}
/** All open positions of a wallet (owner sits at offset 8 + 32 in Position). */
export async function fetchPositionsByOwner(u: PublicKey) {
  const all = await (program.account as any).position.all([{ dataSize: (program.account as any).position.size }, { memcmp: { offset: 40, bytes: u.toBase58() } }]);
  return all.map((x: any) => ({ pubkey: x.publicKey as PublicKey, market: x.account.market as PublicKey, amounts: (x.account.amounts as any[]).map((a) => a.toNumber()) as number[], feeW: x.account.feeW as any[] }));
}
/** Off-chain replica of the on-chain payout for a position, given the market's final (or hypothetical) outcome bucket. */
export function payoutIfBucket(m: MarketView, amounts: number[], feeBpsByBucket: number[], w: number) {
  const total = amounts.reduce((a, b) => a + b, 0);
  if (m.status === 3) return { payout: total, kind: "refund" as const };
  const winPool = m.pools[w], losePool = totalPool(m) - winPool, stake = amounts[w] ?? 0;
  if (winPool === 0) return { payout: total, kind: "refund" as const };
  if (stake === 0) return { payout: 0, kind: "lost" as const };
  const gross = (losePool * stake) / winPool, fee = (gross * (feeBpsByBucket[w] ?? 0)) / 10000, seed = (m.seed * stake) / winPool;
  return { payout: stake + gross - fee + seed, kind: "won" as const };
}
export async function fetchPosition(m: PublicKey, u: PublicKey) {
  try { return await (program.account as any).position.fetch(positionPda(m, u)); } catch { return null; }
}

/** Fee the user would pay right now on winnings, in bps (mirrors on-chain logic). */
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
/** Payout breakdown if `bucket` wins with current pools + this stake. Fee applies to `fromLosers` only (mirrors on-chain). */
export function impliedPayout(m: MarketView, bucket: number, stake: number, feeBps: number) {
  const win = m.pools[bucket] + stake, lose = totalPool(m) - m.pools[bucket];
  const fromLosers = win ? (lose * stake) / win : 0, fromSeed = win ? (m.seed * stake) / win : 0;
  const fee = (fromLosers * feeBps) / 10000;
  return { fromLosers, fromSeed, fee, total: stake + fromLosers - fee + fromSeed };
}

export async function buildPlaceBetTx(user: PublicKey, m: MarketView, bucket: number, amountBase: number, mint: PublicKey, extra: AccountMeta[] = []): Promise<Transaction> {
  const ix: TransactionInstruction = await program.methods.placeBet(bucket, new BN(amountBase)).remainingAccounts(extra)
    .accounts({ config: configPda, market: m.pubkey, position: positionPda(m.pubkey, user), vault: vaultPda(m.pubkey), userToken: getAssociatedTokenAddressSync(mint, user), user, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .instruction();
  const tx = new Transaction().add(ix);
  tx.feePayer = user;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return tx;
}
export async function buildSettleTx(cranker: PublicKey, m: MarketView, owner: PublicKey, payer: PublicKey, mint: PublicKey): Promise<Transaction> {
  const ix = await program.methods.settlePosition()
    .accounts({ market: m.pubkey, position: positionPda(m.pubkey, owner), payer, vault: vaultPda(m.pubkey), ownerToken: getAssociatedTokenAddressSync(mint, owner), cranker, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();
  const tx = new Transaction().add(ix); tx.feePayer = cranker; tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash; return tx;
}
