// Public read API + devnet faucet. Listens on 127.0.0.1 only; Caddy fronts it.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync, createTransferInstruction, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";

const PORT = Number(process.env.API_PORT ?? 8787);
const CLUSTER = process.env.CLUSTER ?? "devnet";
const RPC = process.env.CLUSTER_RPC ?? process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const SNAP = process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots");
const SECRETS = process.env.KUBRAI_SECRETS ?? path.join(os.homedir(), "secrets", CLUSTER);
const FAUCET_ENABLED = CLUSTER !== "mainnet" && process.env.FAUCET_DISABLED !== "1";
const FAUCET_TOKENS = 1000n * 1_000_000n; // 1000 tSKR
const FAUCET_SOL = 0.05;
const state = JSON.parse(fs.readFileSync(path.join(SECRETS, "devnet.json"), "utf8"));
// The faucet pays from a dedicated low-balance key (pre-funded with test tokens + a little SOL).
// The admin / mint authority never lives in this process.
const faucetKeyFile = process.env.FAUCET_KEYPAIR ?? path.join(SECRETS, "faucet.json");
const faucet = FAUCET_ENABLED && fs.existsSync(faucetKeyFile) ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(faucetKeyFile, "utf8")))) : null;
const conn = new Connection(RPC, "confirmed");
const mint = new PublicKey(state.mint);
const FAUCET_DAILY_GLOBAL = Number(process.env.FAUCET_DAILY_GLOBAL ?? 300);
const DIAG_MAX = 32 * 1024;

// rate limits: one faucet call per address per day, 20 per IP per day, a global daily cap; maps pruned daily
const seenAddr = new Map(), seenIp = new Map(); let seenDay = "", faucetToday = 0;
const dayKey = () => new Date().toISOString().slice(0, 10);
function rollDay() { const d = dayKey(); if (d !== seenDay) { seenDay = d; seenAddr.clear(); seenIp.clear(); seenFb.clear(); faucetToday = 0; } }
// Only Caddy talks to this socket; Caddy replaces X-Forwarded-For for untrusted clients, so its first hop is the real client.
const clientIp = (req) => String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();

const json = (res, code, body, extra = {}) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS", ...extra }); res.end(JSON.stringify(body)); };
const readBody = (req, max = 4096) => new Promise((ok, err) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > max) { err(Object.assign(new Error("body too large"), { status: 413 })); req.destroy(); } }); req.on("end", () => ok(b)); req.on("error", err); });
const FEEDBACK_DIR = process.env.FEEDBACK_DIR ?? path.join(os.homedir(), "apps", "kubrai", "feedback");
fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
const seenFb = new Map();

const server = http.createServer(async (req, res) => {
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
    // In-app feedback: { note, diagnostics, image (base64 jpeg/png, ≤ 6 MB) } → one .json (+ .jpg/.png) per report
    if (url.pathname === "/feedback" && req.method === "POST") {
      rollDay();
      const ip = clientIp(req);
      const ipk = ip; seenFb.set(ipk, (seenFb.get(ipk) ?? 0) + 1); if (seenFb.get(ipk) > 40) return json(res, 429, { error: "too many reports today" });
      let body; try { body = JSON.parse(await readBody(req, 9 * 1024 * 1024)); } catch (e) { return json(res, e?.status ?? 400, { error: e?.status === 413 ? "report too large" : "body must be JSON {note, diagnostics, image?, imageType?}" }); }
      const id = new Date().toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 7);
      let diagnostics = null; try { const dj = JSON.stringify(body.diagnostics ?? null); diagnostics = dj.length > DIAG_MAX ? { truncated: true, head: dj.slice(0, DIAG_MAX) } : body.diagnostics ?? null; } catch { diagnostics = null; }
      const wallet = typeof body.wallet === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.wallet) ? body.wallet : null;
      const rec = { id, at: new Date().toISOString(), note: String(body.note ?? "").slice(0, 4000), diagnostics, wallet, ua: String(req.headers["user-agent"] ?? "").slice(0, 300) };
      if (body.image) {
        const b64 = String(body.image).replace(/^data:[^;]+;base64,/, ""); const buf = Buffer.from(b64, "base64");
        if (buf.length > 6 * 1024 * 1024) return json(res, 413, { error: "image too large (6 MB max)" });
        const ext = /png/i.test(body.imageType ?? "") ? "png" : "jpg"; fs.writeFileSync(path.join(FEEDBACK_DIR, `${id}.${ext}`), buf); rec.image = `${id}.${ext}`; rec.imageBytes = buf.length;
      }
      fs.writeFileSync(path.join(FEEDBACK_DIR, `${id}.json`), JSON.stringify(rec, null, 2));
      console.log("feedback", id, rec.note.slice(0, 80), rec.image ?? "(no image)");
      return json(res, 200, { ok: true, id });
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
      if (!FAUCET_ENABLED || !faucet) return json(res, 403, { error: "faucet is disabled on this network" });
      rollDay();
      const ip = clientIp(req);
      let address; try { address = new PublicKey(JSON.parse(await readBody(req)).address); } catch { return json(res, 400, { error: "body must be {\"address\": \"<pubkey>\"}" }); }
      const k = address.toBase58();
      // Reserve the slot BEFORE any await so concurrent requests for one address cannot all pass the check.
      if (seenAddr.has(k)) return json(res, 429, { error: "this address already received test tokens today" });
      if ((seenIp.get(ip) ?? 0) >= 20) return json(res, 429, { error: "too many faucet requests from this network today" });
      if (faucetToday >= FAUCET_DAILY_GLOBAL) return json(res, 429, { error: "faucet is empty for today, try tomorrow" });
      seenAddr.set(k, true); seenIp.set(ip, (seenIp.get(ip) ?? 0) + 1); faucetToday++;
      try {
        const ata = getAssociatedTokenAddressSync(mint, address), from = getAssociatedTokenAddressSync(mint, faucet.publicKey);
        const tx = new Transaction();
        const solNow = await conn.getBalance(address); const giveSol = solNow < FAUCET_SOL * LAMPORTS_PER_SOL;
        if (giveSol) tx.add(SystemProgram.transfer({ fromPubkey: faucet.publicKey, toPubkey: address, lamports: Math.round(FAUCET_SOL * LAMPORTS_PER_SOL) }));
        tx.add(createAssociatedTokenAccountIdempotentInstruction(faucet.publicKey, ata, address, mint));
        tx.add(createTransferInstruction(from, ata, faucet.publicKey, FAUCET_TOKENS));
        const sig = await sendAndConfirmTransaction(conn, tx, [faucet]);
        return json(res, 200, { ok: true, address: address.toBase58(), tokens: "1000 tSKR", sol: giveSol ? FAUCET_SOL + " SOL" : "already funded", signatures: { tokens: sig, ...(giveSol ? { sol: sig } : {}) } });
      } catch (e) { seenAddr.delete(k); faucetToday--; console.error("faucet failed", e?.message); return json(res, 503, { error: "faucet transaction failed, try again in a minute" }); }
    }
    json(res, 404, { error: "not found" });
  } catch (e) { console.error(e); json(res, 500, { error: "internal error" }); }
});
server.headersTimeout = 15_000; server.requestTimeout = 60_000; server.keepAliveTimeout = 10_000;
server.listen(PORT, "127.0.0.1", () => console.log(`kubrai api on 127.0.0.1:${PORT} cluster=${CLUSTER} faucet=${FAUCET_ENABLED && !!faucet} rpc=${RPC.replace(/api-key=[^&\s]*/, "api-key=…")}`));
