/**
 * One-shot devnet bootstrap:
 *  1. mock SKR mint (6 decimals) — mainnet SKR is a plain SPL token with 6 decimals
 *  2. treasury ATA (admin) + proposer keypair (server key, saved to ~/secrets)
 *  3. initialize config (fee 3%, early-bird −1% for 24h, dispute 24h, min bet 1 SKR)
 *  4. a faucet ATA holding 1B mock SKR for testers
 * Idempotent: re-running prints existing addresses instead of recreating.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getMint } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import idl from "../idl/kubrai.json";

const SECRETS = process.env.KUBRAI_SECRETS ?? path.join(os.homedir(), "secrets");
const STATE = path.join(SECRETS, "devnet.json");
const loadOrCreateKeypair = (file: string) => {
  const p = path.join(SECRETS, file);
  if (fs.existsSync(p)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
  const k = Keypair.generate();
  fs.writeFileSync(p, JSON.stringify(Array.from(k.secretKey)), { mode: 0o600 });
  return k;
};

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program(idl as anchor.Idl, provider);
  const admin = (provider.wallet as anchor.Wallet).payer;
  const conn = provider.connection;
  const state: Record<string, string> = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
  const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

  console.log("cluster", conn.rpcEndpoint, "admin", admin.publicKey.toBase58(), "balance", (await conn.getBalance(admin.publicKey)) / 1e9);

  // 1. mint
  let mint: PublicKey;
  if (state.mint) { mint = new PublicKey(state.mint); await getMint(conn, mint); }
  else { mint = await createMint(conn, admin, admin.publicKey, null, 6); state.mint = mint.toBase58(); save(); }
  console.log("mock SKR mint", mint.toBase58());

  // 2. treasury + proposer
  const treasury = (await getOrCreateAssociatedTokenAccount(conn, admin, mint, admin.publicKey)).address;
  const proposer = loadOrCreateKeypair("proposer.json");
  state.treasury = treasury.toBase58(); state.proposer = proposer.publicKey.toBase58(); save();
  console.log("treasury", treasury.toBase58(), "proposer", proposer.publicKey.toBase58());
  if ((await conn.getBalance(proposer.publicKey)) < 0.05e9) {
    const tx = new anchor.web3.Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: proposer.publicKey, lamports: 0.2e9 }));
    await provider.sendAndConfirm(tx); console.log("funded proposer 0.2 SOL");
  }

  // 3. config
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
  const existing = await conn.getAccountInfo(config);
  if (!existing) {
    await program.methods.initialize({ proposer: proposer.publicKey, feeBps: 300, earlyBirdDiscountBps: 100, earlyBirdSecs: new BN(86400), disputeWindowSecs: new BN(86400), minBet: new BN(1_000_000) })
      .accounts({ config, admin: admin.publicKey, mint, treasury, systemProgram: SystemProgram.programId }).rpc();
    console.log("config initialized", config.toBase58());
  } else console.log("config exists", config.toBase58());
  state.config = config.toBase58(); state.programId = program.programId.toBase58(); save();

  // 4. faucet supply for testers (1,000,000,000 mock SKR in the admin ATA)
  const bal = Number((await conn.getTokenAccountBalance(treasury)).value.amount);
  if (bal < 1_000_000_000 * 1_000_000) { await mintTo(conn, admin, mint, treasury, admin, BigInt(1_000_000_000) * BigInt(1_000_000)); console.log("minted 1B mock SKR to treasury/faucet"); }

  console.log("state written to", STATE); console.log(JSON.stringify(state, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
