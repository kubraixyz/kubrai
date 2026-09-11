// Daily snapshot: fetch every metric, write snapshots/YYYY-MM-DD.json, and
// (when a funded memo key exists) publish sha256(bundle) as a memo tx so the
// bundle cannot be edited after the fact.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { METRICS } from "./metrics.mjs";

const OUT = process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots");
const CLUSTER = process.env.CLUSTER ?? "devnet";
const SECRETS = process.env.KUBRAI_SECRETS ?? path.join(os.homedir(), "secrets", CLUSTER);
const MEMO_RPC = process.env.MEMO_RPC;
if (!MEMO_RPC && process.env.MEMO_DISABLED !== "1") { console.error("MEMO_RPC is required (or MEMO_DISABLED=1 for a dry run): refusing to record an unanchored snapshot"); process.exit(2); }
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const day = process.env.SNAPSHOT_DAY ?? new Date().toISOString().slice(0, 10);

fs.mkdirSync(OUT, { recursive: true });
const bundle = { day, takenAt: new Date().toISOString(), metrics: {}, errors: {} };
for (const [name, fn] of Object.entries(METRICS)) {
  try { bundle.metrics[name] = await fn(); console.log(`${name}: ${bundle.metrics[name].value}`); }
  catch (e) { bundle.errors[name] = String(e?.message ?? e); console.error(`${name}: FAILED ${bundle.errors[name]}`); }
}
if (Object.keys(bundle.errors).length && process.env.MEMO_DISABLED !== "1") {
  try { const { notify } = await import("./notify.mjs"); await notify(`Snapshot ${day}: ${Object.keys(bundle.errors).length} metric(s) failed`, Object.entries(bundle.errors).map(([k, v]) => `${k}: ${v}`).join("\n").slice(0, 1500), "snapshot-fail", 0); } catch (e) { console.error("notify failed:", e?.message ?? e); }
}
const canonical = JSON.stringify(bundle);
const hash = createHash("sha256").update(canonical).digest("hex");
const file = path.join(OUT, `${day}.json`);
fs.writeFileSync(file, canonical);
fs.writeFileSync(file + ".sha256", hash + "\n");
console.log("wrote", file, "sha256", hash);

// memo (optional)
const keyFile = path.join(SECRETS, "proposer.json");
if (process.env.MEMO_DISABLED !== "1") {
  if (!fs.existsSync(keyFile)) { console.error("memo key missing at " + keyFile); process.exit(2); }
  try {
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyFile, "utf8"))));
    const conn = new Connection(MEMO_RPC, "confirmed");
    if ((await conn.getBalance(kp.publicKey)) < 10_000) throw new Error("memo key unfunded");
    const memo = `kubrai-snapshot v1 ${day} sha256=${hash}`;
    const ix = new TransactionInstruction({ keys: [{ pubkey: kp.publicKey, isSigner: true, isWritable: false }], programId: MEMO_PROGRAM, data: Buffer.from(memo, "utf8") });
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [kp], { commitment: "confirmed" });
    fs.writeFileSync(file + ".memo", JSON.stringify({ cluster: /devnet/.test(MEMO_RPC) ? "devnet" : "mainnet", signature: sig, memo }) + "\n"); // never persist the RPC URL (it can carry an API key)
    console.log("memo tx", sig);
  } catch (e) { console.error("memo FAILED:", e?.message ?? e); process.exit(3); }
}
