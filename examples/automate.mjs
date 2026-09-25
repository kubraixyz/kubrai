// Kubrai from a script: list the markets you can bet on, place a bet, read the results.
// Everything a bot needs is the public read API plus the on-chain program (bets are signed by your own wallet;
// there is no server-side bet endpoint, so nobody can bet with your tokens but you).
//
//   node examples/automate.mjs markets                 open markets: id, question, ranges, closes in, pool sizes
//   node examples/automate.mjs bet <id> <range> <n>    stake n SKR on range index <range> of market <id>
//   node examples/automate.mjs results [wallet]        settled markets and, for a wallet, what it was paid
//   node examples/automate.mjs faucet                  devnet only: 1,000 tSKR + a little SOL for your wallet, once a day
//
// env: API     (default https://api-devnet.kubrai.xyz)
//      RPC     (default https://api.devnet.solana.com)
//      KEYPAIR (default ~/.config/solana/id.json, the Solana CLI wallet; only `bet` and `faucet` need it)
// Node 22 and the server's dependencies: `cd server && npm ci` once.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dep = (name) => import(createRequire(path.join(here, "../server/package.json")).resolve(name)); // server/node_modules
const { default: anchor } = await dep("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey, SystemProgram } = await dep("@solana/web3.js");
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = await dep("@solana/spl-token");
const idl = JSON.parse(fs.readFileSync(path.join(here, "../idl/kubrai.json"), "utf8"));

const API = process.env.API ?? "https://api-devnet.kubrai.xyz";
const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const KEYPAIR = process.env.KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json");
const STATUS = ["open", "proposed", "resolved", "voided", "settled"];   // market.status 0..4
const DECIMALS = 6, ui = (raw) => Number(raw) / 10 ** DECIMALS;
const get = async (p) => { const r = await fetch(API + p); if (!r.ok) throw new Error(`${p}: ${r.status} ${(await r.json().catch(() => ({}))).error ?? ""}`); return r.json(); };
const left = (ts) => { const s = ts - Date.now() / 1000; return s <= 0 ? "closed" : s > 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };
/** Range labels the way the site prints them: "< t0", "t0 – t1", "≥ tlast"; yes/no markets are two ranges. */
const ranges = (m) => Array.from({ length: m.nBuckets }, (_, i) => (m.nBuckets === 2 ? (i ? `yes (≥ ${m.thresholds[0]})` : `no (< ${m.thresholds[0]})`) : i === 0 ? `< ${m.thresholds[0]}` : i === m.nBuckets - 1 ? `≥ ${m.thresholds[i - 1]}` : `${m.thresholds[i - 1]} – ${m.thresholds[i] - 1}`));

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "markets") {
  const { markets } = await get("/markets"); const now = Date.now() / 1000;
  for (const m of markets.filter((m) => m.status === 0 && m.openTs <= now && m.closeTs > now).sort((a, b) => a.closeTs - b.closeTs)) {
    console.log(`#${m.id}  ${m.metric}  closes in ${left(m.closeTs)}  seed ${ui(m.seed)} SKR`);
    ranges(m).forEach((r, i) => console.log(`    [${i}] ${r.padEnd(28)} ${ui(m.pools[i]).toLocaleString("en-US")} SKR`));
  }
} else if (cmd === "bet") {
  const [id, bucket, n] = args; if (!id || bucket == null || !n) throw new Error("usage: bet <id> <range> <n>");
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR, "utf8"))));
  const conn = new Connection(RPC, "confirmed");
  const program = new anchor.Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed" }));
  const pid = program.programId, idBn = new anchor.BN(id);
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], pid);
  const [market] = PublicKey.findProgramAddressSync([Buffer.from("market"), idBn.toArrayLike(Buffer, "le", 8)], pid);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], pid);
  const [position] = PublicKey.findProgramAddressSync([Buffer.from("position"), market.toBuffer(), kp.publicKey.toBuffer()], pid);
  const cfg = await program.account.config.fetch(config);
  // Holder discounts (Genesis Token, ORE miner) are proven by extra accounts; see web/src/holder.ts. Left out here: the base fee applies.
  const sig = await program.methods.placeBet(Number(bucket), new anchor.BN(Math.round(Number(n) * 10 ** DECIMALS)))
    .accounts({ config, market, position, vault, userToken: getAssociatedTokenAddressSync(cfg.mint, kp.publicKey), user: kp.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
  console.log(JSON.stringify({ market: Number(id), range: Number(bucket), amount: Number(n), wallet: kp.publicKey.toBase58(), signature: sig }));
} else if (cmd === "results") {
  const wallet = args[0];
  if (wallet) { const { settled } = await get(`/positions/${wallet}`); for (const s of settled) console.log(`#${s.id}  ${s.metric}  ${s.status === 3 ? "voided" : "observed " + s.observed + " → range " + s.outcome}  ${s.kind}  paid ${ui(s.payout)} SKR  fee ${ui(s.fee)}`); }
  else { const { markets } = await get("/markets"); for (const m of markets.filter((m) => m.status >= 2).sort((a, b) => b.id - a.id).slice(0, 30)) console.log(`#${m.id}  ${m.metric}  ${STATUS[m.status]}  ${m.status === 3 ? "" : `observed ${m.proposedValue} → range ${m.outcome}`}  pools ${m.pools.map(ui).join("/")}`); }
} else if (cmd === "faucet") {
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR, "utf8"))));
  const r = await fetch(API + "/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: kp.publicKey.toBase58() }) });
  console.log(JSON.stringify(await r.json()));
} else {
  console.log("usage: node examples/automate.mjs markets | bet <id> <range> <n> | results [wallet] | faucet");
}
