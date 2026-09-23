// ORE-miner discount: keep the on-chain minimum equal to $500 of unclaimed ORE at today's ORE price.
//   FeeTiers stake rule = { program: ORE (or the devnet stub), owner offset 8, amount offset 704 = rewards_ore, min = 500 / ORE_USD in base units }.
//   Runs daily from cron; only writes when the minimum drifts more than DRIFT (10 %) from the current on-chain value.
//   env: ANCHOR_PROVIDER_URL, ANCHOR_WALLET (admin), ORE_MINER_PROGRAM (default: mainnet ORE; devnet passes the stub id),
//        USD_MIN (default 500), DRY_RUN=1
import anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import fs from "node:fs";
const ORE_MINT = "oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp", ORE_BASE = 100_000_000_000n;
const USD_MIN = Number(process.env.USD_MIN ?? 500), DRIFT = 0.10;
const stakeProgram = new PublicKey(process.env.ORE_MINER_PROGRAM ?? "oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv");
const idl = JSON.parse(fs.readFileSync(new URL("../idl/kubrai.json", import.meta.url), "utf8"));
const provider = anchor.AnchorProvider.env(); anchor.setProvider(provider);
const program = new anchor.Program(idl, provider);
const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
const [feeTiers] = PublicKey.findProgramAddressSync([Buffer.from("fee_tiers")], program.programId);
const log = (...a) => console.log(new Date().toISOString(), ...a);

const j = await (await fetch(`https://lite-api.jup.ag/price/v3?ids=${ORE_MINT}`)).json();
const price = Number(j?.[ORE_MINT]?.usdPrice); if (!(price > 0)) { log("no ORE price from Jupiter; leaving the tier as is"); process.exit(1); }
const minBase = BigInt(Math.round((USD_MIN / price) * Number(ORE_BASE)));
const cur = await program.account.feeTiers.fetchNullable(feeTiers);
const curMin = cur ? BigInt(cur.stakeMinAmount.toString()) : 0n;
const sameRule = cur && cur.stakeProgram.equals(stakeProgram) && cur.stakeOwnerOffset === 8 && cur.stakeAmountOffset === 704 && cur.stakeDiscountBps > 0;
const drift = curMin > 0n ? Math.abs(Number(minBase - curMin)) / Number(curMin) : Infinity;
log(`ORE $${price.toFixed(2)} → $${USD_MIN} = ${(Number(minBase) / Number(ORE_BASE)).toFixed(3)} ORE (${minBase} base); on-chain ${sameRule ? `${(Number(curMin) / Number(ORE_BASE)).toFixed(3)} ORE, drift ${(drift * 100).toFixed(1)} %` : "rule not set"}`);
if (sameRule && drift < DRIFT) { log("within tolerance, nothing to do"); process.exit(0); }
const args = { sgtGroupMint: cur?.sgtGroupMint ?? PublicKey.default, sgtDiscountBps: cur?.sgtDiscountBps ?? 0, stakeProgram, stakeOwnerOffset: 8, stakeAmountOffset: 704, stakeMinAmount: new anchor.BN(minBase.toString()), stakeDiscountBps: cur?.stakeDiscountBps || 100, minFeeBps: cur?.minFeeBps ?? 100 };
if (process.env.DRY_RUN === "1") { log("DRY_RUN, would set", { ...args, stakeProgram: stakeProgram.toBase58(), stakeMinAmount: minBase.toString() }); process.exit(0); }
const sig = await program.methods.setFeeTiers(args).accounts({ config, feeTiers, admin: provider.wallet.publicKey }).rpc();
log("set", sig);
fs.appendFileSync(new URL("./snapshots/ore-tier.jsonl", import.meta.url), JSON.stringify({ at: new Date().toISOString(), oreUsd: price, usdMin: USD_MIN, minBase: minBase.toString(), sig }) + "\n");
