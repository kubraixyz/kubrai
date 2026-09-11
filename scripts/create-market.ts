/** Create one market on the configured cluster. Usage:
 *  ANCHOR_PROVIDER_URL=... ANCHOR_WALLET=... npx ts-node scripts/create-market.ts <metric> <threshold> <question text> [opensInHours=0] [durationHours=168] [seedSKR=0]
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { createHash } from "crypto";
import idl from "../idl/kubrai.json";
import * as fs from "fs";
import * as path from "path";

const SNAP = process.env.SNAPSHOT_DIR ?? path.join(__dirname, "..", "server", "snapshots");
const APP_SLUGS: Record<string, string> = { jupiter: "ag.jup.jupiter.android", tokenrun: "com.tokenrun.app", mattle: "fun.mattle.twa", cherry: "fun.cherry", seedvault: "com.solanamobile.wallet", lootgo: "com.lootgo.app", jito: "network.jito.www.twa", sleepagotchi: "com.sleepagotchi.soft.app", moonwalk: "fit.moonwalk.mobile.app", ore: "supply.ore.app" };
const SOURCE: Record<string, string[]> = { skr_ids_week: ["skr_ids_onchain", "skr_ids_total"], dapps_week: ["dapp_store_active_apps"], skr_staked_med7: ["skr_staked"], das_med7: ["das"], skr_price_close: ["skr_price_usd_e8"] };
/** Baseline = metric value in the latest snapshot. Refuses to create a market without one unless NO_BASELINE=1. */
function baselineFor(metric: string): { value: number; day: string } {
  const days = fs.existsSync(SNAP) ? fs.readdirSync(SNAP).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : [];
  const latest = days.at(-1); if (!latest) throw new Error(`no snapshots in ${SNAP}; run server/snapshot.mjs first (or NO_BASELINE=1)`);
  const b = JSON.parse(fs.readFileSync(path.join(SNAP, latest), "utf8"));
  let v: number | undefined;
  if (metric.startsWith("rev_week:")) { const slug = metric.slice(9); if (!APP_SLUGS[slug]) throw new Error(`unknown app slug ${slug}`); v = b.metrics?.dapp_reviews?.raw?.[slug]?.reviews; }
  else for (const f of SOURCE[metric] ?? []) { v = b.metrics?.[f]?.value; if (typeof v === "number") break; }
  if (typeof v !== "number") throw new Error(`snapshot ${latest} has no value for ${metric}`);
  return { value: v, day: latest.slice(0, 10) };
}

async function main() {
  const [metric, thresholdStr, question, opensInH = "0", durH = "168", seedStr = "0"] = process.argv.slice(2);
  if (!metric || !thresholdStr || !question) throw new Error("usage: <metric> <threshold|t1,t2,...> <question> [opensInHours] [durationHours] [seedSKR]");
  const thresholds = thresholdStr.split(",").map((x) => new BN(x.trim()));
  if (thresholds.length < 1 || thresholds.length > 7) throw new Error("1 to 7 thresholds");
  for (let i = 1; i < thresholds.length; i++) if (!thresholds[i].gt(thresholds[i - 1])) throw new Error("thresholds must be strictly increasing");
  const thrArr = Array.from({ length: 7 }, (_, i) => thresholds[i] ?? new BN(0));
  const provider = anchor.AnchorProvider.env(); anchor.setProvider(provider);
  const program = new Program(idl as anchor.Idl, provider);
  const signer = (provider.wallet as anchor.Wallet).payer;
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const cfg: any = await (program.account as any).config.fetch(config);
  const id: BN = cfg.marketCount;
  const [market] = PublicKey.findProgramAddressSync([Buffer.from("market"), id.toArrayLike(Buffer, "le", 8)], program.programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], program.programId);
  const now = Math.floor(Date.now() / 1000);
  const openTs = now + Math.round(Number(opensInH) * 3600);
  // CLOSE_AT (ISO) pins the close; it must be at or before 00:05 UTC of its day so the closing snapshot is taken after betting ends.
  const closeTs = process.env.CLOSE_AT ? Math.floor(Date.parse(process.env.CLOSE_AT) / 1000) : openTs + Math.round(Number(durH) * 3600);
  const closeDay = new Date(closeTs * 1000); if (closeDay.getUTCHours() * 60 + closeDay.getUTCMinutes() > 5 && process.env.ALLOW_LATE_CLOSE !== "1") throw new Error("close must be ≤ 00:05 UTC of its day (the snapshot must come after betting closes); set CLOSE_AT=YYYY-MM-DDT00:00:00Z");
  if (Buffer.byteLength(metric) > 32) throw new Error("metric tag must be ≤ 32 bytes");
  const base = process.env.NO_BASELINE === "1" ? { value: 0, day: "none" } : baselineFor(metric);
  const metricBytes = Array.from(Buffer.from(metric.padEnd(32, "\0").slice(0, 32)));
  const qhash = Array.from(createHash("sha256").update(question).digest());
  await program.methods.createMarket({ metric: metricBytes, questionHash: qhash, thresholds: thrArr, nBuckets: thresholds.length + 1, openTs: new BN(openTs), closeTs: new BN(closeTs), resolveAfterTs: new BN(closeTs), baseline: new BN(base.value) })
    .accounts({ config, market, vault, mint: cfg.mint, signer: signer.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
  console.log(JSON.stringify({ id: id.toNumber(), market: market.toBase58(), vault: vault.toBase58(), metric, thresholds: thresholds.map(String), nBuckets: thresholds.length + 1, question, questionHash: Buffer.from(qhash).toString("hex"), openTs, closeTs, baseline: base.value, baselineSnapshot: base.day }, null, 2));
  const seed = Number(seedStr);
  if (seed > 0) {
    const funderToken = getAssociatedTokenAddressSync(new PublicKey(cfg.mint), signer.publicKey);
    await program.methods.seedMarket(new BN(Math.round(seed * 1_000_000))).accounts({ market, vault, funderToken, funder: signer.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
    console.log("seeded", seed, "SKR");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
