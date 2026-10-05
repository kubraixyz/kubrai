// Two copies of a locked script started at the same time: one works, the other stops without doing anything.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LOCK_BUSY } from "./run-lock.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kubrai-lock-"));
const lock = path.join(dir, "ledger.jsonl.lock"), work = path.join(dir, "work.log");
// stands in for referral-payout.mjs: takes the lock, then "pays" (appends a line) slowly enough for the two to overlap
const script = path.join(dir, "job.mjs");
fs.writeFileSync(script, `import fs from "node:fs";
import { runLocked } from ${JSON.stringify(fileURLToPath(new URL("./run-lock.mjs", import.meta.url)))};
runLocked(${JSON.stringify(lock)});
fs.appendFileSync(${JSON.stringify(work)}, "paid by " + process.pid + "\\n");
await new Promise((r) => setTimeout(r, 1500));
`);
const run = () => new Promise((resolve) => { const c = spawn(process.execPath, [script], { stdio: ["ignore", "ignore", "pipe"] }); let err = ""; c.stderr.on("data", (d) => { err += d; }); c.on("exit", (code) => resolve({ code, err })); });

test("two runs at once: one pays, the other finds the lock taken and pays nothing", async () => {
  const [a, b] = await Promise.all([run(), run()]);
  const codes = [a.code, b.code].sort();
  assert.deepEqual(codes, [0, LOCK_BUSY]);
  assert.match((a.code === LOCK_BUSY ? a : b).err, /another run holds/);
  assert.equal(fs.readFileSync(work, "utf8").trim().split("\n").length, 1);
});

test("the lock goes with the run: the next one goes ahead", async () => {
  const c = await run();
  assert.equal(c.code, 0);
  assert.equal(fs.readFileSync(work, "utf8").trim().split("\n").length, 2);
});
