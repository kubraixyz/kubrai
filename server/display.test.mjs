// A yes/no threshold is rounded to the pages' display precision at opening (history.mjs roundToDisplay), so the number a
// bettor reads is the number the program compares. Whole-number metrics are untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { displayUnit, roundToDisplay } from "./history.mjs";

test("prices with 2 shown decimals round to whole cents (ORE price: scale 1e8, digits 2 → unit 1e6)", () => {
  assert.equal(displayUnit("ore_price_dmed"), 1e6);
  assert.equal(roundToDisplay("ore_price_dmed", 8271735795), 8272000000);   // 82.71735795 → 82.72 (#139 of 2026-09-29)
  assert.equal(roundToDisplay("ore_price_dmed", 8271499999), 8271000000);
});
test("4-decimal defaults for lamport/1e8-scaled metrics; SKR staked to whole SKR; counts untouched", () => {
  assert.equal(roundToDisplay("skr_price_dmed", 1801431), 1800000);           // 0.01801431 USD → 0.0180
  assert.equal(roundToDisplay("skr_staked_dmed", 123456789012), 123457000000); // 123,456.789012 SKR → 123,457
  assert.equal(displayUnit("sgt_day"), 1); assert.equal(roundToDisplay("sgt_day", 17), 17);
  assert.equal(displayUnit("ore_hits_day"), 1);
});
test("a rounded threshold prints back exactly at the display precision", () => {
  for (const [metric, v, scale, digits] of [["ore_price_dmed", 8271735795, 1e8, 2], ["skr_price_dmed", 1801431, 1e8, 4], ["jito_sol_dmed", 12345678912345678, 1e9, 0]]) {
    const r = roundToDisplay(metric, v); assert.equal(r % displayUnit(metric), 0, metric);
    assert.equal(String(r / scale), (r / scale).toFixed(digits).replace(/\.?0+$/, ""), metric);
  }
});
