// The counted period of a market (history.mjs countedWindow) and the schedule open-markets.mjs creates: one rule the
// opener, resolver, verifier, API and pages all rely on. If these fail, markets settle on the wrong hours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countedWindow, parseMetric, DAY_LOCK_SECS, DAY_OPEN_LEAD_SECS } from "./history.mjs";

const T = (s) => Date.parse(s) / 1000;

test("current schedule: bets 11:00 UTC the day before → 12:00 UTC, counts the whole UTC day it closes in", () => {
  const D = T("2026-09-27T00:00:00Z"), open = D - DAY_OPEN_LEAD_SECS, close = D + DAY_LOCK_SECS;
  assert.equal(open, T("2026-09-26T11:00:00Z")); assert.equal(close, T("2026-09-27T12:00:00Z"));
  for (const m of ["sgt_day", "skr_staked_dmed", "ore_sol_day", "jup_agg_volume_today"]) {
    const spec = parseMetric(m); assert.ok(spec, m);
    assert.deepEqual(countedWindow(spec, open, close), { from: D, to: D + 86400 }, m);
  }
});

test("betting never outlasts half the counted day, and the next day's market opens before this one locks", () => {
  const D = T("2026-09-27T00:00:00Z"), close = D + DAY_LOCK_SECS, nextOpen = D + 86400 - DAY_OPEN_LEAD_SECS;
  assert.ok(close - D <= 43200); assert.ok(nextOpen < close);
});

test("markets opened before the change keep their own rule", () => {
  const o = T("2026-09-26T00:00:00Z"), c = T("2026-09-27T00:00:00Z");
  assert.deepEqual(countedWindow(parseMetric("sgt_day"), o, c), { from: o, to: c });
  assert.deepEqual(countedWindow(parseMetric("jup_agg_volume_next"), o, c), { from: c, to: c + 86400 });
});
