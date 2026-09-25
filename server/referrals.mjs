// Referral links: anyone who has placed a bet gets a code; a wallet that arrives through ?ref=CODE is bound to that
// code by its first bet (signed by the wallet, so nobody can bind someone else's wallet), permanently and on every
// network — the file is keyed by wallet address, which is the same on devnet and mainnet.
//
// Money: the fee is charged on winnings (lib.rs settle_position), in SKR. When a bound wallet's position settles
// with a fee, the referrer earns REFERRER tier % of that fee and the referee gets REFEREE_BPS of it back, both in SKR,
// paid by referral-payout.mjs from the rebate wallet. Earnings are derived from settlements.jsonl every time (nothing
// is stored twice); the payout ledger records what was actually sent.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const REFEREE_BPS = 1000;                                   // referee gets 10 % of the fee back
export const REFERRER_TIERS = [                                     // by the referrer's own all-time points (= SKR staked)
  { points: 0, bps: 2000 },                                        // 20 % of every referred fee
  { points: 10_000, bps: 2500 },                                   // 25 %
  { points: 100_000, bps: 3000 },                                  // 30 %
];
export const tierBps = (points) => REFERRER_TIERS.reduce((bps, t) => (points >= t.points ? t.bps : bps), REFERRER_TIERS[0].bps);
export const nextTier = (points) => REFERRER_TIERS.find((t) => points < t.points) ?? null;

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";                 // no 0/O/1/I/L
export const CODE_RE = /^[A-Z0-9]{6,10}$/;
/** Deterministic code for a wallet (same wallet → same code on every host); `len` grows on the rare collision. */
export function codeFor(wallet, len = 6) {
  const h = crypto.createHash("sha256").update("kubrai-ref:" + wallet).digest();
  let s = ""; for (let i = 0; i < len; i++) s += ALPHABET[h[i] % ALPHABET.length];
  return s;
}
export const normalizeCode = (c) => String(c ?? "").trim().toUpperCase().replace(/[O]/g, "0").replace(/[IL]/g, "1");
/** What the wallet signs to bind (plain text, so the wallet shows it). `domain` names the site the signature is for and
 *  `ts` (unix seconds) when it was made: the API takes it only for BIND_MAX_AGE_SECS, so a signature obtained elsewhere
 *  cannot be kept and used later. */
export const BIND_MAX_AGE_SECS = 600;
export const bindMessage = (wallet, code, domain, ts) => `kubrai-referral v1\ndomain=${domain}\nwallet=${wallet}\ncode=${code}\nts=${ts}`;

const EMPTY = () => ({ version: 1, wallets: {}, codes: {}, bindings: {} });
export function load(file) {
  // Only "no file yet" is an empty book. Any other failure (unreadable, corrupt) must stop the caller: answering with
  // an empty book would let the next save() wipe every binding.
  let text; try { text = fs.readFileSync(file, "utf8"); } catch (e) { if (e?.code === "ENOENT") return EMPTY(); throw e; }
  return { ...EMPTY(), ...JSON.parse(text) };
}
/** Atomic write: a crash mid-write must never leave a truncated file behind. */
export function save(file, db) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(db, null, 1)); fs.renameSync(tmp, file);
}

/** The wallet's code, created on first use. Returns { code, created }. */
export function ensureCode(db, wallet, now = Date.now()) {
  const w = db.wallets[wallet]; if (w) return { code: w.code, created: false };
  let code; for (let len = 6; ; len++) { code = codeFor(wallet, len); if (!db.codes[code] || db.codes[code] === wallet) break; }
  db.wallets[wallet] = { code, createdAt: new Date(now).toISOString() }; db.codes[code] = wallet;
  return { code, created: true };
}
export const referrerOf = (db, code) => db.codes[normalizeCode(code)] ?? null;

/**
 * Bind `wallet` to `code`. Pure rule check; the caller verifies the signature and that this really is the wallet's
 * first bet (an open position and no settled history). Returns { ok } or { error }.
 */
export function bind(db, { wallet, code, cluster, now = Date.now() }) {
  code = normalizeCode(code);
  const referrer = db.codes[code];
  if (!referrer) return { error: "unknown referral code" };
  if (referrer === wallet) return { error: "you cannot refer yourself" };
  // no rings: if the code's owner is itself bound (directly or through others) to this wallet's code, the two would be
  // paying each other's rebates out of the treasury
  for (let r = db.bindings[referrer]?.referrer, hops = 0; r && hops < 64; r = db.bindings[r]?.referrer, hops++) if (r === wallet) return { error: "that wallet was referred by you: referrals cannot go in a circle" };
  const prev = db.bindings[wallet];
  if (prev) return prev.code === code ? { ok: true, already: true } : { error: "this wallet is already bound to another code" };
  db.bindings[wallet] = { code, referrer, at: new Date(now).toISOString(), cluster };
  return { ok: true };
}

/**
 * Earnings from settlement rows, in raw SKR units (bigint). `pointsOf(wallet)` gives the referrer's all-time points
 * for the tier. Returns { byWallet: Map(wallet → { referred: Set, raw, asReferrer, asReferee, rows }) }.
 */
export function earnings(rows, db, pointsOf = () => 0) {
  const byWallet = new Map();
  const entry = (w) => { let e = byWallet.get(w); if (!e) { e = { referred: new Set(), raw: 0n, asReferrer: 0n, asReferee: 0n, rows: 0 }; byWallet.set(w, e); } return e; };
  const add = (w, raw, role) => { if (raw <= 0n) return; const e = entry(w); e.raw += raw; e[role] += raw; e.rows++; };
  // every wallet that ever used a referrer's code counts as referred, fee or not
  for (const [w, b] of Object.entries(db.bindings)) entry(b.referrer).referred.add(w);
  for (const r of rows) {
    const b = db.bindings[r.owner]; if (!b) continue;
    // Only what settled after the binding counts: a binding (the file is shared across networks) never reaches back
    // over fees the wallet paid before it was invited.
    if (b.at && r.at && String(r.at) < String(b.at)) continue;
    let fee; try { fee = BigInt(r.fee ?? 0); } catch { continue; }
    if (fee <= 0n) continue;
    add(b.referrer, (fee * BigInt(tierBps(pointsOf(b.referrer)))) / 10000n, "asReferrer");
    add(r.owner, (fee * BigInt(REFEREE_BPS)) / 10000n, "asReferee");
  }
  return { byWallet };
}

// The payout ledger (referral-payouts.jsonl) is append-only and written around the send, not after it:
//   { status: "sent",    raw: N,  signature }  written BEFORE the transaction goes out (the signature is known first)
//   { status: "landed",  raw: 0,  signature }  once it is confirmed
//   { status: "void",    raw: -N, signature }  once its blockhash expired without it landing: the "sent" is cancelled
// Summing `raw` over every row is therefore what was really paid, whatever happened to the process in between; a
// "sent" without "landed"/"void" is settled by the next run from the chain (referral-payout.mjs reconcile).
export function readPayouts(file) {
  // Only "no file yet" is an empty ledger. A torn or corrupt line must stop the payout, not read as "nothing was ever
  // paid" — that would pay every rebate in history a second time.
  let text; try { text = fs.readFileSync(file, "utf8"); } catch (e) { if (e?.code === "ENOENT") return []; throw e; }
  return text.split("\n").filter(Boolean).map((l, i) => { try { return JSON.parse(l); } catch { throw new Error(`${file}: line ${i + 1} is not valid JSON; refusing to treat the payout ledger as empty`); } });
}
/** The payments that stand: sent rows whose signature was not voided. */
export function effectivePayouts(payouts) {
  const voided = new Set(payouts.filter((p) => p.status === "void").map((p) => p.signature));
  return payouts.filter((p) => (!p.status || p.status === "sent") && !voided.has(p.signature));
}
/** Sent rows the chain has not yet answered for. */
export const unsettledPayouts = (payouts) => { const done = new Set(payouts.filter((p) => p.status === "landed" || p.status === "void").map((p) => p.signature)); return payouts.filter((p) => p.status === "sent" && !done.has(p.signature)); };
/** earned − paid per wallet, as bigint raw units; entries ≤ 0 are dropped. */
export function pending(earn, payouts) {
  const paid = new Map();
  for (const p of payouts) paid.set(p.wallet, (paid.get(p.wallet) ?? 0n) + BigInt(p.raw));
  const out = [];
  for (const [wallet, e] of earn.byWallet) { const raw = e.raw - (paid.get(wallet) ?? 0n); if (raw > 0n) out.push({ wallet, raw }); }
  return out;
}
