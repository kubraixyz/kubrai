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

const { AnchorProvider, Program, BN, Wallet } = anchor;
const CLUSTER = process.env.CLUSTER ?? "devnet";
const RPC = process.env.CLUSTER_RPC ?? process.env.DEVNET_RPC ?? "http://127.0.0.1:8899";
const SNAP = process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots");
const SECRETS = process.env.KUBRAI_SECRETS ?? path.join(os.homedir(), "secrets", CLUSTER);
const DRY = process.env.DRY_RUN === "1";
const ONLY = (process.env.STEPS ?? "propose,finalize,settle").split(",");
const loadKp = (f) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8"))));
const proposer = loadKp(path.join(SECRETS, "proposer.json"));
const admin = fs.existsSync(process.env.ADMIN_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json")) ? loadKp(process.env.ADMIN_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json")) : null;
const conn = new Connection(RPC, "confirmed");
const provider = new AnchorProvider(conn, new Wallet(proposer), { commitment: "confirmed" });
const program = new Program(idlJson, provider);
const programId = program.programId;
const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
const vaultPda = (m) => PublicKey.findProgramAddressSync([Buffer.from("vault"), m.toBuffer()], programId)[0];
const tag = (b) => Buffer.from(b).toString("utf8").replace(/\0+$/, "");
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- metric evaluation from snapshot bundles ----------
const SOURCE = { skr_ids_week: "skr_ids_total", dapps_week: "dapp_store_active_apps", skr_staked_med7: "skr_staked", das_med7: "das", skr_price_close: "skr_price_usd_e8" };
const dayOf = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
const readDay = (day) => { const f = path.join(SNAP, day + ".json"); return fs.existsSync(f) ? { file: f, bundle: JSON.parse(fs.readFileSync(f, "utf8")), sha: fs.existsSync(f + ".sha256") ? fs.readFileSync(f + ".sha256", "utf8").trim() : null } : null; };
const valueOn = (day, src) => { const d = readDay(day); const v = d?.bundle?.metrics?.[src]?.value; return typeof v === "number" ? v : null; };
const shiftDay = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

function evaluate(metric, openTs, closeTs) {
  const src = SOURCE[metric]; if (!src) return { ok: false, reason: `unknown metric ${metric}` };
  const dClose = dayOf(closeTs), dOpen = dayOf(openTs);
  const used = [];
  if (metric.endsWith("_week")) {
    const a = valueOn(dOpen, src), b = valueOn(dClose, src);
    if (a == null || b == null) return { ok: false, reason: `missing snapshot ${a == null ? dOpen : dClose}` };
    used.push(dOpen, dClose); return { ok: true, value: b - a, used, detail: { open: a, close: b } };
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
const evidenceHash = (used) => createHash("sha256").update(used.map((d) => `${d}:${readDay(d)?.sha ?? ""}`).join("\n")).digest();

// ---------- on-chain steps ----------
async function propose(markets, now) {
  for (const { publicKey, account: m } of markets) {
    if (m.status !== 0 || now < m.resolveAfterTs.toNumber()) continue;
    const metric = tag(m.metric);
    const ev = evaluate(metric, m.openTs.toNumber(), m.closeTs.toNumber());
    if (!ev.ok) { log(`market #${m.id} (${metric}): cannot resolve yet — ${ev.reason}`); continue; }
    const outcome = ev.value >= m.threshold.toNumber() ? 1 : 2;
    log(`market #${m.id} (${metric}): observed ${ev.value} vs threshold ${m.threshold} → ${outcome === 1 ? "YES" : "NO"}`, JSON.stringify(ev.detail), "days", ev.used.join(","));
    if (DRY) continue;
    const sig = await program.methods.proposeResolution(outcome, new BN(ev.value), Array.from(evidenceHash(ev.used)))
      .accounts({ config: configPda, market: publicKey, proposer: proposer.publicKey }).rpc();
    fs.writeFileSync(path.join(SNAP, `resolution-${m.id}.json`), JSON.stringify({ market: publicKey.toBase58(), id: m.id.toNumber(), metric, threshold: m.threshold.toString(), observed: ev.value, outcome, days: ev.used, detail: ev.detail, evidenceHash: evidenceHash(ev.used).toString("hex"), signature: sig, at: new Date().toISOString() }, null, 2));
    log(`  proposed ${sig}`);
  }
}
async function finalize(markets, now, cfg) {
  for (const { publicKey, account: m } of markets) {
    if (m.status !== 1) continue;
    const ready = now >= m.proposedAt.toNumber() + cfg.disputeWindowSecs.toNumber();
    if (!ready) { log(`market #${m.id}: in dispute window until ${new Date((m.proposedAt.toNumber() + cfg.disputeWindowSecs.toNumber()) * 1000).toISOString()}`); continue; }
    if (DRY) { log(`market #${m.id}: would finalize`); continue; }
    const sig = await program.methods.finalize().accounts({ config: configPda, market: publicKey, signer: proposer.publicKey }).rpc();
    log(`market #${m.id}: finalized ${sig}`);
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
          const sig = await program.methods.settlePosition().accounts({ market: publicKey, position: ppk, payer: p.payer, vault: vaultPda(publicKey), ownerToken, cranker: proposer.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
          log(`  settled ${p.owner.toBase58()} ${sig}`);
        } catch (e) { log(`  FAILED ${p.owner.toBase58()}: ${e.message?.split("\n")[0]}`); }
      }
    }
    const fresh = await program.account.market.fetch(publicKey);
    if (fresh.positionsOpen === 0 && fresh.status !== 4 && !DRY) {
      try {
        const sig = await program.methods.sweep().accounts({ config: configPda, market: publicKey, vault: vaultPda(publicKey), treasury: cfg.treasury, signer: proposer.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
        log(`market #${m.id}: swept ${sig}`);
      } catch (e) { log(`market #${m.id}: sweep failed: ${e.message?.split("\n")[0]}`); }
    }
  }
}

const cfg = await program.account.config.fetch(configPda);
const markets = await program.account.market.all();
const now = Math.floor(Date.now() / 1000);
log(`cluster=${CLUSTER} markets=${markets.length} proposer=${proposer.publicKey.toBase58()} dry=${DRY} steps=${ONLY.join(",")}`);
if (ONLY.includes("propose")) await propose(markets, now);
if (ONLY.includes("finalize")) await finalize(await program.account.market.all(), now, cfg);
if (ONLY.includes("settle")) await settle(await program.account.market.all(), cfg);
log("done");
