// Public read API + devnet faucet. Listens on 127.0.0.1 only; Caddy fronts it.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

const PORT = Number(process.env.API_PORT ?? 8787);
const CLUSTER = process.env.CLUSTER ?? "devnet";
const RPC = process.env.CLUSTER_RPC ?? process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const SNAP = process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots");
const SECRETS = process.env.KUBRAI_SECRETS ?? path.join(os.homedir(), "secrets", CLUSTER);
const FAUCET_ENABLED = CLUSTER !== "mainnet" && process.env.FAUCET_DISABLED !== "1";
const FAUCET_TOKENS = 1000n * 1_000_000n; // 1000 tSKR
const FAUCET_SOL = 0.05;
const state = JSON.parse(fs.readFileSync(path.join(SECRETS, "devnet.json"), "utf8"));
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ADMIN_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));
const conn = new Connection(RPC, "confirmed");
const mint = new PublicKey(state.mint);

// naive rate limits: one faucet call per address per 24h, 20 per IP per day
const seenAddr = new Map(), seenIp = new Map();
const dayKey = () => new Date().toISOString().slice(0, 10);

const json = (res, code, body, extra = {}) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS", ...extra }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok, err) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 4096) req.destroy(); }); req.on("end", () => ok(b)); req.on("error", err); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") return json(res, 204, {});
  try {
    if (url.pathname === "/health") return json(res, 200, { ok: true, cluster: CLUSTER, programId: state.programId, mint: state.mint, faucet: FAUCET_ENABLED });
    const po = url.pathname.match(/^\/positions\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
    if (po) {
      const f = path.join(SNAP, "settlements.jsonl");
      const rows = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.owner === po[1]) : [];
      return json(res, 200, { owner: po[1], settled: rows.reverse() }, { "cache-control": "no-store" });
    }
    if (url.pathname === "/snapshots") {
      const days = fs.readdirSync(SNAP).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
      return json(res, 200, { days, latest: days.at(-1) ?? null });
    }
    const m = url.pathname.match(/^\/snapshots\/(\d{4}-\d{2}-\d{2})$/);
    if (m) {
      const f = path.join(SNAP, m[1] + ".json"); if (!fs.existsSync(f)) return json(res, 404, { error: "no snapshot for that day" });
      const bundle = JSON.parse(fs.readFileSync(f, "utf8"));
      const sha256 = fs.existsSync(f + ".sha256") ? fs.readFileSync(f + ".sha256", "utf8").trim() : null;
      const memo = fs.existsSync(f + ".memo") ? JSON.parse(fs.readFileSync(f + ".memo", "utf8")) : null;
      return json(res, 200, { day: m[1], sha256, memo, bundle }, { "cache-control": "public, max-age=300" });
    }
    if (url.pathname === "/faucet" && req.method === "POST") {
      if (!FAUCET_ENABLED) return json(res, 403, { error: "faucet is disabled on this network" });
      const ip = req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?";
      let address; try { address = new PublicKey(JSON.parse(await readBody(req)).address); } catch { return json(res, 400, { error: "body must be {\"address\": \"<pubkey>\"}" }); }
      const k = address.toBase58() + "|" + dayKey();
      if (seenAddr.has(k)) return json(res, 429, { error: "this address already received test tokens today" });
      const ipk = ip + "|" + dayKey(); seenIp.set(ipk, (seenIp.get(ipk) ?? 0) + 1); if (seenIp.get(ipk) > 20) return json(res, 429, { error: "too many faucet requests from this network today" });
      const sigs = {};
      if ((await conn.getBalance(address)) < FAUCET_SOL * LAMPORTS_PER_SOL) {
        sigs.sol = await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: address, lamports: Math.round(FAUCET_SOL * LAMPORTS_PER_SOL) })), [admin]);
      }
      const ata = await getOrCreateAssociatedTokenAccount(conn, admin, mint, address);
      sigs.tokens = await mintTo(conn, admin, mint, ata.address, admin, FAUCET_TOKENS);
      seenAddr.set(k, true);
      return json(res, 200, { ok: true, address: address.toBase58(), tokens: "1000 tSKR", sol: sigs.sol ? FAUCET_SOL + " SOL" : "already funded", signatures: sigs });
    }
    json(res, 404, { error: "not found" });
  } catch (e) { console.error(e); json(res, 500, { error: String(e?.message ?? e) }); }
}).listen(PORT, "127.0.0.1", () => console.log(`kubrai api on 127.0.0.1:${PORT} cluster=${CLUSTER} faucet=${FAUCET_ENABLED} rpc=${RPC.replace(/api-key=.*/, "api-key=…")}`));
