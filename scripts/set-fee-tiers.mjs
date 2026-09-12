// Admin: set holder discounts. Creates the fee_tiers PDA on first use. Unspecified fields keep current values (or zero).
//   ANCHOR_PROVIDER_URL=... ANCHOR_WALLET=... node scripts/set-fee-tiers.mjs sgtGroupMint=GT22... sgtDiscountBps=100 minFeeBps=100 \
//        [stakeProgram=... stakeOwnerOffset=40 stakeAmountOffset=104 stakeMinAmount=1000000000 stakeDiscountBps=100]
import anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import fs from "node:fs";
const idl = JSON.parse(fs.readFileSync(new URL("../idl/kubrai.json", import.meta.url), "utf8"));
const provider = anchor.AnchorProvider.env(); anchor.setProvider(provider);
const program = new anchor.Program(idl, provider);
const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
const [feeTiers] = PublicKey.findProgramAddressSync([Buffer.from("fee_tiers")], program.programId);
const cur = await program.account.feeTiers.fetchNullable(feeTiers);
const args = { sgtGroupMint: cur?.sgtGroupMint ?? PublicKey.default, sgtDiscountBps: cur?.sgtDiscountBps ?? 0, stakeProgram: cur?.stakeProgram ?? PublicKey.default, stakeOwnerOffset: cur?.stakeOwnerOffset ?? 0, stakeAmountOffset: cur?.stakeAmountOffset ?? 0, stakeMinAmount: cur?.stakeMinAmount ?? new anchor.BN(0), stakeDiscountBps: cur?.stakeDiscountBps ?? 0, minFeeBps: cur?.minFeeBps ?? 0 };
for (const kv of process.argv.slice(2)) {
  const [k, v] = kv.split("="); if (!(k in args)) throw new Error(`unknown field ${k}; known: ${Object.keys(args).join(",")}`);
  args[k] = /Mint$|Program$/.test(k) ? new PublicKey(v) : k === "stakeMinAmount" ? new anchor.BN(v) : Number(v);
}
const show = (a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v?.toBase58 ? v.toBase58() : v?.toString?.() ?? v]));
console.log("current", cur ? show(cur) : null); console.log("setting", show(args));
if (process.env.DRY_RUN === "1") process.exit(0);
const sig = await program.methods.setFeeTiers(args).accounts({ config, feeTiers, admin: provider.wallet.publicKey }).rpc();
console.log("ok", feeTiers.toBase58(), sig);
