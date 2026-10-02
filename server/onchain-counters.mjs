// Two numbers read straight from mainnet accounts, kept as running totals so that a day is close − open like any
// other counter (history.mjs "cum"; the ORE totals in metrics.mjs work the same way). Both exist to replace a number
// we take from DefiLlama and cannot recompute ourselves; until they have run beside it for some days they are
// collected only (app-metrics.json "soft": true: no market, and a failed read pages nobody).
//
//   jito_tip_accounts   SOL arriving in Jito's per-validator TipDistributionAccounts, in lamports
//   jup_perps_pool      fees realised into the Jupiter Perps (JLP) pool, in micro-USD
//
// Each reading continues from the newest earlier bundle in the snapshot directory (its value and raw), so the bundle
// itself is the state: no side file, and the evidence for "how much was added this hour" sits next to the total.
import fs from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const snapDir = () => process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots");
/** The newest bundle before this run's slot that carries metric `id`: { slot, value, raw }, or null on a first run. */
export function latestEarlier(id, dir = snapDir(), cur = process.env.SNAPSHOT_SLOT ?? new Date().toISOString().slice(0, 13)) {
  if (!fs.existsSync(dir)) return null;
  const slots = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}T\d{2}\.json$/.test(f)).map((f) => f.slice(0, 13)).filter((s) => s < cur).sort().reverse();
  for (const s of slots) {
    try { const m = JSON.parse(fs.readFileSync(path.join(dir, s + ".json"), "utf8")).metrics?.[id]; if (m && typeof m.value === "number" && m.raw) return { slot: s, value: m.value, raw: m.raw }; } catch {}
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Jito: every validator running Jito has one TipDistributionAccount per epoch (program 4R3g…2r7, 168 bytes). Tips
// paid in a leader's slots are swept into it; when the epoch is over a merkle root is uploaded and stakers claim.
//   bytes 72..     merkle_root: Option<{ root 32, max_total_claim u64, max_num_nodes u64, total_funds_claimed u64, num_nodes_claimed u64 }>
//   then           epoch_created_at u64  → at 73 while the option is None (the epoch is running or just over),
//                                          at 137 once the root is uploaded
// An epoch's total = what its open accounts hold above rent + max_total_claim of its closed ones. For a finished epoch
// the sum of max_total_claim is the figure Jito publishes (checked 2026-10-02, epoch 1046: 2,556.776680859 SOL on both
// sides). Validators can also deposit other income for their stakers into these accounts, so this is "SOL paid out
// through Jito tip distribution", not tips alone: on 2026-10-02 it grew about a third faster than Jito's own daily
// tips figure. That gap is what the collection period is for.
export const TIP_DISTRIBUTION_PROGRAM = new PublicKey("4R3gSG8BpU4t19KYj8CfnbtRpnT8gtk4dvTHxVRwc2r7");
const TDA_SIZE = 168, MAX_EPOCH_GAP = 4;
const epochBytes = (e) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(e)); return bs58.encode(b); };

/** One epoch's accounts: { open: { n, lamports, net }, closed: { n, maxTotalClaim, claimed, lamports }, total }.
 *  Each of the two scans walks every account of the program (about 13 s on our RPC), so the running epoch, whose
 *  accounts cannot have a root yet, is read with withClosed = false. */
export async function tipEpoch(conn, epoch, rent, withClosed = true) {
  const open = await conn.getProgramAccounts(TIP_DISTRIBUTION_PROGRAM, { filters: [{ dataSize: TDA_SIZE }, { memcmp: { offset: 73, bytes: epochBytes(epoch) } }], dataSlice: { offset: 72, length: 1 } });
  const closed = withClosed ? await conn.getProgramAccounts(TIP_DISTRIBUTION_PROGRAM, { filters: [{ dataSize: TDA_SIZE }, { memcmp: { offset: 137, bytes: epochBytes(epoch) } }], dataSlice: { offset: 72, length: 65 } }) : [];
  // the same 8 bytes can sit at 73 in an account whose option is Some (they would be part of its root): only tag 0 is open
  const o = open.filter((a) => a.account.data[0] === 0), c = closed.filter((a) => a.account.data[0] === 1);
  const openLamports = o.reduce((s, a) => s + a.account.lamports, 0);
  let maxTotalClaim = 0, claimed = 0; for (const a of c) { maxTotalClaim += Number(a.account.data.readBigUInt64LE(33)); claimed += Number(a.account.data.readBigUInt64LE(49)); }
  const net = openLamports - rent * o.length;
  return { open: { n: o.length, lamports: openLamports, net }, closed: { n: c.length, maxTotalClaim, claimed, lamports: c.reduce((s, a) => s + a.account.lamports, 0) }, total: net + maxTotalClaim };
}

/** The running total after one more reading. prev = { value, raw: { epoch, epochLamports } } or null;
 *  now = { epoch, epochLamports, finals: { <epoch>: total } for every epoch from prev's up to the one before now's }. */
export function advanceTips(prev, now) {
  if (!prev) return { value: 0, added: 0, note: "first reading: the running total starts at 0 here" };
  const pe = prev.raw.epoch, pl = prev.raw.epochLamports;
  if (now.epoch < pe) throw new Error(`epoch went backwards (${pe} → ${now.epoch})`);
  if (now.epoch === pe) {
    const d = now.epochLamports - pl;   // accounts only fill up inside an epoch; a drop would mean closed accounts, not negative tips
    return { value: prev.value + Math.max(0, d), added: Math.max(0, d), ...(d < 0 ? { note: `epoch total fell by ${-d} lamports; counted as 0` } : {}) };
  }
  if (now.epoch - pe > MAX_EPOCH_GAP) throw new Error(`${now.epoch - pe} epochs since the last reading (epoch ${pe}): refusing to guess what was missed`);
  let added = 0;
  for (let e = pe; e < now.epoch; e++) {
    const f = now.finals?.[e]; if (typeof f !== "number") throw new Error(`no total for finished epoch ${e}`);
    added += e === pe ? Math.max(0, f - pl) : f;
  }
  added += now.epochLamports;
  return { value: prev.value + added, added };
}

export const jitoTipAccounts = (m, conn) => async () => {
  const c = conn(); const ep = await c.getEpochInfo("confirmed"); const rent = await c.getMinimumBalanceForRentExemption(TDA_SIZE);
  const prev = latestEarlier(m.id);
  const cur = await tipEpoch(c, ep.epoch, rent, false); const finals = {}, before = {};
  // The epoch before is read until every one of its accounts has its root (how long they stay open, and what the
  // roots add up to, is part of what we are here to learn); after that its total cannot change and the previous
  // bundle's reading is carried over. Older epochs only when runs were missed across more than one boundary.
  const last = prev?.raw?.epoch ?? ep.epoch - 1;
  const from = ep.epoch - last > MAX_EPOCH_GAP ? ep.epoch - 1 : Math.min(ep.epoch - 1, last);   // past the gap limit advanceTips refuses anyway
  for (let e = from; e < ep.epoch; e++) {
    const kept = prev?.raw?.previous?.[e];
    before[e] = kept && kept.open.n === 0 && kept.closed.n > 0 ? kept : await tipEpoch(c, e, rent);
    finals[e] = before[e].total;
  }
  const step = advanceTips(prev, { epoch: ep.epoch, epochLamports: cur.total, finals });
  let api = null;   // Jito's own daily figures, for the comparison only: never part of the value, and allowed to fail
  try { const r = await fetch("https://kobe.mainnet.jito.network/api/v1/daily_mev_rewards", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) }); if (r.ok) api = (await r.json()).slice(0, 3).map((x) => ({ day: String(x.day).slice(0, 10), validatorTips: x.validator_tips, jitoTips: x.jito_tips })); } catch {}
  return { value: step.value, raw: { epoch: ep.epoch, slotIndex: ep.slotIndex, slotsInEpoch: ep.slotsInEpoch, rentPerAccount: rent, epochLamports: cur.total, current: cur, previous: before, added: step.added, prevSlot: prev?.slot ?? null, ...(step.note ? { note: step.note } : {}), jitoApi: api }, source: `getProgramAccounts ${TIP_DISTRIBUTION_PROGRAM.toBase58()} (TipDistributionAccount per validator and epoch), running total` };
};

// ---------------------------------------------------------------------------------------------------------------
// Jupiter Perps: the JLP pool account (5BUw…Ksq) keeps poolApr.realizedFeeUsd, the fees realised into the pool since
// the weekly APR update (it restarts from 0 then; lastUpdated moves). Layout (Anchor/Borsh, variable-length head):
//   8 discriminator | name: u32 len + bytes | custodies: u32 n + n×32 | aumUsd u128 | limit 40 | fees 72 |
//   poolApr { lastUpdated i64, feeAprBps u64, realizedFeeUsd u64 } | …
// The offset of the counter moves with the number of custodies, so it is parsed, never hard-coded.
export const JLP_POOL = new PublicKey("5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq");
export function parsePerpsPool(d, nowSecs = Date.now() / 1000) {
  let o = 8; const nameLen = d.readUInt32LE(o); o += 4; if (nameLen > 64) throw new Error(`pool name length ${nameLen}: layout changed`);
  const name = d.subarray(o, o + nameLen).toString("utf8"); o += nameLen;
  const n = d.readUInt32LE(o); o += 4; if (n < 1 || n > 32) throw new Error(`pool has ${n} custodies: layout changed`);
  const custodies = []; for (let i = 0; i < n; i++) custodies.push(new PublicKey(d.subarray(o + 32 * i, o + 32 * i + 32)).toBase58()); o += 32 * n;
  const aumUsd = Number(d.readBigUInt64LE(o) + (d.readBigUInt64LE(o + 8) << 64n)); o += 16 + 40 + 72;
  const lastUpdated = Number(d.readBigInt64LE(o)), feeAprBps = Number(d.readBigUInt64LE(o + 8)), realizedFeeUsd = Number(d.readBigUInt64LE(o + 16));
  // the APR is refreshed weekly: a timestamp outside the last 30 days means these are not the fields we think they are
  if (!(lastUpdated > nowSecs - 30 * 86400 && lastUpdated < nowSecs + 86400)) throw new Error(`poolApr.lastUpdated ${lastUpdated} is not a recent time: layout changed`);
  if (!Number.isSafeInteger(realizedFeeUsd) || !Number.isSafeInteger(aumUsd)) throw new Error("pool counters beyond 2^53: layout changed");
  return { name, custodies, aumUsd, lastUpdated, feeAprBps, realizedFeeUsd };
}
/** prev = { value, raw: { lastUpdated, realizedFeeUsd } } or null; now = the parsed pool. A restart of the counter
 *  (lastUpdated moved, or the counter is lower than before) adds only what has been realised since the restart: what
 *  was realised between our last reading and the restart is not on-chain any more (at most one hour, once a week). */
export function advancePerps(prev, now) {
  if (!prev) return { value: 0, added: 0, note: "first reading: the running total starts at 0 here" };
  const restarted = now.lastUpdated !== prev.raw.lastUpdated || now.realizedFeeUsd < prev.raw.realizedFeeUsd;
  const added = restarted ? now.realizedFeeUsd : now.realizedFeeUsd - prev.raw.realizedFeeUsd;
  return { value: prev.value + added, added, ...(restarted ? { note: `counter restarted (lastUpdated ${prev.raw.lastUpdated} → ${now.lastUpdated}); the fees between the previous reading and the restart are not counted` } : {}) };
}
export const jupPerpsPool = (m, conn) => async () => {
  const c = conn(); const a = await c.getAccountInfo(JLP_POOL, "confirmed"); if (!a) throw new Error("JLP pool account not found");
  const pool = parsePerpsPool(a.data); const prev = latestEarlier(m.id); const step = advancePerps(prev, pool);
  // fees not yet swept into the counter sit in each custody (assets.feesReserves at 214, token units): kept for the comparison
  let pending = null;
  try { pending = (await c.getMultipleAccountsInfo(pool.custodies.map((k) => new PublicKey(k)))).map((x, i) => (x && x.data.length > 230 ? { custody: pool.custodies[i], mint: new PublicKey(x.data.subarray(40, 72)).toBase58(), decimals: x.data[104], feesReserves: Number(x.data.readBigUInt64LE(214)) } : null)).filter(Boolean); } catch {}
  return { value: step.value, raw: { pool: JLP_POOL.toBase58(), lastUpdated: pool.lastUpdated, realizedFeeUsd: pool.realizedFeeUsd, feeAprBps: pool.feeAprBps, aumUsd: pool.aumUsd, added: step.added, prevSlot: prev?.slot ?? null, ...(step.note ? { note: step.note } : {}), pendingByCustody: pending }, source: `account ${JLP_POOL.toBase58()} poolApr.realizedFeeUsd (micro-USD), running total` };
};
