/** Create one market on the configured cluster. Usage:
 *  ANCHOR_PROVIDER_URL=... ANCHOR_WALLET=... npx ts-node scripts/create-market.ts <metric> <threshold> <question text> [opensInHours=0] [durationHours=168] [seedSKR=0]
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { createHash } from "crypto";
import idl from "../idl/kubrai.json";

async function main() {
  const [metric, thresholdStr, question, opensInH = "0", durH = "168", seedStr = "0"] = process.argv.slice(2);
  if (!metric || !thresholdStr || !question) throw new Error("usage: <metric> <threshold> <question> [opensInHours] [durationHours] [seedSKR]");
  const provider = anchor.AnchorProvider.env(); anchor.setProvider(provider);
  const program = new Program(idl as anchor.Idl, provider);
  const signer = (provider.wallet as anchor.Wallet).payer;
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const cfg: any = await (program.account as any).config.fetch(config);
  const id: BN = cfg.marketCount;
  const [market] = PublicKey.findProgramAddressSync([Buffer.from("market"), id.toArrayLike(Buffer, "le", 8)], program.programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], program.programId);
  const now = Math.floor(Date.now() / 1000);
  const openTs = now + Math.round(Number(opensInH) * 3600), closeTs = openTs + Math.round(Number(durH) * 3600);
  const metricBytes = Array.from(Buffer.from(metric.padEnd(32, "\0").slice(0, 32)));
  const qhash = Array.from(createHash("sha256").update(question).digest());
  await program.methods.createMarket({ metric: metricBytes, questionHash: qhash, threshold: new BN(thresholdStr), openTs: new BN(openTs), closeTs: new BN(closeTs), resolveAfterTs: new BN(closeTs) })
    .accounts({ config, market, vault, mint: cfg.mint, signer: signer.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
  console.log(JSON.stringify({ id: id.toNumber(), market: market.toBase58(), vault: vault.toBase58(), metric, threshold: thresholdStr, question, questionHash: Buffer.from(qhash).toString("hex"), openTs, closeTs }, null, 2));
  const seed = Number(seedStr);
  if (seed > 0) {
    const funderToken = getAssociatedTokenAddressSync(new PublicKey(cfg.mint), signer.publicKey);
    await program.methods.seedMarket(new BN(Math.round(seed * 1_000_000))).accounts({ market, vault, funderToken, funder: signer.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
    console.log("seeded", seed, "SKR");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
