// Hand-written account decoders and instruction encoders for the Kubrai program.
// Anchor's Borsh decoder trips on Hermes (missing Buffer method → "undefined is not a function"),
// so the app never touches it: everything below is DataView over the raw bytes. Layouts mirror
// idl/kubrai.json field order exactly (Borsh has no padding).
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";

export const DISC = {
  config: Uint8Array.from([155, 12, 170, 224, 30, 250, 204, 130]),
  market: Uint8Array.from([219, 190, 213, 55, 0, 227, 198, 154]),
  position: Uint8Array.from([170, 188, 143, 228, 122, 64, 247, 208]),
  placeBet: Uint8Array.from([222, 62, 67, 220, 63, 166, 126, 33]),
};
export const SIZE = { config: 174, market: 365, position: 297 };
export const discBase58 = (d: Uint8Array) => bs58.encode(d);

class Reader {
  private dv: DataView; private o: number;
  constructor(private u8: Uint8Array, offset = 8) { this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.o = offset; }
  u8() { return this.dv.getUint8(this.o++); }
  bool() { return this.u8() !== 0; }
  u16() { const v = this.dv.getUint16(this.o, true); this.o += 2; return v; }
  u32() { const v = this.dv.getUint32(this.o, true); this.o += 4; return v; }
  u64() { const lo = this.dv.getUint32(this.o, true), hi = this.dv.getUint32(this.o + 4, true); this.o += 8; return hi * 4294967296 + lo; }          // exact up to 2^53
  i64() { const lo = this.dv.getUint32(this.o, true), hi = this.dv.getInt32(this.o + 4, true); this.o += 8; return hi * 4294967296 + lo; }
  u128() { const v = this.dv.getBigUint64(this.o, true) + (this.dv.getBigUint64(this.o + 8, true) << 64n); this.o += 16; return v; }
  bytes(n: number) { const v = this.u8.subarray(this.o, this.o + n); this.o += n; return v; }
  pubkey() { return new PublicKey(this.bytes(32)); }
  get offset() { return this.o; }
}
const hasDisc = (data: Uint8Array, d: Uint8Array) => data.length >= 8 && d.every((b, i) => data[i] === b);

export type RawConfig = { admin: PublicKey; proposer: PublicKey; treasury: PublicKey; mint: PublicKey; feeBps: number; earlyBirdDiscountBps: number; earlyBirdSecs: number; disputeWindowSecs: number; minBet: number; marketCount: number; paused: boolean; bump: number };
export function decodeConfig(data: Uint8Array): RawConfig {
  if (!hasDisc(data, DISC.config)) throw new Error("not a Config account");
  const r = new Reader(data);
  return { admin: r.pubkey(), proposer: r.pubkey(), treasury: r.pubkey(), mint: r.pubkey(), feeBps: r.u16(), earlyBirdDiscountBps: r.u16(), earlyBirdSecs: r.i64(), disputeWindowSecs: r.i64(), minBet: r.u64(), marketCount: r.u64(), paused: r.bool(), bump: r.u8() };
}
export type RawMarket = { id: number; metric: string; questionHash: Uint8Array; thresholds: number[]; nBuckets: number; openTs: number; closeTs: number; resolveAfterTs: number; baseline: number; pools: number[]; seedAmount: number; status: number; outcome: number; proposedOutcome: number; proposedValue: number; proposedAt: number; snapshotHash: Uint8Array; resolvedAt: number; feeCollected: number; paidOut: number; swept: number; positions: number; positionsOpen: number; vault: PublicKey; bump: number };
export function decodeMarket(data: Uint8Array): RawMarket {
  if (!hasDisc(data, DISC.market)) throw new Error("not a Market account");
  const r = new Reader(data);
  const id = r.u64();
  const metricBytes = r.bytes(32); let end = metricBytes.indexOf(0); if (end < 0) end = 32;
  const metric = String.fromCharCode(...metricBytes.subarray(0, end));
  const questionHash = r.bytes(32);
  const thresholdsAll = Array.from({ length: 7 }, () => r.i64());
  const nBuckets = r.u8();
  const openTs = r.i64(), closeTs = r.i64(), resolveAfterTs = r.i64(), baseline = r.i64();
  const poolsAll = Array.from({ length: 8 }, () => r.u64());
  const seedAmount = r.u64(); const status = r.u8(), outcome = r.u8(), proposedOutcome = r.u8();
  const proposedValue = r.i64(), proposedAt = r.i64(); const snapshotHash = r.bytes(32); const resolvedAt = r.i64();
  const feeCollected = r.u64(), paidOut = r.u64(), swept = r.u64(); const positions = r.u32(), positionsOpen = r.u32(); const vault = r.pubkey(); const bump = r.u8();
  return { id, metric, questionHash, thresholds: thresholdsAll.slice(0, nBuckets - 1), nBuckets, openTs, closeTs, resolveAfterTs, baseline, pools: poolsAll.slice(0, nBuckets), seedAmount, status, outcome, proposedOutcome, proposedValue, proposedAt, snapshotHash, resolvedAt, feeCollected, paidOut, swept, positions, positionsOpen, vault, bump };
}
export type RawPosition = { market: PublicKey; owner: PublicKey; payer: PublicKey; amounts: number[]; feeW: bigint[]; bump: number };
export function decodePosition(data: Uint8Array): RawPosition {
  if (!hasDisc(data, DISC.position)) throw new Error("not a Position account");
  const r = new Reader(data);
  return { market: r.pubkey(), owner: r.pubkey(), payer: r.pubkey(), amounts: Array.from({ length: 8 }, () => r.u64()), feeW: Array.from({ length: 8 }, () => r.u128()), bump: r.u8() };
}

/** place_bet(bucket: u8, amount: u64) — accounts in IDL order. */
export function placeBetIx(programId: PublicKey, keys: { config: PublicKey; market: PublicKey; position: PublicKey; vault: PublicKey; userToken: PublicKey; user: PublicKey; tokenProgram: PublicKey }, bucket: number, amount: number) {
  const data = new Uint8Array(17); data.set(DISC.placeBet, 0); data[8] = bucket;
  const dv = new DataView(data.buffer); const lo = amount % 4294967296, hi = Math.floor(amount / 4294967296); dv.setUint32(9, lo, true); dv.setUint32(13, hi, true);
  return new TransactionInstruction({
    programId, data: Buffer.from(data),
    keys: [
      { pubkey: keys.config, isSigner: false, isWritable: false },
      { pubkey: keys.market, isSigner: false, isWritable: true },
      { pubkey: keys.position, isSigner: false, isWritable: true },
      { pubkey: keys.vault, isSigner: false, isWritable: true },
      { pubkey: keys.userToken, isSigner: false, isWritable: true },
      { pubkey: keys.user, isSigner: true, isWritable: true },
      { pubkey: keys.tokenProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}
