// What makes an on-chain memo vouch for a snapshot file (evaluate.mjs memoMatches / verifySlot). The fixtures have the
// shape getParsedTransaction returns for snapshot.mjs's memo transactions on devnet (checked 2026-10-05 against memos
// from 2026-09-11 to 2026-10-05: one signer, the proposer; one spl-memo instruction; 3–7 minutes after the hour).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { memoMatches, makeEvaluator } from "./evaluate.mjs";

const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const PROPOSER = "4oM4QQijiVREuFeqpxjSSzhVUjx5FGj9M3MHRFJiQXw9", STRANGER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SLOT = "2026-10-05T03", HOUR = Date.parse(SLOT + ":00:00Z") / 1000, SHA = "ffd643e5ee50c1cc958f72b736bafce1e2d252bf752c17fa673c4d33f3287b87";
const tx = ({ signer = PROPOSER, memo = `kubrai-snapshot v2 ${SLOT} sha256=${SHA}`, program = MEMO, err = null, blockTime = HOUR + 180 } = {}) => ({
  blockTime, meta: { err, logMessages: [`Program ${program} invoke [1]`, `Program log: Memo (len ${memo.length}): "${memo}"`] },
  transaction: { message: { accountKeys: [{ pubkey: signer, signer: true, writable: true }], instructions: [program === MEMO ? { programId: program, program: "spl-memo", parsed: memo } : { programId: program, accounts: [], data: "3Bxs4h24hBtQy9rw" }] } },
});
const check = (t, o = {}) => memoMatches(t, { slot: SLOT, sha: SHA, signer: PROPOSER, ...o });

test("the snapshot key's own memo for that hour vouches for the file", () => {
  assert.equal(check(tx()), true);
  assert.equal(check(tx({ blockTime: HOUR + 6 * 3600 })), true);                // late, but inside the window
});

test("a memo anyone else sent does not, even with the right text", () => {
  assert.match(check(tx({ signer: STRANGER })), /not signed by the snapshot key/);
});

test("the hash in some other program's logs is not a memo", () => {
  // the old check read the logs: this one passed it
  assert.match(check(tx({ program: "11111111111111111111111111111111" })), /no memo with this file's sha256/);
});

test("a memo for another hour, a later re-anchoring, a failed transaction, a near-miss hash: all refused", () => {
  assert.match(check(tx({ memo: `kubrai-snapshot v2 2026-10-05T04 sha256=${SHA}` })), /memo is for 2026-10-05T04/);
  assert.match(check(tx({ blockTime: HOUR + 2 * 86400 })), /landed 48 h after its hour/);
  assert.match(check(tx({ blockTime: null })), /landed at an unknown time/);
  assert.match(check(tx({ err: { InstructionError: [0, "Custom"] } })), /failed on-chain/);
  assert.match(check(tx({ memo: `kubrai-snapshot v2 ${SLOT} sha256=${SHA}00` })), /no memo with this file's sha256/);
  assert.match(check(null), /not found/);
  assert.match(check(tx(), { signer: null }), /no snapshot key/);
});

test("the daily files of before 2026-09-12 (v1 memos, named by day) still verify", () => {
  assert.equal(memoMatches(tx({ memo: `kubrai-snapshot v1 2026-09-11 sha256=${SHA}`, blockTime: Date.parse("2026-09-11T00:05:00Z") / 1000 }), { slot: "2026-09-11T00", sha: SHA, signer: PROPOSER }), true);
});

test("verifySlot end to end: a stranger's anchor no longer passes for the snapshot file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kubrai-memo-"));
  const bundle = JSON.stringify({ v: 2, slot: SLOT, metrics: {} }), sha = createHash("sha256").update(bundle).digest("hex");
  fs.writeFileSync(path.join(dir, `${SLOT}.json`), bundle); fs.writeFileSync(path.join(dir, `${SLOT}.json.sha256`), sha + "\n");
  fs.writeFileSync(path.join(dir, `${SLOT}.json.memo`), JSON.stringify({ cluster: "devnet", signature: "sig1" }));
  const memo = `kubrai-snapshot v2 ${SLOT} sha256=${sha}`;
  const conn = (t) => ({ getParsedTransaction: async () => t, getTransaction: async () => t });
  const own = await makeEvaluator({ snapDir: dir, conn: conn(tx({ memo })), memoSigner: PROPOSER }).verifySlot(SLOT);
  assert.deepEqual(own, { ok: true, sha });
  const forged = await makeEvaluator({ snapDir: dir, conn: conn(tx({ memo, signer: STRANGER })), memoSigner: PROPOSER }).verifySlot(SLOT);
  assert.equal(forged.ok, false); assert.match(forged.reason, /not signed by the snapshot key/);
  const unset = await makeEvaluator({ snapDir: dir, conn: conn(tx({ memo })) }).verifySlot(SLOT);
  assert.equal(unset.ok, false);
});
