// Which positions of a finished market the crank settles this round, and in what order (resolve.mjs, settle step).
//
// Settling pays into the owner's SKR account, and the program wants that account even when the payout is 0. An owner
// who closed it gets it opened again by the crank, which pays the rent (~0.002 SOL) — and the owner can close it once
// more and keep that rent. Anyone can collect it again and again (bet from fresh wallets, close the account, wait for
// the crank), and it comes out of the proposer's SOL, which also pays for proposing and finalizing every market
// (audit 2026-10-05). So opening accounts has a daily budget: positions that cost nothing go first, then winners (their
// money is waiting), then losers (they only hold up the sweep of the fees). Past the budget a position stays open (the
// stake stays in the vault, nothing is lost) and is tried again every round until the next day's budget pays it — or
// until its owner opens the account, after which it settles at no cost.
//
import fs from "node:fs";

// rows: [{ hasAccount, payout (bigint), ... }]; budgetLeft: accounts the crank may still open today.
// Returns the rows in settling order, each with action "settle" (account exists), "open" (open it in the same
// transaction as the payout) or "wait".
export function planSettle(rows, budgetLeft) {
  const order = [...rows].sort((a, b) => Number(b.hasAccount) - Number(a.hasAccount) || Number(b.payout > 0n) - Number(a.payout > 0n));
  let left = Math.max(0, budgetLeft);
  return order.map((r) => ({ ...r, action: r.hasAccount ? "settle" : left > 0 ? (left--, "open") : "wait" }));
}

/** Today's count of accounts opened, from the budget file ({ day, opened, alerted }); a new UTC day starts at 0. */
export function rentToday(file, day = new Date().toISOString().slice(0, 10)) {
  try { const r = JSON.parse(fs.readFileSync(file, "utf8")); if (r.day === day && Number.isInteger(r.opened)) return { day, opened: r.opened, alerted: !!r.alerted }; } catch {}
  return { day, opened: 0, alerted: false };
}
