// Off-chain replica of the program's compute_payout (programs/kubrai/src/lib.rs), integer for integer, so the fee and
// payout the crank records in settlements.jsonl are the ones the PositionSettled event carries. settlement-proof.mjs
// compares the recorded fee with that event before a rebate is paid, so a replica that rounds differently would brand a
// real settlement a forgery and withhold the rebate. (2026-09-29: the old replica divided gross × fee_w by stake × 10000
// in one step; the program first floors fee_w / stake to whole basis points, then applies them. The two differ whenever
// one position holds two fee rates in the same range — an early-bird bet topped up later, a discount earned between bets.)
export const MAX_FEE_BPS = 1000n, BPS = 10000n;
const big = (x) => BigInt(typeof x === "bigint" ? x : x?.toString ? x.toString() : x);

/** m: market account (status, outcome, pools, seedAmount); p: position account (amounts, feeW), numbers, strings or BN.
 *  Returns { payout, fee, kind } in base units (bigint); kind = won | lost | refund. */
export function payoutFor(m, p) {
  const amounts = p.amounts.map(big), feeW = p.feeW.map(big);
  const total = amounts.reduce((a, b) => a + b, 0n);
  if (m.status === 3) return { payout: total, fee: 0n, kind: "refund" };                       // voided: everyone made whole
  const w = m.outcome; const pools = m.pools.map(big);
  const winPool = pools[w], losePool = pools.reduce((a, b) => a + b, 0n) - winPool, stake = amounts[w];
  if (winPool === 0n) return { payout: total, fee: 0n, kind: "refund" };                       // nobody on the winning side
  if (stake === 0n) return { payout: 0n, fee: 0n, kind: "lost" };
  const gross = (losePool * stake) / winPool;
  let bps = feeW[w] / stake; if (bps > MAX_FEE_BPS) bps = MAX_FEE_BPS;                        // lib.rs: (fee_w / stake).min(MAX_FEE_BPS)
  const fee = (gross * bps) / BPS;
  const seed = (big(m.seedAmount ?? 0) * stake) / winPool;
  return { payout: stake + gross - fee + seed, fee, kind: "won" };
}
