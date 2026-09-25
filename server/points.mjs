// Leaderboard points, computed from snapshots/settlements.jsonl (the crank's record of every position it paid out).
//
// Points for one position in one market:
//
//     points = SKR staked, across every range you bet, won or lost
//
// One token, so no price is involved: 100 SKR on each of four ranges is 400 points, and only one of them can pay.
// A voided market has no result and scores nothing (stakes were refunded). A resolved market where nobody picked the
// winning range still had a result: everyone was refunded, and the stakes still count.
import fs from "node:fs";
import path from "node:path";

const DECIMALS = 6;
export const toUi = (raw) => Number(raw) / 10 ** DECIMALS;

/** One settlement row → its point value in whole SKR, or null when the market had no result. */
function score(row) {
  if (row.status === 3) return null;
  const stakeRaw = (row.amounts ?? []).reduce((a, b) => a + Number(b), 0);
  return { stake: toUi(stakeRaw), payout: toUi(row.payout ?? 0), fee: toUi(row.fee ?? 0) };
}

/**
 * @param rows   parsed settlement rows, oldest first
 * @param since  unix seconds; only rows settled at or after this count
 */
export function leaderboard(rows, since = 0) {
  const by = new Map(), markets = new Set();
  let volume = 0, fees = 0, scoredRows = 0;
  for (const r of rows) {
    if (since && Date.parse(r.at) / 1000 < since) continue;
    const s = score(r);
    if (!s) continue;
    scoredRows++; markets.add(String(r.id)); volume += s.stake; fees += s.fee;
    const e = by.get(r.owner) ?? { wallet: r.owner, points: 0, markets: new Set(), won: 0, pnl: 0, feesPaid: 0, lastAt: r.at };
    e.points += s.stake;
    e.markets.add(String(r.id));
    e.pnl += s.payout - s.stake;
    e.feesPaid += s.fee;
    if (r.kind === "won") e.won += 1;
    if (r.at > e.lastAt) e.lastAt = r.at;
    by.set(r.owner, e);
  }
  const entries = [...by.values()].map((e) => ({ ...e, markets: e.markets.size })).sort((a, b) => b.points - a.points || a.lastAt.localeCompare(b.lastAt)).map((e, i) => ({ rank: i + 1, ...e }));
  return { entries, totals: { players: entries.length, markets: markets.size, volume, fees, points: volume, rows: scoredRows } };
}

/** Settlement rows from disk, oldest first. A torn line is skipped (the crank appends one JSON object per line). */
export function readSettlements(dataDir) {
  const f = path.join(dataDir, "settlements.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}
