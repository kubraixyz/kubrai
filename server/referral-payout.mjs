// Pay out referral earnings (referrals.mjs): everything earned in settlements.jsonl minus what referral-payouts.jsonl
// already records, per wallet, in SKR from the rebate wallet's token account.
// Run weekly from cron. DRY_RUN=1 only prints.
// Env: CLUSTER, CLUSTER_RPC, SNAPSHOT_DIR (the data dir), KUBRAI_SECRETS (for devnet.json → mint),
//      REBATE_KEYPAIR (the wallet whose SKR account pays: on devnet the admin, whose ATA is the treasury; on mainnet a
//      Squads spending-limit member that may only move the weekly rebate budget).
//
// Money is never sent twice: every payment is written to the ledger as "sent" before it leaves this process, with the
// signature it will carry, and settled as "landed" or "void" afterwards (referrals.mjs describes the rows). A run that
// died between the two is finished first thing on the next run, by asking the chain what became of the signature.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { leaderboard, readSettlements } from "./points.mjs";
import * as referrals from "./referrals.mjs";
import { notify } from "./notify.mjs";
import { sendSigned, signatureStatus } from "./tx.mjs";
import { provenRows } from "./settlement-proof.mjs";

const CLUSTER = process.env.CLUSTER ?? "devnet";
const RPC = process.env.CLUSTER_RPC ?? process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const DATA = process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots");
const SECRETS = process.env.KUBRAI_SECRETS ?? path.join(os.homedir(), "secrets", CLUSTER);
const REFERRALS_FILE = process.env.REFERRALS_FILE ?? path.join(DATA, "referrals.json");
const LEDGER = path.join(DATA, "referral-payouts.jsonl");
const DRY = process.env.DRY_RUN === "1";
const DECIMALS = 6;
const MIN_RAW = BigInt(process.env.REFERRAL_MIN_RAW ?? 10_000);            // 0.01 SKR: below this the transfer is not worth a signature
// A wallet that holds no SKR account yet gets one opened (the payer covers the rent) only once its rebate reaches this
// much; until then it stays owed and keeps growing.
const OPEN_ACCOUNT_RAW = BigInt(process.env.REBATE_OPEN_ACCOUNT_RAW ?? 5_000_000);   // 5 SKR
// One run never sends more than this. Rebates are a share of a week's fees; a run that wants more is a mistake or an
// attack, and a human looks first.
const MAX_RUN_RAW = BigInt(process.env.REBATE_MAX_RUN_RAW ?? 5_000_000_000);       // 5,000 SKR
const keyFile = process.env.REBATE_KEYPAIR; if (!keyFile) { console.error("REBATE_KEYPAIR required"); process.exit(2); }
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyFile, "utf8"))));
const mint = new PublicKey(JSON.parse(fs.readFileSync(path.join(SECRETS, "devnet.json"), "utf8")).mint);
const conn = new Connection(RPC, "confirmed");
const log = (...a) => console.log(new Date().toISOString(), ...a);
const ui = (raw) => (Number(raw) / 10 ** DECIMALS).toLocaleString("en-US", { maximumFractionDigits: 2 });
process.on("unhandledRejection", (e) => { console.error("unhandled:", String(e?.message ?? e).slice(0, 200)); });
const ledger = (row) => fs.appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), cluster: CLUSTER, ...row }) + "\n");

// 1. reconcile: "sent" rows of an earlier run that never got their "landed" / "void"
let payouts = referrals.readPayouts(LEDGER);
// Only an answer from the chain settles a row: "confirmed" lands it, "failed" voids it. No record at all is NOT
// "never landed" — a node without full history says the same of a transaction that did land, and voiding on that
// would pay the rebate twice. Such a row stays "sent" (counted as paid) until the chain answers.
const unanswered = [];
for (const p of referrals.unsettledPayouts(payouts)) {
  if (DRY) { log("unsettled from an earlier run (DRY RUN, not touched):", p.signature); continue; }
  const st = await signatureStatus(conn, p.signature);
  if (st === "confirmed") { ledger({ status: "landed", wallet: p.wallet, raw: "0", signature: p.signature }); log("reconciled: landed", p.signature); }
  else if (st === "failed") { ledger({ status: "void", wallet: p.wallet, raw: (-BigInt(p.raw)).toString(), signature: p.signature, why: "failed on-chain" }); log("reconciled: void (failed on-chain)", p.signature); }
  else { unanswered.push(p); log("reconciled: no record on this RPC yet — held as paid, asked again next run", p.signature); }
}
for (const p of unanswered) await notify("⚠️ 推廣回饋:一筆付款鏈上查無紀錄", `${CLUSTER} ${p.wallet?.slice(0, 6)}… ${ui(p.raw)} SKR\n簽章 ${p.signature}\nRPC 說沒有這筆(可能沒落地,也可能節點沒歷史)。先當作已付、不重付;每週再問。若 explorer 也查無且已過一週,在帳本補一列 status=void 才會重付。`, `payout-unanswered:${p.signature}`, 7 * 24 * 60);
payouts = referrals.readPayouts(LEDGER);

// 2. what is due. Rows that move money (a bound wallet's fee) and rows that set how much (a referrer's own rows decide
//    its tier) are both proven against the chain; rows of wallets that are neither pass through, they change nothing.
const db = referrals.load(REFERRALS_FILE);
const referrers = new Set(Object.values(db.bindings).map((b) => b.referrer));
const earns = (r) => { if (referrers.has(r.owner)) return true; const b = db.bindings[r.owner]; if (!b) return false; try { return BigInt(r.fee ?? 0) > 0n; } catch { return false; } };
const proof = await provenRows(conn, readSettlements(DATA), { cacheFile: path.join(DATA, "settlement-proofs.json"), wanted: earns, mint: mint.toBase58(), log });
const rows = proof.ok;
if (proof.unknown.length) log(`held back: ${proof.unknown.length} settlement rows the chain could not be asked about (next run asks again)`);
if (proof.rejected.length && !DRY) await notify("⛔ 推廣回饋:結算列對不上鏈上", `${CLUSTER}: ${proof.rejected.length} 筆結算列在鏈上找不到對應的派彩事件,已排除不付。\n${proof.rejected.slice(0, 5).map((x) => `${x.row.owner?.slice(0, 6)}… #${x.row.id}: ${x.why}`).join("\n")}\n若不是 RPC 問題,代表 settlements.jsonl 被改過。`, "referral-proof", 60);
const pts = new Map(leaderboard(rows).entries.map((e) => [e.wallet, e.points]));
const due = referrals.pending(referrals.earnings(rows, db, (w) => pts.get(w) ?? 0), payouts);
log(`cluster=${CLUSTER} payer=${payer.publicKey.toBase58()} pending=${due.length}${DRY ? " DRY RUN" : ""}`);

// 3. pay
let sent = 0, skipped = 0, failed = 0, rawSent = 0n;
const from = getAssociatedTokenAddressSync(mint, payer.publicKey);
for (const d of due) {
  const tag = `${d.wallet.slice(0, 6)}… ${ui(d.raw)} SKR`;
  if (d.raw < MIN_RAW) { skipped++; continue; }
  if (DRY) { log("would pay", tag); continue; }
  try {
    const to = getAssociatedTokenAddressSync(mint, new PublicKey(d.wallet));
    if (!(await conn.getAccountInfo(to)) && d.raw < OPEN_ACCOUNT_RAW) { log(`waits (no SKR account yet; opened once the rebate reaches ${ui(OPEN_ACCOUNT_RAW)} SKR)`, tag); skipped++; continue; }
    if (rawSent + d.raw > MAX_RUN_RAW) { log(`STOPPED: this run would pass ${ui(MAX_RUN_RAW)} SKR`, tag); failed++; await notify("⛔ 推廣回饋超過單次上限,已停", `${CLUSTER}: 本輪已付 ${ui(rawSent)} SKR,下一筆 ${tag} 會超過上限 ${ui(MAX_RUN_RAW)} SKR。確認沒問題再用 REBATE_MAX_RUN_RAW 調高重跑。`, "referral-cap", 60); break; }
    const bal = await conn.getTokenAccountBalance(from).then((r) => BigInt(r.value.amount)).catch(() => 0n);
    if (bal < d.raw) { log("FAILED (rebate wallet short)", tag, `have ${ui(bal)}`); failed++; continue; }
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, to, new PublicKey(d.wallet), mint),
      createTransferCheckedInstruction(from, mint, to, payer.publicKey, d.raw, DECIMALS),
    );
    const row = { wallet: d.wallet, ui: Number(d.raw) / 10 ** DECIMALS };
    let sig = null, landed = false;
    try {
      ({ sig, landed } = await sendSigned(conn, tx, [payer], { beforeSend: (s) => { sig = s; ledger({ status: "sent", ...row, raw: d.raw.toString(), signature: s }); } }));
    } catch (e) {
      // sent (the row exists) but the outcome is unknown: leave it for the next run's reconcile rather than guess
      if (sig === null) throw e;
      log("UNSETTLED (next run asks the chain)", tag, sig, String(e?.message ?? e).slice(0, 120)); failed++; continue;
    }
    if (landed) { ledger({ status: "landed", ...row, raw: "0", signature: sig }); log("paid", tag, sig); sent++; rawSent += d.raw; }
    else { ledger({ status: "void", ...row, raw: (-d.raw).toString(), signature: sig, why: "blockhash expired" }); log("did not land (voided, next run retries)", tag, sig); failed++; }
    await new Promise((r) => setTimeout(r, 1500));
  } catch (e) { log("FAILED", tag, String(e?.message ?? e).slice(0, 200)); failed++; }
}
log(`done: paid ${sent} (${ui(rawSent)} SKR), skipped ${skipped} (dust / no account yet), failed ${failed}`);
if (!DRY && (sent || failed)) await notify(failed ? "⚠️ 推廣回饋有失敗" : "💸 推廣回饋已發", `${CLUSTER}: 發 ${sent} 筆共 ${ui(rawSent)} SKR${failed ? `,失敗 ${failed} 筆(看 referral-payout.log)` : ""}`, "referral-payout", failed ? 5 : 1);
