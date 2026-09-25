// Independent check of every proposed result, run on a second machine (Tokyo) with its own hourly snapshots and the
// admin key. The app host proposes; this host re-derives the observed value from snapshots it took itself and compares
// the range the value falls in. Same range → nothing to do. Different range → the proposal is wrong or one host's data
// is: the market is voided (full refunds) and the operator is paged; nobody re-judges by hand (guardrails are
// automatic). No usable local data → a note only, unless the dispute window is about to close, in which case the
// unverified proposal is voided too (a result nobody could check must not pay out).
//
// Env: CLUSTER, CLUSTER_RPC, SNAPSHOT_DIR (this host's own bundles, taken with MEMO_DISABLED=1), ADMIN_KEYPAIR,
//      API (the app host's public API, for the proposal file), VOID_UNVERIFIED=1|0 (default 1), DRY_RUN=1.
// State: <SNAPSHOT_DIR>/verified.json remembers each (market, proposedAt) verdict so a proposal is judged once.
import fs from "node:fs";
import path from "node:path";
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import idlJson from "../idl/kubrai.json" with { type: "json" };
import { makeEvaluator } from "./evaluate.mjs";
import { notify } from "./notify.mjs";

const { AnchorProvider, Program, Wallet } = anchor;
const CLUSTER = process.env.CLUSTER ?? "devnet";
const RPC = process.env.CLUSTER_RPC ?? process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const SNAP = process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "verify-snapshots");
const API = process.env.API ?? (CLUSTER === "mainnet" ? "https://api.kubrai.xyz" : "https://api-devnet.kubrai.xyz");
const DRY = process.env.DRY_RUN === "1";
const VOID_UNVERIFIED = process.env.VOID_UNVERIFIED !== "0";
const UNVERIFIED_GRACE_SECS = 45 * 60;      // window closes within this and we still have no verdict → void
const STATE = path.join(SNAP, "verified.json");
const loadKp = (f) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8"))));
const admin = loadKp(process.env.ADMIN_KEYPAIR ?? path.join(process.env.HOME ?? "/root", "kubrai/secrets", CLUSTER, "admin.json"));
const conn = new Connection(RPC, "confirmed");
const program = new Program(idlJson, new AnchorProvider(conn, new Wallet(admin), { commitment: "confirmed" }));
const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
const tag = (b) => Buffer.from(b).toString("utf8").replace(/\0+$/, "");
const log = (...a) => console.log(new Date().toISOString(), ...a);
const { evaluate, slotOf } = makeEvaluator({ snapDir: SNAP, conn });
const earliestSlot = fs.readdirSync(SNAP).filter((f) => /^\d{4}-\d{2}-\d{2}(T\d{2})?\.json$/.test(f)).map((f) => f.slice(0, -5)).sort()[0] ?? null;
let state = {}; try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) { if (e?.code !== "ENOENT") throw e; }
const save = () => { const tmp = STATE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(state, null, 1)); fs.renameSync(tmp, STATE); };

/** Pure decision: what to do with a proposal given our own reading. */
export function comparisonAction(proposedBucket, ourBucket) {
  if (ourBucket == null) return "unknown";
  return proposedBucket === ourBucket ? "agree" : "void-mismatch";
}

async function voidMarket(publicKey, m, why) {
  if (DRY) { log(`market #${m.id}: would VOID (${why})`); return null; }
  const sig = await program.methods.voidMarket().accounts({ config: configPda, market: publicKey, admin: admin.publicKey }).rpc();
  log(`market #${m.id}: VOIDED ${sig} (${why})`); return sig;
}

const cfg = await program.account.config.fetch(configPda);
if (!cfg.admin.equals(admin.publicKey)) { log(`this key ${admin.publicKey.toBase58()} is not the admin (${cfg.admin.toBase58()}); voiding would fail — checking only`); }
const win = cfg.disputeWindowSecs.toNumber();
const markets = (await program.account.market.all([{ dataSize: program.account.market.size }])).filter((x) => x.account.status === 1);
const now = Math.floor(Date.now() / 1000);
log(`cluster=${CLUSTER} proposed=${markets.length} snapshots=${SNAP} dry=${DRY}`);
for (const { publicKey, account: m } of markets) {
  const key = `${m.id.toNumber()}:${m.proposedAt.toNumber()}`;
  if (state[key]?.final) continue;
  const metric = tag(m.metric), n = m.nBuckets, thr = m.thresholds.slice(0, n - 1).map((t) => t.toNumber());
  const proposedValue = m.proposedValue.toNumber(), proposedBucket = m.proposedOutcome;
  const closesAt = m.proposedAt.toNumber() + win;
  let ours = null, reason = null;
  try {
    const ev = evaluate(metric, m.openTs.toNumber(), m.closeTs.toNumber(), m.baseline.toNumber());
    if (ev.ok) ours = { value: ev.value, bucket: thr.filter((t) => ev.value >= t).length, detail: ev.detail };
    else reason = ev.reason;
  } catch (e) { reason = String(e?.message ?? e); }
  const action = comparisonAction(proposedBucket, ours?.bucket ?? null);
  const rec = { id: m.id.toNumber(), metric, proposedValue, proposedBucket, ours: ours ? { value: ours.value, bucket: ours.bucket } : null, reason, action, at: new Date().toISOString() };
  if (action === "agree") {
    log(`market #${m.id} (${metric}): agree — app host ${proposedValue} → ${proposedBucket}, ours ${ours.value} → ${ours.bucket}`);
    state[key] = { ...rec, final: true }; save(); continue;
  }
  if (action === "void-mismatch") {
    log(`market #${m.id} (${metric}): MISMATCH — app host ${proposedValue} → range ${proposedBucket}, ours ${ours.value} → range ${ours.bucket}`);
    const sig = await voidMarket(publicKey, m, "independent reading lands in another range");
    await notify("⛔ 結算核對不一致,已作廢退款", `${CLUSTER} #${m.id} ${metric}\n德國提案 ${proposedValue} → 格 ${proposedBucket}\n東京讀到 ${ours.value} → 格 ${ours.bucket}\n${sig ? `void tx ${sig}` : "(DRY RUN)"}\n兩台快照不同=其中一台的資料或主機有問題,先退款再查。`, `verify-mismatch:${key}`, 60);
    state[key] = { ...rec, final: !DRY, voidSig: sig }; save(); continue;
  }
  // unknown: nothing local to compare with. If this host has no snapshot from before the market opened, it simply
  // was not watching yet (first day, or an outage here): that is not evidence against the proposal, so only tell.
  // If it was watching and still cannot verify, a result nobody could check must not pay out.
  const left = closesAt - now;
  const covered = earliestSlot != null && earliestSlot <= slotOf(m.openTs.toNumber());
  if (left <= UNVERIFIED_GRACE_SECS && VOID_UNVERIFIED && covered) {
    log(`market #${m.id} (${metric}): still unverified ${Math.round(left / 60)} min before the window closes (${reason}) — voiding`);
    const sig = await voidMarket(publicKey, m, "could not be verified independently before the window closed");
    await notify("⚠️ 結算無法核對,窗關前已作廢退款", `${CLUSTER} #${m.id} ${metric}\n東京沒有可用的自家快照(${reason}),異議窗 ${Math.round(left / 60)} 分後關閉。沒人能核對的結果不派彩:已作廢、全額退款。\n${sig ? `void tx ${sig}` : "(DRY RUN)"}`, `verify-unverified:${key}`, 60);
    state[key] = { ...rec, final: !DRY, voidSig: sig }; save(); continue;
  }
  if (!covered && !state[key]) { log(`market #${m.id} (${metric}): not covered by this host's snapshots (earliest ${earliestSlot}) — cannot judge; app host's proposal stands`); state[key] = { ...rec, final: true, uncovered: true }; save(); continue; }
  if (!state[key]) { log(`market #${m.id} (${metric}): cannot verify yet — ${reason}`); if (now - m.proposedAt.toNumber() > 3600) await notify("ℹ️ 結算核對:東京還沒有資料", `${CLUSTER} #${m.id} ${metric}:提案 1 h 後東京仍無法核對(${reason})。窗關前 45 分仍沒答案會自動作廢退款。`, `verify-pending:${key}`, 180); state[key] = rec; save(); }
}
log("done");
