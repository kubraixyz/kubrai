// Public read API + devnet faucet. Listens on 127.0.0.1 only; Caddy fronts it.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync, createTransferInstruction, createAssociatedTokenAccountIdempotentInstruction, TOKEN_2022_PROGRAM_ID, ExtensionType, getMintLen, createInitializeMintInstruction, createInitializeGroupMemberPointerInstruction, createInitializeNonTransferableMintInstruction, createMintToInstruction, createSetAuthorityInstruction, AuthorityType, TOKEN_GROUP_MEMBER_SIZE, TYPE_SIZE, LENGTH_SIZE } from "@solana/spl-token";
import { createInitializeMemberInstruction } from "@solana/spl-token-group";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { notify } from "./notify.mjs";
import { renderOps, handleOpsAction } from "./ops.mjs";
import { parseMetric, loadSlots, valueIn, median } from "./history.mjs";
import anchor from "@coral-xyz/anchor";

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
// Read-only view of the program state, cached 15 s, so the web/app first paint does not depend on a getProgramAccounts round-trip.
const IDL = JSON.parse(fs.readFileSync(new URL("../idl/kubrai.json", import.meta.url), "utf8"));
const roProgram = new anchor.Program(IDL, new anchor.AnchorProvider(conn, new anchor.Wallet(Keypair.generate()), { commitment: "confirmed" }));
const [roConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], roProgram.programId);
const [roFeeTiersPda] = PublicKey.findProgramAddressSync([Buffer.from("fee_tiers")], roProgram.programId);
const serializeTiers = (t) => t ? ({ sgtGroupMint: t.sgtGroupMint.toBase58(), sgtDiscountBps: t.sgtDiscountBps, stakeProgram: t.stakeProgram.toBase58(), stakeOwnerOffset: t.stakeOwnerOffset, stakeAmountOffset: t.stakeAmountOffset, stakeMinAmount: num(t.stakeMinAmount), stakeDiscountBps: t.stakeDiscountBps, minFeeBps: t.minFeeBps }) : null;
const tagOf = (b) => Buffer.from(b).toString("utf8").replace(/\0+$/, "");
const num = (x) => (x?.toNumber ? x.toNumber() : Number(x));
const serializeMarket = (pubkey, a) => ({ pubkey: pubkey.toBase58(), id: num(a.id), metric: tagOf(a.metric), nBuckets: a.nBuckets, thresholds: a.thresholds.slice(0, a.nBuckets - 1).map(num), openTs: num(a.openTs), closeTs: num(a.closeTs), resolveAfterTs: num(a.resolveAfterTs), baseline: num(a.baseline), pools: a.pools.slice(0, a.nBuckets).map(num), seed: num(a.seedAmount), status: a.status, outcome: a.outcome, proposedOutcome: a.proposedOutcome, proposedValue: num(a.proposedValue), proposedAt: num(a.proposedAt), positions: a.positions, positionsOpen: a.positionsOpen, feeCollected: num(a.feeCollected), snapshotHash: Buffer.from(a.snapshotHash).toString("hex") });
const serializeConfig = (c) => ({ admin: c.admin.toBase58(), proposer: c.proposer.toBase58(), treasury: c.treasury.toBase58(), mint: c.mint.toBase58(), feeBps: c.feeBps, earlyBirdDiscountBps: c.earlyBirdDiscountBps, earlyBirdSecs: num(c.earlyBirdSecs), disputeWindowSecs: num(c.disputeWindowSecs), minBet: num(c.minBet), marketCount: num(c.marketCount), paused: c.paused });
let chainCache = { at: 0, markets: null, config: null, pending: null };
const CHAIN_TTL_MS = Number(process.env.CHAIN_CACHE_MS ?? 15000);
function chainState() {
  if (chainCache.markets && Date.now() - chainCache.at < CHAIN_TTL_MS) return Promise.resolve(chainCache);
  if (chainCache.pending) return chainCache.markets ? Promise.resolve(chainCache) : chainCache.pending;   // stale-while-revalidate
  const stale = chainCache.markets ? chainCache : null;
  chainCache.pending = (async () => {
    const [all, cfg, tiers] = await Promise.all([roProgram.account.market.all([{ dataSize: roProgram.account.market.size }]), roProgram.account.config.fetch(roConfigPda), roProgram.account.feeTiers.fetchNullable(roFeeTiersPda).catch(() => null)]);
    chainCache = { at: Date.now(), markets: all.map((x) => serializeMarket(x.publicKey, x.account)).sort((a, b) => b.id - a.id), config: { ...serializeConfig(cfg), feeTiers: serializeTiers(tiers) }, pending: null };
    return chainCache;
  })().catch((e) => { chainCache.pending = null; throw e; });
  return stale ? Promise.resolve(stale) : chainCache.pending;
}
// Keep the cache warm so a page view never waits on a getProgramAccounts round-trip.
setInterval(() => chainState().catch(() => {}), CHAIN_TTL_MS).unref(); chainState().catch(() => {});
const mint = new PublicKey(state.mint);
const FAUCET_DAILY_GLOBAL = Number(process.env.FAUCET_DAILY_GLOBAL ?? 300);
const DISPUTES = path.join(SNAP, "disputes.jsonl");
const DIAG_MAX = 32 * 1024;

// rate limits: one faucet call per address per day, 20 per IP per day, a global daily cap; maps pruned daily
const seenAddr = new Map(), seenIp = new Map(); let seenDay = "", faucetToday = 0;
const dayKey = () => new Date().toISOString().slice(0, 10);
function rollDay() { const d = dayKey(); if (d !== seenDay) { seenDay = d; seenAddr.clear(); seenIp.clear(); seenFb.clear(); faucetToday = 0; } }
// Only Caddy talks to this socket; Caddy replaces X-Forwarded-For for untrusted clients, so its first hop is the real client.
const clientIp = (req) => String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();

// Devnet only: the faucet also hands out a stand-in Seeker Genesis Token (a member of the mock Token-2022 group whose
// authority is the faucet key), so testers can see the holder discount. Reads the group mint from SGT_GROUP_MINT or
// $KUBRAI_SECRETS/sgt-group-mint.txt; silently skipped when neither exists (mainnet).
const SGT_GROUP_MINT = (() => { try { return new PublicKey((process.env.SGT_GROUP_MINT ?? fs.readFileSync(path.join(process.env.KUBRAI_SECRETS ?? path.join(os.homedir(), "secrets", process.env.CLUSTER ?? "devnet"), "sgt-group-mint.txt"), "utf8")).trim()); } catch { return null; } })();
async function hasMockSgt(owner) {
  const res = await conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID });
  for (const a of res.value) {
    if (Number(a.account.data.parsed?.info?.tokenAmount?.amount ?? 0) < 1) continue;
    const mi = await conn.getParsedAccountInfo(new PublicKey(a.account.data.parsed.info.mint));
    const member = (mi.value?.data?.parsed?.info?.extensions ?? []).find((e) => e.extension === "tokenGroupMember")?.state;
    if (member?.group === SGT_GROUP_MINT.toBase58()) return true;
  }
  return false;
}
async function mintMockSgt(owner, payer) {
  const member = Keypair.generate();
  const mintLen = getMintLen([ExtensionType.GroupMemberPointer, ExtensionType.NonTransferable]);
  const lamports = await conn.getMinimumBalanceForRentExemption(mintLen + TYPE_SIZE + LENGTH_SIZE + TOKEN_GROUP_MEMBER_SIZE);
  const ata = getAssociatedTokenAddressSync(member.publicKey, owner, true, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: member.publicKey, space: mintLen, lamports, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeGroupMemberPointerInstruction(member.publicKey, payer.publicKey, member.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeNonTransferableMintInstruction(member.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(member.publicKey, 0, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    createInitializeMemberInstruction({ programId: TOKEN_2022_PROGRAM_ID, member: member.publicKey, memberMint: member.publicKey, memberMintAuthority: payer.publicKey, group: SGT_GROUP_MINT, groupUpdateAuthority: payer.publicKey }),
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, member.publicKey, TOKEN_2022_PROGRAM_ID),
    createMintToInstruction(member.publicKey, ata, payer.publicKey, 1, [], TOKEN_2022_PROGRAM_ID),
    createSetAuthorityInstruction(member.publicKey, payer.publicKey, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID),
  );
  return sendAndConfirmTransaction(conn, tx, [payer, member]);
}
// Devnet only: the faucet also registers the wallet as a stand-in ORE miner (programs/ore-miner-stub: same account layout
// and PDA seeds as ORE's Miner), so testers can see the ORE-miner discount. Program id from MINER_STUB_PROGRAM or
// $KUBRAI_SECRETS/miner-stub-program.txt; silently skipped when neither exists (mainnet, where the real ORE program is the rule).
const MINER_STUB_PROGRAM = (() => { try { return new PublicKey((process.env.MINER_STUB_PROGRAM ?? fs.readFileSync(path.join(SECRETS, "miner-stub-program.txt"), "utf8")).trim()); } catch { return null; } })();
async function registerStubMiner(owner, payer) {
  const [miner] = PublicKey.findProgramAddressSync([Buffer.from("miner"), owner.toBuffer()], MINER_STUB_PROGRAM);
  if (await conn.getAccountInfo(miner)) return "already registered";
  const data = Buffer.concat([createHash("sha256").update("global:register").digest().subarray(0, 8), owner.toBuffer()]);   // Anchor discriminator + authority arg
  const ix = new TransactionInstruction({ programId: MINER_STUB_PROGRAM, data, keys: [{ pubkey: miner, isSigner: false, isWritable: true }, { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] });
  await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer]);
  return "registered";
}
const json = (res, code, body, extra = {}) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS", ...extra }); res.end(JSON.stringify(body)); };
const readBody = (req, max = 4096) => new Promise((ok, err) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > max) { err(Object.assign(new Error("body too large"), { status: 413 })); req.destroy(); } }); req.on("end", () => ok(b)); req.on("error", err); });
const FEEDBACK_DIR = process.env.FEEDBACK_DIR ?? path.join(os.homedir(), "apps", "kubrai", "feedback");
fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
const seenFb = new Map();

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(os.homedir(), "apps", "kubrai", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
async function handleOps(req, res, url) {
  const ctx = { conn, state, SNAP, FEEDBACK_DIR, DISPUTES, CLUSTER, mint, faucet, SECRETS, readBody };
  // Operator file drop (behind Caddy basic auth): raw body → uploads/<safe name>. Used to hand me APKs/logs from the phone.
  if (url.pathname === "/ops/upload") {
    if (req.method === "GET") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kubrai ops · upload</title><body style="background:#15171b;color:#d9dce3;font:16px system-ui;padding:24px"><h1 style="font-size:20px">Upload a file to the operator box</h1><p>Any file up to 200 MB (APK, log, screenshot). It lands in the private uploads folder.</p><input id="f" type="file" style="display:block;margin:16px 0"><button id="b" style="font:inherit;padding:10px 16px">Upload</button><p id="m"></p><script>b.onclick=async()=>{const file=f.files[0];if(!file){m.textContent="Pick a file first";return}m.textContent="Uploading "+file.name+" ("+(file.size/1048576).toFixed(1)+" MB)…";const r=await fetch("/ops/upload?name="+encodeURIComponent(file.name),{method:"POST",body:file});m.textContent=await r.text()}</script>`); }
    if (req.method === "POST") {
      const name = String(url.searchParams.get("name") ?? "upload.bin").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
      const dest = path.join(UPLOAD_DIR, `${Date.now()}-${name}`); const out = fs.createWriteStream(dest); let size = 0;
      return new Promise((resolve) => {
        req.on("data", (c) => { size += c.length; if (size > 200 * 1024 * 1024) { req.destroy(); out.destroy(); fs.rmSync(dest, { force: true }); res.writeHead(413); res.end("too large"); resolve(); } });
        req.pipe(out); out.on("finish", () => { res.writeHead(200, { "content-type": "text/plain" }); res.end(`saved ${path.basename(dest)} (${(size / 1048576).toFixed(1)} MB)`); console.log("upload", dest, size); resolve(); });
        req.on("error", () => { fs.rmSync(dest, { force: true }); res.writeHead(500); res.end("upload failed"); resolve(); });
      });
    }
  }
  if (req.method === "POST" && url.pathname === "/ops/action") { const out = await handleOpsAction(ctx, JSON.parse(await readBody(req, 64 * 1024))); return json(res, out.status ?? 200, out); }
  const m = url.pathname.match(/^\/ops\/feedback\/([A-Za-z0-9._-]+\.(png|jpg))$/);
  if (m) { const f = path.join(FEEDBACK_DIR, m[1]); if (!fs.existsSync(f)) return json(res, 404, { error: "no such file" }); res.writeHead(200, { "content-type": m[2] === "png" ? "image/png" : "image/jpeg", "cache-control": "private, max-age=3600" }); return res.end(fs.readFileSync(f)); }
  const html = await renderOps(ctx, url);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(html);
}
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
      notify("📱 新回饋", `${rec.note.slice(0, 200) || "(no note)"}${rec.image ? " 📎" : ""} · app ${rec.diagnostics?.app ?? "?"}`, "feedback", 10);
      return json(res, 200, { ok: true, id });
    }
    // Public: raise a dispute on a proposed result. The wallet signs a canonical message so a dispute
    // is attributable; the server stores it and pages the operator. Resolution happens on-chain (re-propose / void).
    if (url.pathname === "/dispute" && req.method === "POST") {
      rollDay(); const ip = clientIp(req);
      const k = "dispute|" + ip; seenFb.set(k, (seenFb.get(k) ?? 0) + 1); if (seenFb.get(k) > 20) return json(res, 429, { error: "too many disputes from this network today" });
      let b; try { b = JSON.parse(await readBody(req, 64 * 1024)); } catch { return json(res, 400, { error: "bad body" }); }
      const market = String(b.market ?? ""), wallet = String(b.wallet ?? ""), reason = String(b.reason ?? "").slice(0, 2000), claimed = b.claimedValue == null ? null : String(b.claimedValue).slice(0, 40);
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(market) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet) || reason.length < 5) return json(res, 400, { error: "market, wallet and a reason (≥5 chars) are required" });
      const msg = `kubrai-dispute v1
market=${market}
wallet=${wallet}
claimed=${claimed ?? ""}
reason=${reason}`;
      let ok = false; try { ok = nacl.sign.detached.verify(new TextEncoder().encode(msg), bs58.decode(String(b.signature ?? "")), bs58.decode(wallet)); } catch {}
      if (!ok) return json(res, 401, { error: "signature does not match the wallet" });
      const rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), market, wallet, reason, claimedValue: claimed, status: "open" };
      fs.appendFileSync(DISPUTES, JSON.stringify(rec) + "\n");
      notify("⚠️ 有人對結算提出異議", `market ${market.slice(0, 8)}… · ${wallet.slice(0, 6)}…\n${reason.slice(0, 300)}\n→ 後台看:${process.env.OPS_URL ?? "/ops"}`, "dispute:" + market, 5);
      return json(res, 200, { ok: true, id: rec.id });
    }
    if (url.pathname === "/disputes") {
      const m = url.searchParams.get("market");
      const rows = fs.existsSync(DISPUTES) ? fs.readFileSync(DISPUTES, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
      return json(res, 200, { disputes: rows.filter((d) => !m || d.market === m).map(({ id, at, market, wallet, reason, claimedValue, status, resolution }) => ({ id, at, market, wallet: wallet.slice(0, 4) + "…" + wallet.slice(-4), reason, claimedValue, status, resolution })) });
    }
    // Operator console (Caddy enforces basic auth on /ops*; the API itself never listens off localhost).
    if (url.pathname === "/ops" || url.pathname.startsWith("/ops/")) {
      return handleOps(req, res, url);
    }
    // Settlement evidence for one market: which hourly snapshots feed it and what they say, so nobody has to dig.
    //   GET /evidence?metric=<tag>&open=<unix>&close=<unix>&baseline=<onchain>&id=<market id>
    // Cached program state (15 s): the list the home page renders, one market, the config.
    if (url.pathname === "/markets" || url.pathname === "/config" || /^\/markets\/\d+$/.test(url.pathname)) {
      let st; try { st = await chainState(); } catch (e) { return json(res, 503, { error: "chain read failed: " + String(e?.message ?? e).slice(0, 120) }); }
      const hdr = { "cache-control": "public, max-age=10" };
      if (url.pathname === "/config") return json(res, 200, { at: st.at, config: st.config }, hdr);
      if (url.pathname === "/markets") return json(res, 200, { at: st.at, markets: st.markets }, hdr);
      const m = st.markets.find((x) => x.id === Number(url.pathname.slice(9))); return m ? json(res, 200, { at: st.at, market: m, config: st.config }, hdr) : json(res, 404, { error: "no such market" });
    }
    if (url.pathname === "/evidence") {
      const metric = url.searchParams.get("metric") ?? "", openTs = Number(url.searchParams.get("open")), closeTs = Number(url.searchParams.get("close"));
      const baseline = Number(url.searchParams.get("baseline") ?? 0), id = url.searchParams.get("id");
      const spec = parseMetric(metric); if (!spec || !openTs || !closeTs) return json(res, 400, { error: "unknown metric or missing open/close" });
      const slots = loadSlots(SNAP); const slotOf = (ts) => new Date(ts * 1000).toISOString().slice(0, 13);
      const sOpen = slotOf(openTs), sClose = slotOf(closeTs);
      const side = (slot) => { const f = [path.join(SNAP, slot + ".json"), slot.endsWith("T00") ? path.join(SNAP, slot.slice(0, 10) + ".json") : null].find((x) => x && fs.existsSync(x)); if (!f) return null; return { slot, value: valueIn(slots.get(slot), spec.src), sha256: fs.existsSync(f + ".sha256") ? fs.readFileSync(f + ".sha256", "utf8").trim() : null, memo: fs.existsSync(f + ".memo") ? JSON.parse(fs.readFileSync(f + ".memo", "utf8")).signature : null }; };
      // legacy weekly medians use the seven daily T00 readings ending at close; everything else uses every hourly slot in the window
      const inWindow = spec.kind === "med7" ? [...slots.keys()].filter((sl) => sl.endsWith("T00") && sl <= sClose && Date.parse(sl + ":00:00Z") > closeTs * 1000 - 7 * 864e5).sort() : [...slots.keys()].filter((sl) => sl > sOpen && sl <= sClose).sort();
      const series = inWindow.map((sl) => ({ slot: sl, value: valueIn(slots.get(sl), spec.src) })).filter((x) => x.value != null);
      const opening = spec.kind === "cum" ? (baseline ? { slot: "on-chain", value: baseline } : side(sOpen)) : null;
      const latest = series.at(-1) ?? null;
      const soFar = spec.kind === "cum" ? (opening?.value != null && latest ? latest.value - opening.value : null) : spec.kind === "close" ? latest?.value ?? null : (series.length ? median(series.map((x) => x.value)) : null);
      let resolution = null; const rf = id && /^\d+$/.test(id) ? path.join(SNAP, `resolution-${id}.json`) : null;
      if (rf && fs.existsSync(rf)) { const r = JSON.parse(fs.readFileSync(rf, "utf8")); resolution = { observed: r.observed, bucket: r.bucket, slots: (r.slots ?? r.days ?? []).map((sl) => side(sl)), detail: r.detail, evidenceHash: r.evidenceHash, at: r.at }; }
      return json(res, 200, { metric, kind: spec.kind, source: spec.src, openSlot: sOpen, closeSlot: sClose, opening, latest, soFar, samples: series.length, expected: spec.kind === "med7" ? 7 : Math.max(1, Math.round((closeTs - openTs) / 3600)), series: spec.kind === "cum" ? series.slice(-24) : series, closing: side(sClose), resolution }, { "cache-control": "public, max-age=60" });
    }
    if (url.pathname === "/snapshots") {
      // slots: "YYYY-MM-DDTHH" (hourly, since 2026-09-12) or "YYYY-MM-DD" (the earlier daily files)
      const slots = fs.readdirSync(SNAP).filter((f) => /^\d{4}-\d{2}-\d{2}(T\d{2})?\.json$/.test(f)).map((f) => f.slice(0, -5)).sort();
      const days = [...new Set(slots.map((x) => x.slice(0, 10)))];
      return json(res, 200, { slots, days, latest: slots.at(-1) ?? null });
    }
    const m = url.pathname.match(/^\/snapshots\/(\d{4}-\d{2}-\d{2}(?:T\d{2})?)$/);
    if (m) {
      const f = path.join(SNAP, m[1] + ".json"); if (!fs.existsSync(f)) return json(res, 404, { error: "no snapshot for that slot" });
      const bundle = JSON.parse(fs.readFileSync(f, "utf8"));
      const sha256 = fs.existsSync(f + ".sha256") ? fs.readFileSync(f + ".sha256", "utf8").trim() : null;
      const memo = fs.existsSync(f + ".memo") ? JSON.parse(fs.readFileSync(f + ".memo", "utf8")) : null;
      return json(res, 200, { slot: m[1], day: m[1].slice(0, 10), sha256, memo, bundle }, { "cache-control": "public, max-age=300" });
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
        let sgt = null;
        if (SGT_GROUP_MINT) { try { sgt = (await hasMockSgt(address)) ? "already held" : await mintMockSgt(address, faucet); } catch (e) { console.error("mock SGT mint failed", e?.message); sgt = "failed"; } }
        let miner = null;
        if (MINER_STUB_PROGRAM) { try { miner = await registerStubMiner(address, faucet); } catch (e) { console.error("stub miner registration failed", e?.message); miner = "failed"; } }
        return json(res, 200, { ok: true, address: address.toBase58(), tokens: "1000 tSKR", sol: giveSol ? FAUCET_SOL + " SOL" : "already funded", genesisToken: sgt ? (sgt === "already held" || sgt === "failed" ? sgt : "test Genesis Token minted (−1% fee)") : undefined, oreMiner: miner ?? undefined, signatures: { tokens: sig, ...(giveSol ? { sol: sig } : {}), ...(sgt && sgt.length > 40 ? { genesisToken: sgt } : {}) } });
      } catch (e) { seenAddr.delete(k); faucetToday--; console.error("faucet failed", e?.message); return json(res, 503, { error: "faucet transaction failed, try again in a minute" }); }
    }
    json(res, 404, { error: "not found" });
  } catch (e) { console.error(e); json(res, 500, { error: "internal error" }); }
});
server.headersTimeout = 15_000; server.requestTimeout = 60_000; server.keepAliveTimeout = 10_000;
server.listen(PORT, "127.0.0.1", () => console.log(`kubrai api on 127.0.0.1:${PORT} cluster=${CLUSTER} faucet=${FAUCET_ENABLED && !!faucet} rpc=${RPC.replace(/api-key=[^&\s]*/, "api-key=…")}`));
