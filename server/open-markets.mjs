// Opens the scheduled daily markets (server/market-templates.json) for tomorrow's UTC day D. Runs from cron at 11:00 UTC.
//   Each market: bets from D−1 11:00 UTC to D 12:00 UTC, counts the whole of D (see the schedule note below).
// Thresholds = quantiles of the metric's own history when enough windows exist,
// else the template's seed ("baseline" = yes/no at the level when the market opens). Idempotent: skips a metric that
// already has a market with the same close time. Signs with the admin wallet (devnet); on mainnet this becomes a Squads proposal.
//   env: ANCHOR_PROVIDER_URL, ANCHOR_WALLET, SNAPSHOT_DIR, DRY_RUN=1, FORCE_DAY=YYYY-MM-DD (the counted day D), TEMPLATES=path
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { windowValues, quantileThresholds, parseMetric, valueIn, loadSlots, roundToDisplay, dailyReadTs, DAY_LOCK_SECS, DAY_OPEN_LEAD_SECS } from "./history.mjs";

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
// web3.js looks up a sent transaction's status from a promise nobody awaits. An RPC hiccup there ("failed to get
// signature status: Internal error", 2026-10-05 11:00 UTC) is an unhandled rejection, and Node ends the process on one:
// the first market of the day was opened and the other 18 never were. Such a rejection says nothing about the run, so
// it is noted and the run goes on; a create that really fails throws from .rpc() and is retried below.
process.on("unhandledRejection", (e) => log("ignored a rejection nobody awaited:", String(e?.message ?? e).split("\n")[0]));

// Schedule (SharePot's, since 2026-09-26): the market for UTC day D opens at D−1 11:00 UTC, stops taking bets at D 12:00
// UTC (halfway through D, so nobody bets having seen more than half of it) and counts the whole of D (history.mjs
// countedWindow). It is created by the 11:00 UTC run the day before, so tomorrow's pool is up an hour before today's
// locks. Cumulative markets carry baseline 0 on-chain: the resolver reads the T00 snapshots at both ends of D. Level
// yes/no markets need a threshold now, so they take the latest snapshot at opening.
const day = process.env.FORCE_DAY ?? new Date(Date.now() + 864e5).toISOString().slice(0, 10);   // D: tomorrow (UTC)
const dStart = Date.parse(day + "T00:00:00Z") / 1000;
const openTs = dStart - DAY_OPEN_LEAD_SECS, closeTs = dStart + DAY_LOCK_SECS;
const slots = loadSlots(SNAP); const latestSlot = [...slots.keys()].sort().at(-1);
const latestValue = (src) => (latestSlot ? valueIn(slots.get(latestSlot), src) : null);

const cfg = await program.account.config.fetch(configPda);
const readExisting = async () => (await program.account.market.all([{ dataSize: program.account.market.size }])).map(({ account: m }) => ({ metric: tag(m.metric), closeTs: m.closeTs.toNumber(), status: m.status, id: m.id.toNumber() }));
let existing = await readExisting();
const opened = [], skipped = [];
let nextId = null;   // market_count we expect after our last successful create
// A create can fail on a passing RPC error. Those markets get one more try 20 s later, against a fresh read of the
// markets: one that landed despite the error is then simply there and skipped.
let retry = [];
for (let round = 0; round < 2; round++) {
  const todo = round === 0 ? tpl.templates : retry; retry = [];
  if (round === 1) { if (!todo.length) break; await new Promise((r) => setTimeout(r, 20_000)); existing = await readExisting(); log(`retrying ${todo.length}: ${todo.map((t) => t.metric).join(", ")}`); }
  const failed = (t, why) => { if (round === 0) { log("will retry", why); retry.push(t); } else skipped.push(why); };
  for (const t of todo) {
    const cadence = t.cadence; if (cadence !== "day") { skipped.push(`${t.metric}: only daily markets run on this schedule`); continue; }
    const spec = parseMetric(t.metric); if (!spec) { skipped.push(`${t.metric}: unknown metric`); continue; }
    if (existing.some((m) => m.metric === t.metric && m.closeTs === closeTs)) { skipped.push(`${t.metric}: already open for ${new Date(closeTs * 1000).toISOString()}`); continue; }
    const opening = latestValue(spec.src);
    // thresholds
    let thresholds, how;
    const hist = windowValues(t.metric, SNAP).map((w) => w.value);
    if (spec.kind === "daily") { if (hist.length < 20) { skipped.push(`${t.metric}: only ${hist.length} days of source history`); continue; } thresholds = quantileThresholds(hist, t.buckets); how = `quantiles of the last ${hist.length} days reported by the source`; }
    else if (hist.length >= (tpl.minWindows ?? 8) && t.buckets > 1 && t.auto !== false) { thresholds = quantileThresholds(hist, t.buckets); how = `quantiles of ${hist.length} windows`; }
    else if (t.seed === "baseline") { if (opening == null) { skipped.push(`${t.metric}: no recent snapshot value for ${spec.src}`); continue; } thresholds = [roundToDisplay(t.metric, opening)]; how = `yes/no at the ${latestSlot} level${thresholds[0] !== opening ? ` (${opening} rounded to the displayed precision)` : ""}`; }
    else { thresholds = t.seed; how = `seed (${hist.length} windows of history so far)`; }
    if (spec.kind === "med" && t.seed !== "baseline" && thresholds === t.seed) { skipped.push(`${t.metric}: level metric needs 'baseline' seed`); continue; }
    const nBuckets = thresholds.length + 1; if (nBuckets < 2 || nBuckets > 8) { skipped.push(`${t.metric}: bad bucket count`); continue; }
    // The RPC behind a load balancer can serve a config read from a node a few slots behind the create we just
    // confirmed, handing back the same market_count twice (2026-09-26: three creates hit ConstraintSeeds). Never go
    // below the id after our last success, and wait until the node we read from has caught up to it.
    let id = (await program.account.config.fetch(configPda, "confirmed")).marketCount;
    for (let i = 0; nextId != null && id.lt(nextId) && i < 20; i++) { await new Promise((r) => setTimeout(r, 500)); id = (await program.account.config.fetch(configPda, "confirmed")).marketCount; }
    if (nextId != null && id.lt(nextId)) { failed(t, `${t.metric}: config still reads market_count ${id} < ${nextId} after 10 s`); continue; }
    const [market] = PublicKey.findProgramAddressSync([Buffer.from("market"), id.toArrayLike(Buffer, "le", 8)], program.programId);
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], program.programId);
    const baseline = 0;   // cumulative: the resolver reads the T00 snapshot at the start of D
    const thrArr = Array.from({ length: 7 }, (_, i) => new BN(thresholds[i] ?? 0));
    const metricBytes = Array.from(Buffer.from(t.metric.padEnd(32, "\0").slice(0, 32)));
    const qhash = Array.from(createHash("sha256").update(t.question).digest());
    // The answer is read when D has ended: at once from our own snapshots, or (a DefiLlama number) the configured hours
    // later, once the source has stopped moving it. Written on-chain here, it is this market's rule from now on.
    const resolveAfterTs = spec.kind === "daily" ? dailyReadTs(spec, openTs, closeTs) : dStart + 86400;
    log(`${DRY ? "would open" : "opening"} #${id} ${t.metric} (${cadence}) thresholds ${thresholds.join("/")} [${how}] open ${new Date(openTs * 1000).toISOString()} close ${new Date(closeTs * 1000).toISOString()} answer read ${new Date(resolveAfterTs * 1000).toISOString()} seed ${t.seedSkr} SKR`);
    if (DRY) { opened.push({ id: id.toNumber(), metric: t.metric, dry: true }); continue; }
    try {
      await program.methods.createMarket({ metric: metricBytes, questionHash: qhash, thresholds: thrArr, nBuckets, openTs: new BN(openTs), closeTs: new BN(closeTs), resolveAfterTs: new BN(resolveAfterTs), baseline: new BN(baseline) })
        .accounts({ config: configPda, market, vault, mint: cfg.mint, signer, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
      nextId = id.addn(1);
      // No house prize unless SEED_MARKETS=1 (a test network can still show one): pools are only what bettors put in.
      if (t.seedSkr > 0 && process.env.SEED_MARKETS === "1") {
        const funderToken = getAssociatedTokenAddressSync(new PublicKey(cfg.mint), signer);
        await program.methods.seedMarket(new BN(Math.round(t.seedSkr * 1_000_000))).accounts({ market, vault, funderToken, funder: signer, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
      }
      fs.appendFileSync(path.join(SNAP, "markets-opened.jsonl"), JSON.stringify({ at: new Date().toISOString(), id: id.toNumber(), market: market.toBase58(), metric: t.metric, cadence, question: t.question, thresholds, nBuckets, baselineSlot: day + "T00", countedDay: day, openTs, closeTs, seedSkr: t.seedSkr, how }) + "\n");
      opened.push({ id: id.toNumber(), metric: t.metric });
    } catch (e) { const logs = (e?.logs ?? e?.transactionLogs ?? []).filter((l) => /Error|failed/i.test(l)).slice(-2).join(" | "); failed(t, `${t.metric}: create failed: ${String(e?.message ?? e).split("\n")[0]}${logs ? " — " + logs : ""}`); }
  }
}
log(`opened ${opened.length}: ${opened.map((o) => `#${o.id} ${o.metric}`).join(", ") || "-"}`);
for (const s of skipped) log("skipped", s);
const notOpened = skipped.filter((x) => /create failed|market_count/.test(x)).length;   // after the retry
if (!DRY) { try { const { notify } = await import("./notify.mjs"); await notify(`${notOpened ? "⚠️ " : ""}Markets opened for ${day}: ${opened.length}${notOpened ? `, ${notOpened} failed twice` : ""}`, [...opened.map((o) => `#${o.id} ${o.metric}`), ...skipped.map((s) => "skip " + s)].join("\n").slice(0, 1500), "open-markets", 0); } catch {} }
