// Opens the scheduled markets (server/market-templates.json) right after the 00:05 UTC snapshot.
//   daily templates every day, weekly templates on Mondays; closes at the next 00:00 UTC / next Monday 00:00 UTC.
// Baseline = today's T00 snapshot. Thresholds = quantiles of the metric's own history when enough windows exist,
// else the template's seed ("baseline" = yes/no at the opening value). Idempotent: skips a metric that already has
// an open market with the same close time. Signs with the admin wallet (devnet); on mainnet this becomes a Squads proposal.
//   env: ANCHOR_PROVIDER_URL, ANCHOR_WALLET, SNAPSHOT_DIR, DRY_RUN=1, FORCE_DAY=YYYY-MM-DD (testing), TEMPLATES=path
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { windowValues, quantileThresholds, parseMetric, valueIn } from "./history.mjs";

const { BN } = anchor;
const SNAP = process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots");
const DRY = process.env.DRY_RUN === "1";
const tpl = JSON.parse(fs.readFileSync(process.env.TEMPLATES ?? new URL("./market-templates.json", import.meta.url), "utf8"));
const idl = JSON.parse(fs.readFileSync(new URL("../idl/kubrai.json", import.meta.url), "utf8"));
const provider = anchor.AnchorProvider.env(); anchor.setProvider(provider);
const program = new anchor.Program(idl, provider);
const signer = provider.wallet.publicKey;
const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const tag = (b) => Buffer.from(b).toString("utf8").replace(/\0+$/, "");

const today = process.env.FORCE_DAY ?? new Date().toISOString().slice(0, 10);
const t0 = Date.parse(today + "T00:00:00Z");
const isMonday = new Date(t0).getUTCDay() === 1;
const closeFor = (cadence) => Math.floor((cadence === "day" ? t0 + 864e5 : t0 + ((8 - new Date(t0).getUTCDay()) % 7 || 7) * 864e5) / 1000);
const baseSlot = today + "T00";
// The baseline must be the same reading that closes yesterday's markets, so wait for the 00:05 snapshot to land
// (cron starts us at 00:06; the file usually appears within a minute or two). Give up after WAIT_MIN minutes.
const findBase = () => [path.join(SNAP, baseSlot + ".json"), path.join(SNAP, today + ".json")].find((f) => fs.existsSync(f) && fs.existsSync(f + ".sha256"));
let baseFile = findBase(); const deadline = Date.now() + Number(process.env.WAIT_MIN ?? 20) * 60e3;
while (!baseFile && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 10e3)); baseFile = findBase(); }
if (!baseFile) { log(`no snapshot for ${baseSlot} after waiting; nothing opened`); try { const { notify } = await import("./notify.mjs"); await notify(`Markets NOT opened ${today}`, `snapshot ${baseSlot} never appeared`, "open-markets-fail", 0); } catch {} process.exit(1); }
const baseBundle = JSON.parse(fs.readFileSync(baseFile, "utf8"));

const cfg = await program.account.config.fetch(configPda);
const existing = (await program.account.market.all([{ dataSize: program.account.market.size }])).map(({ account: m }) => ({ metric: tag(m.metric), closeTs: m.closeTs.toNumber(), status: m.status, id: m.id.toNumber() }));
const opened = [], skipped = [];
for (const t of tpl.templates) {
  const cadence = t.cadence; if (cadence === "week" && !isMonday && process.env.FORCE_WEEKLY !== "1") continue;
  const spec = parseMetric(t.metric); if (!spec) { skipped.push(`${t.metric}: unknown metric`); continue; }
  const closeTs = closeFor(cadence);
  if (existing.some((m) => m.metric === t.metric && m.closeTs === closeTs)) { skipped.push(`${t.metric}: already open for ${new Date(closeTs * 1000).toISOString()}`); continue; }
  const baseline = valueIn(baseBundle, spec.src); if (baseline == null) { skipped.push(`${t.metric}: ${baseSlot} has no ${spec.src}`); continue; }
  // thresholds
  let thresholds, how;
  const hist = windowValues(t.metric, SNAP).map((w) => w.value);
  if (hist.length >= (tpl.minWindows ?? 8) && t.buckets > 1) { thresholds = quantileThresholds(hist, t.buckets); how = `quantiles of ${hist.length} windows`; }
  else if (t.seed === "baseline") { thresholds = [baseline]; how = "yes/no at opening value"; }
  else { thresholds = t.seed; how = `seed (${hist.length} windows of history so far)`; }
  if (spec.kind === "med" && t.seed !== "baseline" && thresholds === t.seed) { skipped.push(`${t.metric}: level metric needs 'baseline' seed`); continue; }
  const nBuckets = thresholds.length + 1; if (nBuckets < 2 || nBuckets > 8) { skipped.push(`${t.metric}: bad bucket count`); continue; }
  const id = (await program.account.config.fetch(configPda)).marketCount;
  const [market] = PublicKey.findProgramAddressSync([Buffer.from("market"), id.toArrayLike(Buffer, "le", 8)], program.programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], program.programId);
  const openTs = Math.floor(Date.now() / 1000);
  const thrArr = Array.from({ length: 7 }, (_, i) => new BN(thresholds[i] ?? 0));
  const metricBytes = Array.from(Buffer.from(t.metric.padEnd(32, "\0").slice(0, 32)));
  const qhash = Array.from(createHash("sha256").update(t.question).digest());
  log(`${DRY ? "would open" : "opening"} #${id} ${t.metric} (${cadence}) thresholds ${thresholds.join("/")} [${how}] baseline ${baseline} close ${new Date(closeTs * 1000).toISOString()} seed ${t.seedSkr} SKR`);
  if (DRY) { opened.push({ id: id.toNumber(), metric: t.metric, dry: true }); continue; }
  try {
    await program.methods.createMarket({ metric: metricBytes, questionHash: qhash, thresholds: thrArr, nBuckets, openTs: new BN(openTs), closeTs: new BN(closeTs), resolveAfterTs: new BN(closeTs), baseline: new BN(baseline) })
      .accounts({ config: configPda, market, vault, mint: cfg.mint, signer, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
    if (t.seedSkr > 0) {
      const funderToken = getAssociatedTokenAddressSync(new PublicKey(cfg.mint), signer);
      await program.methods.seedMarket(new BN(Math.round(t.seedSkr * 1_000_000))).accounts({ market, vault, funderToken, funder: signer, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
    }
    fs.appendFileSync(path.join(SNAP, "markets-opened.jsonl"), JSON.stringify({ at: new Date().toISOString(), id: id.toNumber(), market: market.toBase58(), metric: t.metric, cadence, question: t.question, thresholds, nBuckets, baseline, baselineSlot: baseSlot, openTs, closeTs, seedSkr: t.seedSkr, how }) + "\n");
    opened.push({ id: id.toNumber(), metric: t.metric });
  } catch (e) { skipped.push(`${t.metric}: create failed: ${String(e?.message ?? e).split("\n")[0]}`); }
}
log(`opened ${opened.length}: ${opened.map((o) => `#${o.id} ${o.metric}`).join(", ") || "-"}`);
for (const s of skipped) log("skipped", s);
if (!DRY) { try { const { notify } = await import("./notify.mjs"); await notify(`Markets opened ${today}: ${opened.length}`, [...opened.map((o) => `#${o.id} ${o.metric}`), ...skipped.map((s) => "skip " + s)].join("\n").slice(0, 1500), "open-markets", 0); } catch {} }
