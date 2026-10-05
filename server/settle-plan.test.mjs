import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planSettle, rentToday } from "./settle-plan.mjs";

const row = (id, hasAccount, payout) => ({ id, hasAccount, payout: BigInt(payout) });
const actions = (plan) => plan.map((r) => `${r.id}:${r.action}`);

test("positions whose owner has an account are settled first and cost no budget", () => {
  const plan = planSettle([row("lostNoAcct", false, 0), row("wonAcct", true, 50), row("lostAcct", true, 0)], 0);
  assert.deepEqual(actions(plan), ["wonAcct:settle", "lostAcct:settle", "lostNoAcct:wait"]);
});

test("the budget goes to winners before losers", () => {
  // the farming pattern of the audit: many fresh wallets that lost and closed their accounts, one real winner
  const rows = [...Array(30)].map((_, i) => row(`farm${i}`, false, 0)); rows.splice(17, 0, row("winner", false, 1234));
  const plan = planSettle(rows, 3);
  assert.equal(plan[0].id, "winner"); assert.equal(plan[0].action, "open");
  assert.equal(plan.filter((r) => r.action === "open").length, 3);
  assert.equal(plan.filter((r) => r.action === "wait").length, 28);
});

test("no budget left: nothing is opened, however many positions there are", () => {
  const rows = [...Array(500)].map((_, i) => row(`w${i}`, false, i % 2 ? 10 : 0));
  assert.equal(planSettle(rows, 0).filter((r) => r.action === "open").length, 0);
  assert.equal(planSettle(rows, -4).filter((r) => r.action === "open").length, 0);
});

test("the day's count comes back from the file and starts over the next day", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kubrai-rent-")), "ata-rent.json");
  assert.deepEqual(rentToday(f, "2026-10-05"), { day: "2026-10-05", opened: 0, alerted: false });   // no file yet
  fs.writeFileSync(f, JSON.stringify({ day: "2026-10-05", opened: 7, alerted: true }));
  assert.deepEqual(rentToday(f, "2026-10-05"), { day: "2026-10-05", opened: 7, alerted: true });
  assert.deepEqual(rentToday(f, "2026-10-06"), { day: "2026-10-06", opened: 0, alerted: false });
  fs.writeFileSync(f, "{not json");
  assert.equal(rentToday(f, "2026-10-05").opened, 0);
});
