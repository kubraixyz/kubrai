import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import idl from "../../idl/kubrai.json";
import { PROGRAM_ID, RPC_URL } from "./config";

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
  pubkey: PublicKey; id: number; metric: string; threshold: number; openTs: number; closeTs: number; resolveAfterTs: number;
  baseline: number; poolYes: number; poolNo: number; seed: number; status: number; outcome: number; proposedOutcome: number; proposedValue: number; proposedAt: number; positions: number; positionsOpen: number; feeCollected: number; snapshotHash: string;
};
export const STATUS = ["Open", "Proposed", "Resolved", "Voided", "Swept"] as const;
const tag = (b: number[]) => Buffer.from(b).toString("utf8").replace(/\0+$/, "");

export function toView(pubkey: PublicKey, a: any): MarketView {
  return {
    pubkey, id: a.id.toNumber(), metric: tag(a.metric), threshold: a.threshold.toNumber(), openTs: a.openTs.toNumber(), closeTs: a.closeTs.toNumber(), resolveAfterTs: a.resolveAfterTs.toNumber(), baseline: a.baseline.toNumber(),
    poolYes: a.poolYes.toNumber(), poolNo: a.poolNo.toNumber(), seed: a.seedAmount.toNumber(), status: a.status, outcome: a.outcome, proposedOutcome: a.proposedOutcome, proposedValue: a.proposedValue.toNumber(), proposedAt: a.proposedAt.toNumber(),
    positions: a.positions, positionsOpen: a.positionsOpen, feeCollected: a.feeCollected.toNumber(), snapshotHash: Buffer.from(a.snapshotHash).toString("hex"),
  };
}
export async function fetchConfig() { return (program.account as any).config.fetch(configPda); }
export async function fetchMarkets(): Promise<MarketView[]> {
  const all = await (program.account as any).market.all([{ dataSize: (program.account as any).market.size }]); // skip legacy-layout accounts
  return all.map((x: any) => toView(x.publicKey, x.account)).sort((a: MarketView, b: MarketView) => b.id - a.id);
}
export async function fetchMarket(id: number): Promise<MarketView> {
  const pk = marketPda(id); return toView(pk, await (program.account as any).market.fetch(pk));
}
export async function fetchPosition(m: PublicKey, u: PublicKey) {
  try { return await (program.account as any).position.fetch(positionPda(m, u)); } catch { return null; }
}

/** Fee the user would pay right now on winnings, in bps (mirrors on-chain logic). */
export function currentFeeBps(cfg: any, m: MarketView, nowSec = Math.floor(Date.now() / 1000)) {
  let fee: number = cfg.feeBps;
  if (nowSec < m.openTs + cfg.earlyBirdSecs.toNumber()) fee = Math.max(0, fee - cfg.earlyBirdDiscountBps);
  return fee;
}
/** Payout breakdown if `side` wins with current pools + this stake. Fee applies to `fromLosers` only (mirrors on-chain). */
export function impliedPayout(m: MarketView, side: "yes" | "no", stake: number, feeBps: number) {
  const win = (side === "yes" ? m.poolYes : m.poolNo) + stake, lose = side === "yes" ? m.poolNo : m.poolYes;
  const fromLosers = win ? (lose * stake) / win : 0, fromSeed = win ? (m.seed * stake) / win : 0;
  const fee = (fromLosers * feeBps) / 10000;
  return { fromLosers, fromSeed, fee, total: stake + fromLosers - fee + fromSeed };
}

export async function buildPlaceBetTx(user: PublicKey, m: MarketView, side: "yes" | "no", amountBase: number, mint: PublicKey): Promise<Transaction> {
  const ix: TransactionInstruction = await program.methods.placeBet({ [side]: {} } as any, new BN(amountBase))
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
