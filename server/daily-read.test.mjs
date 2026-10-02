// When a DefiLlama-sourced market reads its number, and what happens if the source changes it afterwards.
// Three rules, each of which would settle markets wrongly if it broke:
//   1. the hour is the market's own on-chain resolve_after, never today's config (markets opened with a 2–3 day wait
//      are still pending while new ones wait 6–48 hours);
//   2. a market reads the first bundle at or after that hour that carries its day with a positive number;
//   3. the verifier's last look voids a proposal only when the source has moved the day into another range.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseMetric, dailyReadTs, DAY_LOCK_SECS, DAY_OPEN_LEAD_SECS } from "./history.mjs";
import { APP_METRIC_CATALOG } from "./app-metrics.mjs";
import { makeEvaluator } from "./evaluate.mjs";
import { lastLookAction, comparisonAction, LAST_LOOK_SECS } from "./verify-rules.mjs";

const T = (s) => Date.parse(s) / 1000;
const market = (day) => { const D = T(day + "T00:00:00Z"); return { D, open: D - DAY_OPEN_LEAD_SECS, close: D + DAY_LOCK_SECS }; };
/** A snapshot directory holding, per hourly slot, what the source said about each day of one metric. */
function bundles(src, bySlot) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kubrai-daily-"));
  for (const [slot, series] of Object.entries(bySlot)) fs.writeFileSync(path.join(dir, slot + ".json"), JSON.stringify({ slot, metrics: series ? { [src]: { value: series.at(-1)[1], raw: { series }, source: "https://api.llama.fi/x" } } : {} }));
  return makeEvaluator({ snapDir: dir, conn: null });
}

test("read times: the wait measured for each source (hours after the counted day ends)", () => {
  const want = { jup_perps_fees: 6, pump_rev: 6, solana_fees: 6, phantom_rev: 24, jito_mev_tips: 24, jup_agg_volume: 24, jup_rev: 48 };
  for (const [id, h] of Object.entries(want)) {
    assert.equal(parseMetric(id + "_today")?.lagHours, h, id);
    assert.equal(APP_METRIC_CATALOG[id].readAfterHours, h, id);
    assert.equal(APP_METRIC_CATALOG[id].lagDays, h / 24, id + " (what app builds up to 0.1.38 print)");
  }
});

test("a market opened now is read that many hours after its day ends", () => {
  const { D, open, close } = market("2026-10-04");
  assert.equal(dailyReadTs(parseMetric("jup_perps_fees_today"), open, close), D + 86400 + 6 * 3600);   // 5 Oct 06:00 UTC
  assert.equal(dailyReadTs(parseMetric("phantom_rev_today"), open, close), D + 2 * 86400);
  assert.equal(dailyReadTs(parseMetric("jup_rev_today"), open, close), D + 3 * 86400);
  assert.ok(dailyReadTs(parseMetric("jup_perps_fees_today"), open, close) >= close, "the program refuses resolve_after before close");
});

test("a market already open keeps the hour it was opened with, whatever the config says today", () => {
  const { D, open, close } = market("2026-09-30");   // #160: opened when the wait was 2 days
  const onchain = D + 3 * 86400;
  assert.equal(dailyReadTs(parseMetric("jup_perps_fees_today"), open, close, onchain), onchain);
  assert.equal(dailyReadTs(parseMetric("jup_perps_fees_today"), open, close, 0), D + 86400 + 6 * 3600, "0 = no market: today's config");
});

test("the Jito total (tips + staking rewards) still resolves for the markets opened on it; new markets use tips only", () => {
  assert.equal(parseMetric("jito_tips_today")?.kind, "daily");
  assert.equal(parseMetric("jito_mev_tips_today")?.src, "jito_mev_tips");
  const tpl = JSON.parse(fs.readFileSync(new URL("./market-templates.json", import.meta.url), "utf8")).templates.map((t) => t.metric);
  assert.ok(tpl.includes("jito_mev_tips_today")); assert.ok(!tpl.includes("jito_tips_today"));
  for (const m of tpl) assert.ok(parseMetric(m), `${m}: a template the resolver cannot parse opens a market that never resolves`);
});

test("evaluate: the same day settles on what the source showed at each market's own hour", () => {
  // 30 Sept: appears at +2 h as 100, is revised to 103 at +15 h (Jupiter revenue does this every day)
  const day = "2026-09-30", { D, open, close } = market(day);
  const s = (v) => [["2026-09-29", 90], ...(v == null ? [] : [[day, v]])];
  const ev = bundles("jup_perps_fees", { "2026-10-01T00": s(null), "2026-10-01T02": s(100), "2026-10-01T06": s(100), "2026-10-01T15": s(103), "2026-10-03T00": s(103) });
  const now6h = ev.evaluate("jup_perps_fees_today", open, close, 0, D + 86400 + 6 * 3600);
  assert.equal(now6h.ok, true); assert.equal(now6h.value, 100); assert.deepEqual(now6h.used, ["2026-10-01T06"]);
  const old2d = ev.evaluate("jup_perps_fees_today", open, close, 0, D + 3 * 86400);
  assert.equal(old2d.value, 103); assert.deepEqual(old2d.used, ["2026-10-03T00"]);
});

test("evaluate: not published yet, or a gap day reading 0, waits for the first later bundle that has the day", () => {
  const day = "2026-10-04", { D, open, close } = market(day), read = D + 86400 + 6 * 3600;
  const s = (v) => [["2026-10-03", 90], ...(v == null ? [] : [[day, v]])];
  const late = bundles("jup_perps_fees", { "2026-10-05T06": s(null), "2026-10-05T07": s(0), "2026-10-05T08": null, "2026-10-05T09": s(77), "2026-10-05T10": s(80) });
  const r = late.evaluate("jup_perps_fees_today", open, close, 0, read);
  assert.equal(r.value, 77); assert.deepEqual(r.used, ["2026-10-05T09"]);
  const never = bundles("jup_perps_fees", { "2026-10-05T06": s(null) });
  assert.equal(never.evaluate("jup_perps_fees_today", open, close, 0, read).ok, false);
  const early = bundles("jup_perps_fees", { "2026-10-05T03": s(70), "2026-10-05T06": s(71) });
  assert.equal(early.evaluate("jup_perps_fees_today", open, close, 0, read).value, 71, "a bundle before the read hour is not the reading");
});

test("dailyLatest: what the source says now, from the newest recent bundle that carries the day", () => {
  const day = "2026-10-04", { open, close } = market(day);
  const s = (v) => [[day, v]];
  const ev = bundles("jup_perps_fees", { "2026-10-05T06": s(100), "2026-10-05T10": s(100), "2026-10-05T11": s(140), "2026-10-05T12": null });
  assert.deepEqual(ev.dailyLatest("jup_perps_fees_today", open, close, T("2026-10-05T12:10:00Z")), { value: 140, slot: "2026-10-05T11", day });
  assert.deepEqual(ev.dailyLatest("jup_perps_fees_today", open, close, T("2026-10-05T10:50:00Z")), { value: 100, slot: "2026-10-05T10", day });
  assert.equal(ev.dailyLatest("jup_perps_fees_today", open, close, T("2026-10-06T12:00:00Z")), null, "nothing recent: no evidence of a change");
  assert.equal(ev.dailyLatest("sgt_day", open, close, T("2026-10-05T12:10:00Z")), null, "only daily-source markets get a last look");
});

test("last look: void only when the source has moved the day into another range", () => {
  const thr = [100, 200, 300];                       // ranges: <100, 100–199, 200–299, ≥300
  assert.equal(lastLookAction(1, 150, { value: 150 }, thr).action, "same");
  assert.equal(lastLookAction(1, 150, { value: 199 }, thr).action, "moved-same-range");
  assert.deepEqual(lastLookAction(1, 150, { value: 200 }, thr), { action: "void-drift", bucket: 2 });   // on the threshold = the range above
  assert.deepEqual(lastLookAction(1, 150, { value: 99 }, thr), { action: "void-drift", bucket: 0 });
  assert.equal(lastLookAction(1, 150, null, thr).action, "no-data");
  assert.equal(lastLookAction(1, 150, { value: 0 }, thr).action, "no-data", "a 0 is a source gap, not a new number");
  assert.equal(lastLookAction(0, 1, { value: 5 }, [3]).action, "void-drift");   // yes/no market
});

test("verifier: its first judgement is unchanged, and the last look fits inside the window", () => {
  assert.equal(comparisonAction(2, 2), "agree"); assert.equal(comparisonAction(2, 1), "void-mismatch"); assert.equal(comparisonAction(2, null), "unknown");
  assert.ok(LAST_LOOK_SECS >= 20 * 60 && LAST_LOOK_SECS < 6 * 3600);
});
