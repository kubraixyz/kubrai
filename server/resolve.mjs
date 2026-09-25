// Resolver + crank. Runs from cron; every step is idempotent and safe to re-run.
//   1. propose : for each Open market past resolve_after_ts, compute the metric from the
//                daily snapshot bundles, hash the evidence, and submit propose_resolution.
//   2. finalize: for each Proposed market whose dispute window elapsed, finalize.
//   3. settle  : for each Resolved/Voided market, settle every outstanding position
//                (winners paid, losers' rent refunded), then sweep the vault.
// Snapshots are hourly slots "YYYY-MM-DDTHH" (taken right after the hour); the older daily files "YYYY-MM-DD" count as that
// day's T00 slot. Metric tags:
//   <base>_day | <base>_week | rev_week:<app> | rev_day:<app>  -> value(close slot) - value(open slot)   (cumulative counters;
//        markets open exactly on the hour, so the open slot's snapshot is the baseline; a non-zero on-chain baseline
//        — manual markets created before 2026-09-12 — is used instead)
//   <base>_dmed | <base>_wmed  -> median of every hourly slot in (open, close], needs ≥75 % coverage   (levels)
//   legacy: *_med7 -> median of the 7 daily T00 slots ending at close (≥4);  skr_price_close -> value at close
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import idlJson from "../idl/kubrai.json" with { type: "json" };
import { APP_SLUGS } from "./metrics.mjs";
import { notify } from "./notify.mjs";

const { AnchorProvider, Program, BN, Wallet } = anchor;
const CLUSTER = process.env.CLUSTER ?? "devnet";
const RPC = process.env.CLUSTER_RPC ?? process.env.DEVNET_RPC ?? "http://127.0.0.1:8899";
const SNAP = process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots");
const SECRETS = process.env.KUBRAI_SECRETS ?? path.join(os.homedir(), "secrets", CLUSTER);
const DRY = process.env.DRY_RUN === "1";
const ONLY = (process.env.STEPS ?? "propose,finalize,settle,stale").split(",");
const STALE_VOID_SECS = 86_400;
const loadKp = (f) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8"))));
const proposer = loadKp(path.join(SECRETS, "proposer.json"));
// The admin key is only loaded for local/devnet test runs that explicitly ask for early finalization.
const adminFile = process.env.ADMIN_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json");
const admin = process.env.ADMIN_FINALIZE === "1" && fs.existsSync(adminFile) ? loadKp(adminFile) : null;
const conn = new Connection(RPC, "confirmed");
const provider = new AnchorProvider(conn, new Wallet(proposer), { commitment: "confirmed" });
const program = new Program(idlJson, provider);
const programId = program.programId;
const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
const vaultPda = (m) => PublicKey.findProgramAddressSync([Buffer.from("vault"), m.toBuffer()], programId)[0];
const tag = (b) => Buffer.from(b).toString("utf8").replace(/\0+$/, "");
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- metric evaluation from snapshot bundles ----------
// metric base → snapshot field. One source per metric — never fall back between counting bases inside a market.
const BASE = { sgt: "sgt_total", skr_ids: "skr_ids_onchain", dapps: "dapp_store_active_apps", reviews: "store_reviews_total", reviewers: "reviewers_7d", skr_staked: "skr_staked", das: "das", skr_price: "skr_price_usd_e8" };
const LEGACY = { skr_staked_med7: { kind: "med7", src: "skr_staked" }, das_med7: { kind: "med7", src: "das" }, skr_price_close: { kind: "close", src: "skr_price_usd_e8" } };
function parseMetric(metric) {
  if (LEGACY[metric]) return LEGACY[metric];
  let m = metric.match(/^rev_(week|day):(.+)$/); if (m) return APP_SLUGS[m[2]] ? { kind: "cum", src: "rev:" + m[2] } : null;
  m = metric.match(/^(.+)_(day|week|dmed|wmed)$/); if (!m || !BASE[m[1]]) return null;
  return { kind: m[2] === "day" || m[2] === "week" ? "cum" : "med", src: BASE[m[1]] };
}
const slotOf = (ts) => new Date(ts * 1000).toISOString().slice(0, 13);          // hour containing ts (UTC)
const slotFile = (slot) => { const h = path.join(SNAP, slot + ".json"); if (fs.existsSync(h)) return h; if (slot.endsWith("T00")) { const d = path.join(SNAP, slot.slice(0, 10) + ".json"); if (fs.existsSync(d)) return d; } return null; };
// A slot's bundle is only trusted if its bytes hash to the sidecar AND to the hash published on-chain.
const memoOk = new Map();
async function verifySlot(slot) {
  const f = slotFile(slot); if (!f) return { ok: false, reason: `no snapshot ${slot}` };
  const raw = fs.readFileSync(f); const sha = createHash("sha256").update(raw).digest("hex");
  const side = fs.existsSync(f + ".sha256") ? fs.readFileSync(f + ".sha256", "utf8").trim() : null;
  if (side !== sha) return { ok: false, reason: `snapshot ${slot} was modified after it was recorded (sha256 mismatch)` };
  if (!fs.existsSync(f + ".memo")) return { ok: false, reason: `snapshot ${slot} has no on-chain memo` };
  if (!memoOk.has(slot)) {
    const memo = JSON.parse(fs.readFileSync(f + ".memo", "utf8"));
    const tx = await conn.getTransaction(memo.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const logs = (tx?.meta?.logMessages ?? []).join("\n");
    memoOk.set(slot, !!tx && logs.includes(`sha256=${sha}`));
  }
  if (!memoOk.get(slot)) return { ok: false, reason: `on-chain memo for ${slot} does not match the file` };
  return { ok: true, sha };
}
const bundleCache = new Map();
const readSlot = (slot) => { if (!bundleCache.has(slot)) { const f = slotFile(slot); bundleCache.set(slot, f ? JSON.parse(fs.readFileSync(f, "utf8")) : null); } return bundleCache.get(slot); };
const valueAt = (slot, src) => {
  const b = readSlot(slot); if (!b) return null;
  if (src.startsWith("rev:")) { const v = b?.metrics?.dapp_reviews?.raw?.[src.slice(4)]?.reviews; return typeof v === "number" ? v : null; }
  const v = b?.metrics?.[src]?.value; return typeof v === "number" ? v : null;
};
const median = (vals) => { const s = [...vals].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : Math.floor((s[s.length / 2 - 1] + s[s.length / 2]) / 2); };
const addHours = (slot, n) => new Date(Date.parse(slot + ":00:00Z") + n * 3600e3).toISOString().slice(0, 13);

function evaluate(metric, openTs, closeTs, baseline) {
  const spec = parseMetric(metric); if (!spec) return { ok: false, reason: `unknown metric ${metric}` };
  const { kind, src } = spec; const sClose = slotOf(closeTs), sOpen = slotOf(openTs); const used = [];
  if (kind === "cum") {
    const b = valueAt(sClose, src); if (b == null) return { ok: false, reason: `missing snapshot ${sClose}` };
    let base = baseline, baseSlot = null;
    if (baseline === 0) { base = valueAt(sOpen, src); baseSlot = sOpen; if (base == null) return { ok: false, reason: `missing opening snapshot ${sOpen}` }; used.push(sOpen); }
    used.push(sClose);
    return { ok: true, value: b - base, used, detail: { baseline: base, baselineSlot: baseSlot ?? "on-chain", close: b, closeSlot: sClose } };
  }
  if (kind === "med") {
    const expected = Math.max(1, Math.round((closeTs - openTs) / 3600)); const vals = [];
    const series = [];
    for (let i = 1; i <= expected; i++) { const sl = addHours(sOpen, i); if (sl > sClose) break; const v = valueAt(sl, src); if (v != null) { vals.push(v); used.push(sl); series.push({ slot: sl, value: v }); } }
    const need = Math.ceil(expected * 0.75);
    if (vals.length < need) return { ok: false, reason: `only ${vals.length}/${expected} hourly snapshots (need ${need}) for the median` };
    return { ok: true, value: median(vals), used, detail: { samples: vals.length, expected, min: Math.min(...vals), max: Math.max(...vals), series } };
  }
  if (kind === "med7") {
    const vals = []; for (let i = 6; i >= 0; i--) { const sl = addHours(sClose, -24 * i); const v = valueAt(sl, src); if (v != null) { vals.push(v); used.push(sl); } }
    if (vals.length < 4) return { ok: false, reason: `only ${vals.length}/7 daily snapshots for median` };
    return { ok: true, value: median(vals), used, detail: { values: vals } };
  }
  const v = valueAt(sClose, src); if (v == null) return { ok: false, reason: `missing snapshot ${sClose}` };
  used.push(sClose); return { ok: true, value: v, used, detail: {} };
}
// Evidence hash = sha256 over the (verified) per-day bundle hashes, in the order used.
const evidenceHash = (used, shas) => createHash("sha256").update(used.map((d) => `${d}:${shas[d]}`).join("\n")).digest();

// Off-chain replica of compute_payout (same integer math) so we can record what each settlement paid.
function payoutFor(m, p) {
  const amounts = p.amounts.map((x) => BigInt(x.toString())), feeW = p.feeW.map((x) => BigInt(x.toString()));
  const total = amounts.reduce((a, b) => a + b, 0n);
  if (m.status === 3) return { payout: total, fee: 0n, kind: "refund" };
  const w = m.outcome; const pools = m.pools.map((x) => BigInt(x.toString()));
  const winPool = pools[w], losePool = pools.reduce((a, b) => a + b, 0n) - winPool, stake = amounts[w];
  if (winPool === 0n) return { payout: total, fee: 0n, kind: "refund" };
  if (stake === 0n) return { payout: 0n, fee: 0n, kind: "lost" };
  const gross = (losePool * stake) / winPool, fee = (gross * feeW[w]) / (stake * 10000n), seed = (BigInt(m.seedAmount.toString()) * stake) / winPool;
  return { payout: stake + gross - fee + seed, fee, kind: "won" };
}
const SETTLEMENTS = path.join(SNAP, "settlements.jsonl");

// ---------- on-chain steps ----------
async function propose(markets, now) {
  for (const { publicKey, account: m } of markets) {
   try {
    if (m.status !== 0 || now < m.resolveAfterTs.toNumber()) continue;
    const metric = tag(m.metric);
    const ev = evaluate(metric, m.openTs.toNumber(), m.closeTs.toNumber(), m.baseline.toNumber());
    if (!ev.ok) { log(`market #${m.id} (${metric}): cannot resolve yet — ${ev.reason}`); continue; }
    if (!Number.isInteger(ev.value)) { log(`market #${m.id}: observed value ${ev.value} is not an integer — refusing to propose`); continue; }
    const shas = {}; let bad = null;
    for (const d of ev.used) { const v = await verifySlot(d); if (!v.ok) { bad = v.reason; break; } shas[d] = v.sha; }
    if (bad) { log(`market #${m.id}: NOT proposing — ${bad}`); continue; }
    const n = m.nBuckets, thr = m.thresholds.slice(0, n - 1).map((t) => t.toNumber());
    const bucket = thr.filter((t) => ev.value >= t).length; // same rule as on-chain Market::bucket_of
    log(`market #${m.id} (${metric}): observed ${ev.value}; thresholds ${thr.join("/")} → bucket ${bucket} of ${n}`, JSON.stringify(ev.detail), "slots", ev.used.join(","));
    if (DRY) continue;
    const eh = evidenceHash(ev.used, shas);
    const sig = await program.methods.proposeResolution(new BN(ev.value), Array.from(eh))
      .accounts({ config: configPda, market: publicKey, proposer: proposer.publicKey }).rpc();
    fs.writeFileSync(path.join(SNAP, `resolution-${m.id}.json`), JSON.stringify({ market: publicKey.toBase58(), id: m.id.toNumber(), metric, thresholds: thr, nBuckets: n, observed: ev.value, bucket, slots: ev.used, slotSha256: shas, detail: ev.detail, evidenceHash: eh.toString("hex"), signature: sig, at: new Date().toISOString() }, null, 2));
    log(`  proposed ${sig}`);
   } catch (e) { log(`market #${m.id}: propose failed: ${e?.message?.split("\n")[0]}`); }
  }
}
async function finalize(markets, now, cfg) {
  for (const { publicKey, account: m } of markets) {
    if (m.status !== 1) continue;
    const ready = now >= m.proposedAt.toNumber() + cfg.disputeWindowSecs.toNumber();
    const adminEarly = process.env.ADMIN_FINALIZE === "1" && admin; // test networks only: admin may finalize inside the window
    if (!ready && !adminEarly) { log(`market #${m.id}: in dispute window until ${new Date((m.proposedAt.toNumber() + cfg.disputeWindowSecs.toNumber()) * 1000).toISOString()}`); continue; }
    if (DRY) { log(`market #${m.id}: would finalize`); continue; }
    const signer = ready ? proposer : admin;
    const sig = await program.methods.finalizeResolution().accounts({ config: configPda, market: publicKey, signer: signer.publicKey }).signers([signer]).rpc();
    log(`market #${m.id}: finalized ${sig}${ready ? "" : " (admin, inside dispute window)"}`);
  }
}
async function settle(markets, cfg) {
  const mint = cfg.mint;
  for (const { publicKey, account: m } of markets) {
    if (m.status !== 2 && m.status !== 3) continue;
    if (m.positionsOpen > 0) {
      // positions of this market: memcmp on the market pubkey (offset 8 = after discriminator)
      const positions = await program.account.position.all([{ memcmp: { offset: 8, bytes: publicKey.toBase58() } }]);
      log(`market #${m.id}: settling ${positions.length} positions`);
      for (const { publicKey: ppk, account: p } of positions) {
        if (DRY) continue;
        try {
          const ownerToken = (await getOrCreateAssociatedTokenAccount(conn, proposer, mint, p.owner)).address; // creates ATA if the owner closed it (rent paid by cranker)
          const fresh = await program.account.market.fetch(publicKey);
          const { payout, fee, kind } = payoutFor(fresh, p);
          const sig = await program.methods.settlePosition().accounts({ market: publicKey, position: ppk, payer: p.payer, vault: vaultPda(publicKey), ownerToken, cranker: proposer.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
          fs.appendFileSync(SETTLEMENTS, JSON.stringify({ at: new Date().toISOString(), market: publicKey.toBase58(), id: m.id.toNumber(), metric: tag(m.metric), owner: p.owner.toBase58(), amounts: p.amounts.slice(0, fresh.nBuckets).map((x) => x.toString()), status: fresh.status, outcome: fresh.outcome, observed: fresh.proposedValue.toString(), kind, payout: payout.toString(), fee: fee.toString(), signature: sig }) + "\n");
          log(`  settled ${p.owner.toBase58()} ${kind} payout=${payout} ${sig}`);
        } catch (e) { log(`  FAILED ${p.owner.toBase58()}: ${e.message?.split("\n")[0]}`); }
      }
    }
    const fresh = await program.account.market.fetch(publicKey);
    if (fresh.positionsOpen === 0 && fresh.status !== 4 && !DRY) {
      try {
        const sig = await program.methods.sweepMarket().accounts({ config: configPda, market: publicKey, vault: vaultPda(publicKey), treasury: cfg.treasury, rentDest: cfg.admin, signer: proposer.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
        log(`market #${m.id}: swept ${sig}`);
      } catch (e) { log(`market #${m.id}: sweep failed: ${e.message?.split("\n")[0]}`); }
    }
  }
}

// A market still Open a full day after resolve_after_ts had no verifiable evidence (every hour the resolver logged why).
// Rather than hold stakes forever, void it (proposer may, on-chain rule) so the next settle pass refunds everyone.
async function voidStale(markets, now) {
  for (const { publicKey, account: m } of markets) {
    if (m.status !== 0 || now < m.resolveAfterTs.toNumber() + STALE_VOID_SECS) continue;
    const metric = tag(m.metric);
    if (DRY) { log(`market #${m.id} (${metric}): would void as stale (no proposal ${Math.round((now - m.resolveAfterTs.toNumber()) / 3600)} h after resolve_after)`); continue; }
    try {
      const sig = await program.methods.voidStaleMarket().accounts({ config: configPda, market: publicKey, proposer: proposer.publicKey }).rpc();
      log(`market #${m.id} (${metric}): VOIDED as stale ${sig}`);
      await notify("⚠️ 盤子逾時作廢", `${CLUSTER} #${m.id} ${metric}:關盤後 24 h 仍無法提案(快照缺或驗不過,見 resolve.log),已作廢、下一輪全額退款。`, `stale:${m.id}`, 60);
    } catch (e) { log(`market #${m.id}: stale void failed: ${e?.message?.split("\n")[0]}`); }
  }
}

const cfg = await program.account.config.fetch(configPda);
const marketFilter = [{ dataSize: program.account.market.size }]; // ignores accounts from older layouts
const markets = await program.account.market.all(marketFilter);
const now = Math.floor(Date.now() / 1000);
log(`cluster=${CLUSTER} markets=${markets.length} proposer=${proposer.publicKey.toBase58()} dry=${DRY} steps=${ONLY.join(",")}`);
if (ONLY.includes("propose")) await propose(markets, now);
if (ONLY.includes("stale")) await voidStale(await program.account.market.all(marketFilter), now);
if (ONLY.includes("finalize")) await finalize(await program.account.market.all(marketFilter), now, cfg);
if (ONLY.includes("settle")) await settle(await program.account.market.all(marketFilter), cfg);
log("done");
