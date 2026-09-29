// Admin: name (or clear) the on-chain verifier — the second host that re-derives every proposed result and may void a
// market whose result it cannot confirm (programs/kubrai: set_roles / void_proposed_market).
//   ANCHOR_PROVIDER_URL=<rpc> ANCHOR_WALLET=<admin keypair> node scripts/set-roles.mjs <verifier pubkey | none>
import anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import fs from "node:fs";
const arg = process.argv[2]; if (!arg) { console.error("usage: set-roles.mjs <verifier pubkey | none>"); process.exit(2); }
const verifier = arg === "none" ? PublicKey.default : new PublicKey(arg);
const idl = JSON.parse(fs.readFileSync(new URL("../idl/kubrai.json", import.meta.url), "utf8"));
const provider = anchor.AnchorProvider.env(); anchor.setProvider(provider);
const program = new anchor.Program(idl, provider);
const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
const [roles] = PublicKey.findProgramAddressSync([Buffer.from("roles")], program.programId);
const before = await program.account.roles.fetchNullable(roles);
console.log(`roles ${roles.toBase58()}: verifier ${before ? before.verifier.toBase58() : "(account not created yet)"} → ${verifier.toBase58()}`);
const sig = await program.methods.setRoles(verifier).accounts({ config, roles, admin: provider.wallet.publicKey, systemProgram: SystemProgram.programId }).rpc();
console.log("set", sig);
