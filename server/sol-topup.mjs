// SOL is what the system burns (transaction fees, market rent that comes back late, the odd token account opened for a
// user), never something it earns: fees arrive in SKR. So the hot wallets are refilled from one funding wallet the
// operator keeps topped up by hand (it needs well under 0.2 SOL a month on mainnet): when a wallet is below its floor
// it is refilled to its target, never more than MAX_PER_RUN in one run, and the operator is paged when the funding
// wallet itself runs low. Runs daily from cron. DRY_RUN=1 only prints.
// Env: CLUSTER, CLUSTER_RPC, KUBRAI_SECRETS (proposer.json, faucet.json), FUNDING_KEYPAIR (the wallet that pays;
//      on devnet the admin/deployer key, on mainnet a plain SOL wallet the operator refills), TARGETS (optional JSON).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { notify } from "./notify.mjs";
import { sendSigned } from "./tx.mjs";

const CLUSTER = process.env.CLUSTER ?? "devnet";
const RPC = process.env.CLUSTER_RPC ?? process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const SECRETS = process.env.KUBRAI_SECRETS ?? path.join(os.homedir(), "secrets", CLUSTER);
const DRY = process.env.DRY_RUN === "1";
const LAMPORTS = 1e9;
export const sol = (x) => BigInt(Math.round(Number(x) * LAMPORTS));
export const fmtSol = (l) => (Number(l) / LAMPORTS).toFixed(3);
export const DEFAULTS = {
  proposer: { floor: sol(0.3), target: sol(1) },      // opens, resolves and sweeps every market
  faucet: { floor: sol(0.5), target: sol(3) },        // devnet only: hands out 0.05 SOL per new wallet
  maxPerRun: sol(3),                                  // a wrong balance reading cannot drain the funding wallet
  fundingFloor: sol(1),                               // below this the operator is told to refill
};
/** Pure plan: which wallets to refill and by how much, proposer first, capped at maxPerRun. */
export function topUpPlan(balances, cfg = DEFAULTS) {
  const plan = [];
  for (const who of ["proposer", "faucet"]) { const b = balances[who]; if (b == null || !cfg[who]) continue; if (b < cfg[who].floor) plan.push({ who, lamports: cfg[who].target - b }); }
  let left = cfg.maxPerRun;
  for (const p of plan) { p.lamports = p.lamports < left ? p.lamports : left; left -= p.lamports; }
  return plan.filter((p) => p.lamports > 0n);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const loadKp = (f) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8"))));
  const fundingFile = process.env.FUNDING_KEYPAIR; if (!fundingFile) { console.error("FUNDING_KEYPAIR required"); process.exit(2); }
  const funding = loadKp(fundingFile);
  const wallets = { proposer: loadKp(path.join(SECRETS, "proposer.json")).publicKey };
  if (CLUSTER !== "mainnet" && fs.existsSync(path.join(SECRETS, "faucet.json"))) wallets.faucet = loadKp(path.join(SECRETS, "faucet.json")).publicKey;
  const cfg = process.env.TARGETS ? { ...DEFAULTS, ...JSON.parse(process.env.TARGETS, (k, v) => (typeof v === "number" && k !== "" ? sol(v) : v)) } : DEFAULTS;
  const conn = new Connection(RPC, "confirmed");
  const log = (...a) => console.log(new Date().toISOString(), ...a);
  const balances = {}; for (const [who, pk] of Object.entries(wallets)) balances[who] = BigInt(await conn.getBalance(pk));
  const fundingBal = BigInt(await conn.getBalance(funding.publicKey));
  const plan = topUpPlan(balances, cfg);
  log(`cluster=${CLUSTER} funding=${funding.publicKey.toBase58()} ${fmtSol(fundingBal)} SOL · ${Object.entries(balances).map(([w, b]) => `${w} ${fmtSol(b)}`).join(" · ")} · plan ${plan.length ? plan.map((p) => `${p.who} +${fmtSol(p.lamports)}`).join(", ") : "nothing"}${DRY ? " DRY RUN" : ""}`);
  const need = plan.reduce((a, p) => a + p.lamports, 0n);
  if (need > 0n && fundingBal - need < sol(0.05)) { log("funding wallet cannot cover the plan"); await notify("⛔ 補油錢包沒錢了", `${CLUSTER} 補油錢包 ${funding.publicKey.toBase58()} 只剩 ${fmtSol(fundingBal)} SOL,要補 ${fmtSol(need)}。請轉 SOL 進去,proposer 沒油就不能開盤/結算。`, "topup-empty", 12 * 60); process.exit(1); }
  for (const p of plan) {
    if (DRY) continue;
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: funding.publicKey, toPubkey: wallets[p.who], lamports: Number(p.lamports) }));
    try { const { sig, landed } = await sendSigned(conn, tx, [funding]); log(`${p.who} +${fmtSol(p.lamports)} SOL ${landed ? "landed" : "did not land"} ${sig}`); }
    catch (e) { log(`${p.who} transfer FAILED: ${String(e?.message ?? e).slice(0, 160)}`); await notify("⚠️ 補油失敗", `${CLUSTER} ${p.who} +${fmtSol(p.lamports)} SOL:${String(e?.message ?? e).slice(0, 160)}`, "topup-fail", 60); }
  }
  if (fundingBal - need < cfg.fundingFloor) await notify("ℹ️ 補油錢包快見底", `${CLUSTER} 補油錢包剩 ${fmtSol(fundingBal - need)} SOL(門檻 ${fmtSol(cfg.fundingFloor)})。有空轉一點進 ${funding.publicKey.toBase58()}。`, "topup-low", 24 * 60);
  log("done");
}
