// Resolver + crank. Runs from cron; every step is idempotent and safe to re-run.
//   1. propose : for each Open market past resolve_after_ts, compute the metric from the
//                daily snapshot bundles, hash the evidence, and submit propose_resolution.
//   2. finalize: for each Proposed market whose dispute window elapsed, finalize.
//   3. settle  : for each Resolved/Voided market, settle every outstanding position
//                (winners paid, losers' rent refunded), then sweep the vault.
// Metrics:
//   *_week  -> value(day_close) - value(day_open)       (cumulative counters)
//   *_med7  -> median of the last 7 daily values ending at day_close   (levels)
//   skr_price_close -> value at day_close
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import idlJson from "../idl/kubrai.json" with { type: "json" };
import { APP_SLUGS } from "./metrics.mjs";

const { AnchorProvider, Program, BN, Wallet } = anchor;
const CLUSTER = process.env.CLUSTER ?? "devnet";
const RPC = process.env.CLUSTER_RPC ?? process.env.DEVNET_RPC ?? "http://127.0.0.1:8899";
const SNAP = process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots");
const SECRETS = process.env.KUBRAI_SECRETS ?? path.join(os.homedir(), "secrets", CLUSTER);
const DRY = process.env.DRY_RUN === "1";
const ONLY = (process.env.STEPS ?? "propose,finalize,settle").split(",");
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
// metric tag → snapshot field. skr_ids prefers the on-chain count and falls back to the aggregator.
// One source per metric — never fall back between counting bases inside a _week market.
const SOURCE = { skr_ids_week: ["skr_ids_onchain"], dapps_week: ["dapp_store_active_apps"], skr_staked_med7: ["skr_staked"], das_med7: ["das"], skr_price_close: ["skr_price_usd_e8"] };
const dayOf = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
// A day's bundle is only trusted if its bytes hash to the sidecar AND to the hash published on-chain.
const memoOk = new Map();
async function verifyDay(day) {
  const f = path.join(SNAP, day + ".json"); if (!fs.existsSync(f)) return { ok: false, reason: `no snapshot ${day}` };
  const raw = fs.readFileSync(f); const sha = createHash("sha256").update(raw).digest("hex");
  const side = fs.existsSync(f + ".sha256") ? fs.readFileSync(f + ".sha256", "utf8").trim() : null;
  if (side !== sha) return { ok: false, reason: `snapshot ${day} was modified after it was recorded (sha256 mismatch)` };
  if (!fs.existsSync(f + ".memo")) return { ok: false, reason: `snapshot ${day} has no on-chain memo` };
  if (!memoOk.has(day)) {
    const memo = JSON.parse(fs.readFileSync(f + ".memo", "utf8"));
    const tx = await conn.getTransaction(memo.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const logs = (tx?.meta?.logMessages ?? []).join("\n");
    memoOk.set(day, !!tx && logs.includes(`sha256=${sha}`));
  }
  if (!memoOk.get(day)) return { ok: false, reason: `on-chain memo for ${day} does not match the file` };
  return { ok: true, sha };
}
const readDay = (day) => { const f = path.join(SNAP, day + ".json"); return fs.existsSync(f) ? { file: f, bundle: JSON.parse(fs.readFileSync(f, "utf8")), sha: fs.existsSync(f + ".sha256") ? fs.readFileSync(f + ".sha256", "utf8").trim() : null } : null; };
const valueOn = (day, src) => {
  const d = readDay(day); if (!d) return null;
  if (src.startsWith("rev:")) { const v = d.bundle?.metrics?.dapp_reviews?.raw?.[src.slice(4)]?.reviews; return typeof v === "number" ? v : null; }
  for (const f of Array.isArray(src) ? src : [src]) { const v = d.bundle?.metrics?.[f]?.value; if (typeof v === "number") return v; }
  return null;
};
const shiftDay = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

function evaluate(metric, openTs, closeTs, baseline) {
  let src = SOURCE[metric];
  if (!src && metric.startsWith("rev_week:")) { const slug = metric.slice(9); if (!APP_SLUGS[slug]) return { ok: false, reason: `unknown app slug ${slug}` }; src = "rev:" + slug; }
  if (!src) return { ok: false, reason: `unknown metric ${metric}` };
  const dClose = dayOf(closeTs), dOpen = dayOf(openTs);
  const used = [];
  if (metric.endsWith("_week") || metric.startsWith("rev_week:")) {
    // Baseline is fixed on-chain at creation; the close value comes from the closing snapshot.
    const b = valueOn(dClose, src);
    if (b == null) return { ok: false, reason: `missing snapshot ${dClose}` };
    const a = valueOn(dOpen, src);
    used.push(dClose); if (a != null) used.push(dOpen);
    return { ok: true, value: b - baseline, used, detail: { baseline, close: b, openDaySnapshot: a, openDayDelta: a == null ? null : a - baseline } };
  }
  if (metric.endsWith("_med7")) {
    const vals = []; for (let i = 6; i >= 0; i--) { const d = shiftDay(dClose, -i); const v = valueOn(d, src); if (v != null) { vals.push(v); used.push(d); } }
    if (vals.length < 4) return { ok: false, reason: `only ${vals.length}/7 snapshots for median` };
    const s = [...vals].sort((x, y) => x - y); const med = s.length % 2 ? s[(s.length - 1) / 2] : Math.floor((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
    return { ok: true, value: med, used, detail: { values: vals } };
  }
  const v = valueOn(dClose, src); if (v == null) return { ok: false, reason: `missing snapshot ${dClose}` };
  used.push(dClose); return { ok: true, value: v, used, detail: {} };
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
    for (const d of ev.used) { const v = await verifyDay(d); if (!v.ok) { bad = v.reason; break; } shas[d] = v.sha; }
    if (bad) { log(`market #${m.id}: NOT proposing — ${bad}`); continue; }
    const n = m.nBuckets, thr = m.thresholds.slice(0, n - 1).map((t) => t.toNumber());
    const bucket = thr.filter((t) => ev.value >= t).length; // same rule as on-chain Market::bucket_of
    log(`market #${m.id} (${metric}): observed ${ev.value}; thresholds ${thr.join("/")} → bucket ${bucket} of ${n}`, JSON.stringify(ev.detail), "days", ev.used.join(","));
    if (DRY) continue;
    const eh = evidenceHash(ev.used, shas);
    const sig = await program.methods.proposeResolution(new BN(ev.value), Array.from(eh))
      .accounts({ config: configPda, market: publicKey, proposer: proposer.publicKey }).rpc();
    fs.writeFileSync(path.join(SNAP, `resolution-${m.id}.json`), JSON.stringify({ market: publicKey.toBase58(), id: m.id.toNumber(), metric, thresholds: thr, nBuckets: n, observed: ev.value, bucket, days: ev.used, daySha256: shas, detail: ev.detail, evidenceHash: eh.toString("hex"), signature: sig, at: new Date().toISOString() }, null, 2));
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

const cfg = await program.account.config.fetch(configPda);
const marketFilter = [{ dataSize: program.account.market.size }]; // ignores accounts from older layouts
const markets = await program.account.market.all(marketFilter);
const now = Math.floor(Date.now() / 1000);
log(`cluster=${CLUSTER} markets=${markets.length} proposer=${proposer.publicKey.toBase58()} dry=${DRY} steps=${ONLY.join(",")}`);
if (ONLY.includes("propose")) await propose(markets, now);
if (ONLY.includes("finalize")) await finalize(await program.account.market.all(marketFilter), now, cfg);
if (ONLY.includes("settle")) await settle(await program.account.market.all(marketFilter), cfg);
log("done");
