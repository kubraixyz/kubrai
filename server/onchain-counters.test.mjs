// The two numbers read straight from mainnet accounts (onchain-counters.mjs): how the accounts are parsed and how a
// reading becomes a running total. They are collected only for now; these rules decide what a market would settle on
// once one opens, so they are pinned before the first day of data exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsePerpsPool, advancePerps, advanceTips, tipEpoch, latestEarlier } from "./onchain-counters.mjs";
import { APP_METRICS, SOFT_APP_METRICS } from "./app-metrics.mjs";
import { parseMetric } from "./history.mjs";

// The first 400 bytes of the Jupiter Perps pool account 5BUw…Ksq as it stood on 2026-10-02 (public chain data).
const POOL = Buffer.from("8ZptBBGxbbwEAAAAUG9vbAYAAABnWV3YRsAH8miW8q7TG6e1X9EszBWOCwB6nY/oRraf6YuqSkhkImzAIkhNyCgeGhaPXPToBT8a5QZtkWqIud+fQU2BSGrxPm7sni1bz0WRMuOkZkcJtm040GR3kSTGzj7e6As0E6LTEIBia5JsOK80vtGG2zaOl386v0vVRUSabTpX4svK0CiDUCPMq0rYe9J2To/BMtaOmGYJ6xNL14b5u8LQjVN1rYnrZgJ517WDe/drNF1/xti+O8OnylylKv8mJ85FAFoDAAAAAAAAAAAAAIBT7nuoCgAAAAAAAAAAAOgDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGQAAAAAAAAAZAAAAAAAAAAUAAAAAAAAAAoAAAAAAAAAZAAAAAAAAAACAAAAAAAAAAUAAAAAAAAAlgAAAAAAAADECQAAAAAAAJUct2oAAAAAyQMAAAAAAACDX4+wSAEAAC0AAAAAAAAA/P4IcLZkAAAAAAJRurupe5tRHbNTdQ4sOeYTQg==", "base64");
const POOL_NOW = 1790385301 + 6 * 86400;   // a clock a few days after the pool's last APR update

test("Jupiter Perps pool: the counter is found by walking the account, wherever the custody list puts it", () => {
  const p = parsePerpsPool(POOL, POOL_NOW);
  assert.equal(p.name, "Pool"); assert.equal(p.custodies.length, 6);
  assert.equal(p.lastUpdated, 1790385301); assert.equal(p.feeAprBps, 969); assert.equal(p.realizedFeeUsd, 1411711459203);
  assert.equal(p.custodies[0], "7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz");
  // one more custody moves every later field by 32 bytes: the same numbers must come out
  const at = 8 + 4 + 4, n = POOL.readUInt32LE(at); const grown = Buffer.concat([POOL.subarray(0, at + 4 + 32 * n), Buffer.alloc(32, 7), POOL.subarray(at + 4 + 32 * n)]); grown.writeUInt32LE(n + 1, at);
  const g = parsePerpsPool(grown, POOL_NOW);
  assert.equal(g.custodies.length, n + 1); assert.equal(g.realizedFeeUsd, p.realizedFeeUsd); assert.equal(g.lastUpdated, p.lastUpdated);
});

test("Jupiter Perps pool: an account that no longer looks like the pool is refused, not read as a number", () => {
  assert.throws(() => parsePerpsPool(POOL, POOL_NOW + 90 * 86400), /layout changed/, "an APR update months old is not the field we think it is");
  const bad = Buffer.from(POOL); bad.writeUInt32LE(5000, 8); assert.throws(() => parsePerpsPool(bad, POOL_NOW), /layout changed/);
  const none = Buffer.from(POOL); none.writeUInt32LE(0, 16); assert.throws(() => parsePerpsPool(none, POOL_NOW), /layout changed/);
});

test("Jupiter Perps fees: the running total adds what the counter gained, and survives the weekly restart", () => {
  assert.deepEqual(advancePerps(null, { lastUpdated: 100, realizedFeeUsd: 5_000_000 }), { value: 0, added: 0, note: "first reading: the running total starts at 0 here" });
  const prev = { value: 40_000_000, raw: { lastUpdated: 100, realizedFeeUsd: 5_000_000 } };
  assert.deepEqual(advancePerps(prev, { lastUpdated: 100, realizedFeeUsd: 5_250_000 }), { value: 40_250_000, added: 250_000 });
  assert.deepEqual(advancePerps(prev, { lastUpdated: 100, realizedFeeUsd: 5_000_000 }), { value: 40_000_000, added: 0 });
  const restart = advancePerps(prev, { lastUpdated: 700, realizedFeeUsd: 30_000 });   // the APR update zeroed the counter
  assert.equal(restart.value, 40_030_000); assert.equal(restart.added, 30_000); assert.match(restart.note, /restarted/);
  const lower = advancePerps(prev, { lastUpdated: 100, realizedFeeUsd: 10 });         // lower without a new timestamp: also a restart, never a negative day
  assert.equal(lower.added, 10); assert.ok(lower.value >= prev.value);
});

test("Jito tip accounts: inside an epoch the total grows by what the accounts gained", () => {
  assert.equal(advanceTips(null, { epoch: 1047, epochLamports: 9e11 }).value, 0);
  const prev = { value: 5e12, raw: { epoch: 1047, epochLamports: 2_000e9 } };
  assert.deepEqual(advanceTips(prev, { epoch: 1047, epochLamports: 2_010e9 }), { value: 5e12 + 10e9, added: 10e9 });
  const drop = advanceTips(prev, { epoch: 1047, epochLamports: 1_990e9 });
  assert.equal(drop.added, 0); assert.equal(drop.value, 5e12); assert.match(drop.note, /fell/);
});

test("Jito tip accounts: across an epoch boundary nothing is lost and nothing is counted twice", () => {
  const prev = { value: 5e12, raw: { epoch: 1047, epochLamports: 2_000e9 } };
  // epoch 1047 finished at 2,600 SOL (600 more than at our last reading); 1048 has collected 40 SOL so far
  assert.deepEqual(advanceTips(prev, { epoch: 1048, epochLamports: 40e9, finals: { 1047: 2_600e9 } }), { value: 5e12 + 640e9, added: 640e9 });
  // two boundaries between readings: the whole of the epoch in between counts
  assert.equal(advanceTips(prev, { epoch: 1049, epochLamports: 5e9, finals: { 1047: 2_600e9, 1048: 3_000e9 } }).added, 600e9 + 3_000e9 + 5e9);
  assert.throws(() => advanceTips(prev, { epoch: 1048, epochLamports: 40e9, finals: {} }), /no total for finished epoch 1047/);
  assert.throws(() => advanceTips(prev, { epoch: 1060, epochLamports: 1, finals: {} }), /refusing to guess/);
  assert.throws(() => advanceTips(prev, { epoch: 1046, epochLamports: 1 }), /backwards/);
});

test("Jito tip accounts: an epoch = what its open accounts hold above rent + what its closed accounts were to pay out", async () => {
  const closedData = (max, claimed) => { const b = Buffer.alloc(65); b[0] = 1; b.writeBigUInt64LE(BigInt(max), 33); b.writeBigUInt64LE(BigInt(claimed), 49); return b; };
  const calls = [];
  const conn = { getProgramAccounts: async (_p, cfg) => { const off = cfg.filters.find((f) => f.memcmp).memcmp.offset; calls.push(off);
    return off === 73 ? [{ account: { lamports: 1_000_000 + 1_503_680, data: Buffer.from([0]) } }, { account: { lamports: 500 + 1_503_680, data: Buffer.from([0]) } }, { account: { lamports: 9e9, data: Buffer.from([1]) } }]   // the last one has a root: not open
      : [{ account: { lamports: 1_503_680 + 20, data: closedData(7_000_000, 6_999_980) } }, { account: { lamports: 1, data: Buffer.alloc(65) } }]; } };   // tag 0 in the "closed" scan: ignored
  const e = await tipEpoch(conn, 1046, 1_503_680);
  assert.deepEqual(e.open, { n: 2, lamports: 1_000_500 + 2 * 1_503_680, net: 1_000_500 }); assert.equal(e.closed.n, 1); assert.equal(e.closed.maxTotalClaim, 7_000_000); assert.equal(e.closed.claimed, 6_999_980);
  assert.equal(e.total, 1_000_500 + 7_000_000); assert.deepEqual(calls, [73, 137]);
  calls.length = 0; const running = await tipEpoch(conn, 1047, 1_503_680, false);
  assert.deepEqual(calls, [73], "the running epoch is scanned once"); assert.equal(running.total, 1_000_500);
});

test("a running total continues from the newest earlier bundle that carries it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kubrai-counters-"));
  const put = (slot, metrics) => fs.writeFileSync(path.join(dir, slot + ".json"), JSON.stringify({ slot, metrics }));
  put("2026-10-02T14", { x: { value: 10, raw: { a: 1 } } }); put("2026-10-02T15", { other: { value: 1, raw: {} } }); put("2026-10-02T16", { x: { value: 12, raw: { a: 2 } } }); put("2026-10-02T17", { x: { value: 99, raw: {} } });
  assert.deepEqual(latestEarlier("x", dir, "2026-10-02T17"), { slot: "2026-10-02T16", value: 12, raw: { a: 2 } });   // the run's own slot does not count
  assert.deepEqual(latestEarlier("x", dir, "2026-10-02T16"), { slot: "2026-10-02T14", value: 10, raw: { a: 1 } });   // a bundle without it is skipped
  assert.equal(latestEarlier("x", dir, "2026-10-02T14"), null); assert.equal(latestEarlier("nope", dir, "2026-10-03T00"), null);
});

test("config: what is only collected has no market, and every market in the templates can be resolved", () => {
  const tpl = JSON.parse(fs.readFileSync(new URL("./market-templates.json", import.meta.url), "utf8")).templates.map((t) => t.metric);
  assert.deepEqual([...SOFT_APP_METRICS].sort(), ["jito_tips_chain", "jup_perps_fees_chain"]);
  for (const id of SOFT_APP_METRICS) assert.ok(!tpl.some((m) => m.startsWith(id + "_")), id + " is collected only: it must not have a market yet");
  for (const m of tpl) assert.ok(parseMetric(m), m + ": a template the resolver cannot parse");
  assert.ok(tpl.includes("psol_dmed")); assert.equal(parseMetric("psol_dmed").kind, "med");
  assert.ok(!tpl.includes("sanctum_fees_today")); assert.ok(!APP_METRICS.some((m) => m.id === "sanctum_fees"), "retired 2026-10-03: it could never open and was reported as skipped every day");
  assert.ok(tpl.includes("sanctum_inf_dmed"), "Sanctum keeps its on-chain market");
});
