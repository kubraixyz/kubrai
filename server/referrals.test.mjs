import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REFEREE_BPS, bind, bindMessage, codeFor, earnings, ensureCode, load, normalizeCode, pending, save, tierBps, effectivePayouts, unsettledPayouts } from "./referrals.mjs";
import { leaderboard } from "./points.mjs";

const A = "DaBB7D5A6kEMrZzhfiaWN4XvykZBGK5J6PEX58zQVPmT", B = "FfZbH33d4ws3LB9Bdx7abSCvXKThBmtS18LWdSizQVYj", C = "op2Ve6ehakzUNvRgwZNQxAEL9SXMPBDrA3uzG9WwSfF";
const row = (owner, fee, extra = {}) => ({ at: "2099-01-01T00:00:00.000Z", owner, fee: String(fee), amounts: ["100000000", "0"], status: 2, outcome: 0, kind: fee ? "won" : "lost", payout: "0", id: 1, ...extra });

test("codes are deterministic, 6 chars, and survive 0/O 1/I/L typos", () => {
  assert.equal(codeFor(A), codeFor(A));
  assert.match(codeFor(A), /^[A-Z0-9]{6}$/);
  assert.notEqual(codeFor(A), codeFor(B));
  assert.equal(normalizeCode(" abc0il "), "ABC011");
});

test("ensureCode is idempotent and resolves a collision by lengthening", () => {
  const db = load("/nonexistent");
  const a = ensureCode(db, A); assert.equal(a.created, true);
  assert.deepEqual(ensureCode(db, A), { code: a.code, created: false });
  db.codes[codeFor(B)] = "someone-else";
  assert.equal(ensureCode(db, B).code, codeFor(B, 7));
});

test("bind rules: unknown code, self, second code refused; same code twice is a no-op", () => {
  const db = load("/nonexistent"); const { code } = ensureCode(db, A);
  assert.equal(bind(db, { wallet: B, code: "ZZZZZZ", cluster: "devnet" }).error, "unknown referral code");
  assert.equal(bind(db, { wallet: A, code, cluster: "devnet" }).error, "you cannot refer yourself");
  assert.deepEqual(bind(db, { wallet: B, code: code.toLowerCase(), cluster: "devnet" }), { ok: true });
  assert.equal(bind(db, { wallet: B, code, cluster: "mainnet" }).already, true);
  ensureCode(db, C);
  assert.match(bind(db, { wallet: B, code: codeFor(C), cluster: "devnet" }).error, /already bound/);
  assert.equal(db.bindings[B].referrer, A);
});

test("bind rules: a ring (A refers B, B refers A, or through C) is refused", () => {
  const db = load("/nonexistent"); ensureCode(db, A); ensureCode(db, B); ensureCode(db, C);
  assert.deepEqual(bind(db, { wallet: B, code: codeFor(A), cluster: "devnet" }), { ok: true });
  assert.match(bind(db, { wallet: A, code: codeFor(B), cluster: "devnet" }).error, /circle/);
  assert.deepEqual(bind(db, { wallet: C, code: codeFor(B), cluster: "devnet" }), { ok: true });
  assert.match(bind(db, { wallet: A, code: codeFor(C), cluster: "devnet" }).error, /circle/);
});

test("bind message names the site and the time", () => {
  assert.equal(bindMessage(A, "ABC234", "devnet.kubrai.xyz", 1700000000), `kubrai-referral v1\ndomain=devnet.kubrai.xyz\nwallet=${A}\ncode=ABC234\nts=1700000000`);
});

test("tiers: 20 % below 10k points, 25 % from 10k, 30 % from 100k", () => {
  assert.equal(tierBps(0), 2000); assert.equal(tierBps(9999), 2000); assert.equal(tierBps(10_000), 2500); assert.equal(tierBps(100_000), 3000);
});

test("earnings: referrer gets tier share of the referee's fee, referee gets 10 % back; bindings do not reach back in time", () => {
  const db = load("/nonexistent"); const { code } = ensureCode(db, A); bind(db, { wallet: B, code, cluster: "devnet", now: Date.parse("2026-09-19T00:00:00Z") });
  // B won: fee 3 SKR; C is unbound and earns nobody anything
  const e = earnings([row(B, 3_000_000), row(C, 3_000_000), row(B, 0)], db, () => 0);
  const a = e.byWallet.get(A), b = e.byWallet.get(B);
  assert.equal(a.referred.size, 1);
  assert.equal(a.raw, 600_000n);                 // 20 % of 3 SKR = 0.6 SKR
  assert.equal(b.raw, 300_000n);                 // 10 % back
  assert.equal(b.asReferee, 300_000n);
  assert.equal(e.byWallet.has(C), false);
  const e2 = earnings([row(B, 3_000_000)], db, (w) => (w === A ? 10_000 : 0));
  assert.equal(e2.byWallet.get(A).raw, 750_000n);    // 25 % tier
  const e3 = earnings([row(B, 3_000_000, { at: "2026-09-18T00:00:00.000Z" })], db);   // settled before the binding
  assert.equal(e3.byWallet.get(A).raw, 0n);
});

test("pending = earned − paid, per wallet; fully paid entries disappear", () => {
  const db = load("/nonexistent"); const { code } = ensureCode(db, A); bind(db, { wallet: B, code, cluster: "devnet" });
  const e = earnings([row(B, 10_000)], db);
  assert.deepEqual(pending(e, []).map((p) => [p.wallet, p.raw]), [[A, 2000n], [B, 1000n]]);
  assert.deepEqual(pending(e, [{ wallet: A, raw: "1500" }, { wallet: B, raw: "1000" }]).map((p) => [p.wallet, p.raw]), [[A, 500n]]);
});

test("save is atomic and load round-trips", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ref-")), f = path.join(dir, "referrals.json");
  const db = load(f); ensureCode(db, A); save(f, db);
  assert.equal(load(f).wallets[A].code, codeFor(A));
  assert.deepEqual(fs.readdirSync(dir), ["referrals.json"]);
  assert.equal(REFEREE_BPS, 1000);
});

test("ledger: a sent row counts as paid, a void row cancels it, landed adds nothing; unsettled = sent without an answer", () => {
  const db = load("/nonexistent"); ensureCode(db, A); bind(db, { wallet: B, code: codeFor(A), cluster: "devnet" });
  const earn = earnings([row(B, 10_000)], db);
  const sent = { status: "sent", wallet: A, raw: "2000", signature: "s1" };
  assert.deepEqual(pending(earn, [sent]).map((p) => p.wallet), [B]);
  assert.deepEqual(pending(earn, [sent, { status: "landed", wallet: A, raw: "0", signature: "s1" }]).map((p) => p.wallet), [B]);
  const voided = [sent, { status: "void", wallet: A, raw: "-2000", signature: "s1" }];
  assert.deepEqual(pending(earn, voided).map((p) => p.wallet).sort(), [A, B].sort());
  assert.equal(effectivePayouts(voided).length, 0);
  assert.deepEqual(unsettledPayouts([sent]).map((p) => p.signature), ["s1"]);
  assert.equal(unsettledPayouts([sent, { status: "landed", signature: "s1", raw: "0" }]).length, 0);
});

test("points = SKR staked across every range, won or lost; voided markets score nothing; windows filter by settle time", () => {
  const rows = [
    { at: "2026-09-20T00:00:00Z", owner: A, id: 1, amounts: ["100000000", "100000000", "0", "0"], status: 2, kind: "won", payout: "250000000", fee: "3000000" },   // 200 SKR on two ranges, won
    { at: "2026-09-21T00:00:00Z", owner: A, id: 2, amounts: ["50000000", "0"], status: 3, kind: "refund", payout: "50000000", fee: "0" },                    // voided
    { at: "2026-09-22T00:00:00Z", owner: B, id: 3, amounts: ["5000000", "0"], status: 2, kind: "lost", payout: "0", fee: "0" },
  ];
  const b = leaderboard(rows);
  assert.deepEqual(b.entries.map((e) => [e.wallet, e.points, e.markets, e.won]), [[A, 200, 1, 1], [B, 5, 1, 0]]);
  assert.equal(b.totals.markets, 2);
  assert.equal(leaderboard(rows, Date.parse("2026-09-21T12:00:00Z") / 1000).entries.length, 1);
});
