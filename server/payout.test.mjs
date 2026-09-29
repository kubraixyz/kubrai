// payout.mjs must match the program's compute_payout to the base unit: settlement-proof.mjs rejects a settlement row
// whose fee differs from the on-chain PositionSettled event, and the rebate for that row is then never paid.
import { test } from "node:test";
import assert from "node:assert/strict";
import { payoutFor } from "./payout.mjs";

// The program's rule, written out separately from payout.mjs so the test does not merely agree with itself.
function onchain(losePool, winPool, stake, feeW, seed = 0n) {
  const gross = (losePool * stake) / winPool; const bps = feeW / stake < 1000n ? feeW / stake : 1000n;
  const fee = (gross * bps) / 10000n; return { payout: stake + gross - fee + (seed * stake) / winPool, fee };
}
const market = (pools, outcome, status = 2, seedAmount = 0) => ({ status, outcome, pools, seedAmount });
const position = (amounts, feeW) => ({ amounts, feeW });

test("one rate per range: same as the naive formula", () => {
  const m = market(["200000000", "500000000"], 0), p = position(["100000000", "0"], ["30000000000", "0"]);   // 100 SKR @ 300 bps
  const r = payoutFor(m, p); assert.equal(r.kind, "won"); assert.equal(r.fee, 7500000n); assert.equal(r.payout, 100000000n + 250000000n - 7500000n);
});

test("two rates in one range (early-bird 100 @ 200 bps + top-up 50 @ 300 bps): floors the basis points first, like the program", () => {
  const m = market(["200000000", "500000000"], 0), p = position(["150000000", "0"], [String(100000000n * 200n + 50000000n * 300n), "0"]);
  const r = payoutFor(m, p), want = onchain(500000000n, 200000000n, 150000000n, 35000000000n);
  assert.equal(r.fee, want.fee); assert.equal(r.payout, want.payout);
  assert.equal(r.fee, 8737500n);                                       // what the chain pays; the pre-2026-09-29 replica said 8,750,000
  const naive = (375000000n * 35000000000n) / (150000000n * 10000n); assert.notEqual(r.fee, naive, "the test must be able to tell the two apart");
});

test("discount earned between bets (10 @ 100 bps + 7 @ 300 bps)", () => {
  const m = market(["50000000", "1000000000"], 0), p = position(["17000000", "0"], [String(10000000n * 100n + 7000000n * 300n), "0"]);
  const r = payoutFor(m, p), want = onchain(1000000000n, 50000000n, 17000000n, 3100000000n);
  assert.equal(r.fee, want.fee); assert.equal(r.fee, 6188000n);
});

test("weighted rate is capped at MAX_FEE_BPS", () => {
  const m = market(["100", "100"], 0), p = position(["100", "0"], ["500000", "0"]);   // 5000 bps written into the position
  assert.equal(payoutFor(m, p).fee, 10n);                                                // 10 % of the 100 gross share, not 50 %
});

test("voided market and empty winning side refund the whole stake with no fee; a loser gets nothing", () => {
  const p = position(["100", "50"], ["30000", "15000"]);
  assert.deepEqual(payoutFor(market(["100", "50"], 0, 3), p), { payout: 150n, fee: 0n, kind: "refund" });
  assert.deepEqual(payoutFor(market(["0", "50"], 0), position(["0", "50"], ["0", "15000"])), { payout: 50n, fee: 0n, kind: "refund" });
  assert.deepEqual(payoutFor(market(["100", "50"], 1), position(["100", "0"], ["30000", "0"])), { payout: 0n, fee: 0n, kind: "lost" });
});

test("house seed is split pro-rata among winners, fee-free", () => {
  const m = market(["200", "800"], 0, 2, 100), p = position(["50", "0"], ["15000", "0"]);   // 50 of the 200 winning pool → 25 % of the seed
  const r = payoutFor(m, p), want = onchain(800n, 200n, 50n, 15000n, 100n); assert.equal(r.payout, want.payout); assert.equal(r.payout, 50n + 200n - 6n + 25n);
});
