// Place a bet from a keypair file. Usage: node scripts/bet.mjs <keypair.json> <marketId> <bucketIndex|yes|no> <amountSKR>
import anchor from "@coral-xyz/anchor"; import fs from "node:fs"; import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js"; import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import idl from "../idl/kubrai.json" with { type: "json" };
const [kpFile, idStr, side, amt] = process.argv.slice(2);
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(kpFile, "utf8"))));
const conn = new Connection(process.env.CLUSTER_RPC ?? "http://127.0.0.1:8899", "confirmed");
const program = new anchor.Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed" }));
const pid = program.programId; const id = new anchor.BN(idStr);
const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], pid);
const [market] = PublicKey.findProgramAddressSync([Buffer.from("market"), id.toArrayLike(Buffer, "le", 8)], pid);
const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], pid);
const [position] = PublicKey.findProgramAddressSync([Buffer.from("position"), market.toBuffer(), kp.publicKey.toBuffer()], pid);
const cfg = await program.account.config.fetch(config);
// PROOF=1: append the holder-discount proof (fee_tiers PDA + the wallet's Genesis Token account and mint), like the web/app do.
const extra = [];
if (process.env.PROOF === "1") {
  const [feeTiers] = PublicKey.findProgramAddressSync([Buffer.from("fee_tiers")], pid);
  const tiers = await program.account.feeTiers.fetchNullable(feeTiers);
  if (tiers) {
    extra.push({ pubkey: feeTiers, isSigner: false, isWritable: false });
    const T22 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    const held = (await conn.getParsedTokenAccountsByOwner(kp.publicKey, { programId: T22 })).value.filter((a) => Number(a.account.data.parsed.info.tokenAmount.amount) >= 1);
    for (const a of held) {
      const mintPk = new PublicKey(a.account.data.parsed.info.mint); const mi = await conn.getParsedAccountInfo(mintPk);
      const member = (mi.value?.data?.parsed?.info?.extensions ?? []).find((e) => e.extension === "tokenGroupMember")?.state;
      if (member && member.group === tiers.sgtGroupMint.toBase58()) { extra.push({ pubkey: a.pubkey, isSigner: false, isWritable: false }, { pubkey: mintPk, isSigner: false, isWritable: false }); console.error("proof: Genesis Token", mintPk.toBase58()); break; }
    }
  }
}
const sig = await program.methods.placeBet(side === "yes" ? 1 : side === "no" ? 0 : Number(side), new anchor.BN(Math.round(Number(amt) * 1e6))).remainingAccounts(extra).accounts({ config, market, position, vault, userToken: getAssociatedTokenAddressSync(cfg.mint, kp.publicKey), user: kp.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
console.log(JSON.stringify({ market: id.toNumber(), side, amount: amt, user: kp.publicKey.toBase58(), sig }));
