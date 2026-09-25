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
import { parseMetric, loadSlots, valueIn, median } from "./history.mjs";
import { leaderboard, readSettlements } from "./points.mjs";
import { resolveLang, translateHtml, langScript, LANGS } from "./i18n.mjs";
import { APP_METRIC_CATALOG } from "./app-metrics.mjs";
import * as referrals from "./referrals.mjs";
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

// ---------- pages ----------
// The built site (WEB_DIST) is served through here for its HTML only: each page goes out in the viewer's language
// (data-t markup swapped server-side, dictionary script added) and with the market list and config embedded as
// window.__BOOT__, so the first paint needs no API round trip. Assets stay on the static server.
const WEB_DIST = process.env.WEB_DIST ?? null;
const pageCache = new Map();   // file → { mtimeMs, html }
function readPage(name) {
  if (!WEB_DIST) return null;
  const f = path.join(WEB_DIST, name); let st; try { st = fs.statSync(f); } catch { return null; }
  const hit = pageCache.get(f); if (hit && hit.mtimeMs === st.mtimeMs) return hit.html;
  const html = fs.readFileSync(f, "utf8"); pageCache.set(f, { mtimeMs: st.mtimeMs, html }); return html;
}
async function servePage(req, res, url) {
  const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^[a-z-]+\.html$/.test(name)) return false;
  const raw = readPage(name); if (!raw) return false;
  const { lang } = resolveLang(req, url);
  let boot = "";
  try { const st = await chainState(); boot = `<script>window.__BOOT__=${JSON.stringify({ at: st.at, markets: st.markets, config: st.config, metricCatalog: APP_METRIC_CATALOG }).replace(/</g, "\\u003c")};</script>`; } catch {}
  const html = translateHtml(raw, lang).replace("</head>", () => boot + "</head>");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "private, max-age=0, must-revalidate", vary: "Cookie, Accept-Language", "content-language": lang, "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'" });
  res.end(html); return true;
}

// ---------- leaderboard (points.mjs) ----------
// Scored from the crank's settlement log, so it only ever counts markets that actually paid out. Recomputed when that
// file grows, not per request. Our own wallets (the demo bots that keep the devnet markets alive, throwaway wallets
// from browser tests) are listed in snapshots/test-wallets.json so the board can say so instead of passing them off
// as players; re-read every few minutes.
let testWallets = { at: 0, set: new Set() };
function ownWallets() {
  if (Date.now() - testWallets.at > 300_000) {
    let list = []; try { const f = path.join(SNAP, "test-wallets.json"); if (fs.existsSync(f)) list = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
    testWallets = { at: Date.now(), set: new Set(list) };
  }
  return testWallets.set;
}
const boardCache = new Map();
function leaderboardCached(key, since) {
  let stamp = "-"; try { const st = fs.statSync(path.join(SNAP, "settlements.jsonl")); stamp = `${st.size}:${st.mtimeMs}`; } catch {}
  const hit = boardCache.get(key);
  // A window that ends "n days ago" slides, so a cached board also goes stale on its own after a few minutes.
  if (hit && hit.stamp === stamp && Date.now() - hit.at < (since ? 300_000 : 3_600_000)) return hit;
  const v = { ...leaderboard(readSettlements(SNAP), since), at: Date.now(), stamp };
  boardCache.set(key, v); return v;
}

// ---------- referrals (referrals.mjs) ----------
// One file for every network (keyed by wallet address): point REFERRALS_FILE at the same path on mainnet.
const REFERRALS_FILE = process.env.REFERRALS_FILE ?? path.join(SNAP, "referrals.json");
const REFERRAL_PAYOUTS = path.join(SNAP, "referral-payouts.jsonl");
const SITE_URL = process.env.SITE_URL ?? (CLUSTER === "mainnet" ? "https://kubrai.xyz" : "https://devnet.kubrai.xyz");
const isPubkey = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s ?? ""));
const settledRowsOf = (wallet) => readSettlements(SNAP).filter((r) => r.owner === wallet);
// Open positions of a wallet straight from the chain (they close on payout, so settled history is checked separately).
const openPositionsOf = async (wallet) => (await roProgram.account.position.all([{ dataSize: roProgram.account.position.size }, { memcmp: { offset: 40, bytes: wallet } }])).length;
const betCache = new Map();   // wallet → { at, open, settled }
// A cache miss costs one getProgramAccounts call. A stranger can trigger misses at will (any address is a valid
// question), so they are budgeted per network per day and globally per minute; over budget the answer is 429.
// Reads (GET /referral/:wallet) and writes (bind / create a code) have separate per-minute budgets, so a stranger
// cycling through random addresses cannot stop real bindings.
const LOOKUP_IP_DAILY = Number(process.env.LOOKUP_IP_DAILY ?? 60), LOOKUP_PER_MINUTE = Number(process.env.LOOKUP_PER_MINUTE ?? 30);
const seenLookup = new Map(); let lookupMinute = { at: 0, get: 0, post: 0 };
function chargeLookup(ip, pool = "get") {
  rollDay(); const minute = Math.floor(Date.now() / 60_000); if (lookupMinute.at !== minute) lookupMinute = { at: minute, get: 0, post: 0 };
  if (lookupMinute[pool] >= LOOKUP_PER_MINUTE || (seenLookup.get(ip) ?? 0) >= LOOKUP_IP_DAILY) throw Object.assign(new Error("too many wallet lookups; try again later"), { status: 429 });
  lookupMinute[pool]++; seenLookup.set(ip, (seenLookup.get(ip) ?? 0) + 1);
  if (betCache.size > 5000) betCache.clear();
}
// "No bets yet" goes stale the moment the first bet lands, so it is only trusted for 10 s, and `fresh` skips it. A
// positive answer is trusted for 60 s even when `fresh`: a position cannot vanish in that time, while the RPC's
// account index can lag a few seconds behind the confirmation the browser just saw (one node says 1, the next says 0).
async function betHistory(wallet, fresh = false, ip = "?") {
  const hit = betCache.get(wallet); if (hit && Date.now() - hit.at < (hit.open + hit.settled ? 60_000 : fresh ? 0 : 10_000)) return hit;
  chargeLookup(ip, fresh ? "post" : "get");
  const v = { at: Date.now(), open: await openPositionsOf(wallet), settled: settledRowsOf(wallet).length };
  betCache.set(wallet, v); return v;
}
const referralPoints = () => new Map(leaderboardCached("all", 0).entries.map((e) => [e.wallet, e.points]));
const TOKEN_DECIMALS = 6, uiAmt = (raw) => Number(raw) / 10 ** TOKEN_DECIMALS;
function referralView(wallet) {
  const db = referrals.load(REFERRALS_FILE), rows = readSettlements(SNAP), pts = referralPoints();
  const earn = referrals.earnings(rows, db, (w) => pts.get(w) ?? 0), payouts = referrals.effectivePayouts(referrals.readPayouts(REFERRAL_PAYOUTS));
  const e = earn.byWallet.get(wallet), own = db.wallets[wallet], b = db.bindings[wallet] ?? null, points = pts.get(wallet) ?? 0;
  let paid = 0n; for (const p of payouts) if (p.wallet === wallet) paid += BigInt(p.raw);
  return { wallet, code: own?.code ?? null, link: own ? `${SITE_URL}/?ref=${own.code}` : null,
    bound: b ? { code: b.code, referrer: b.referrer.slice(0, 4) + "…" + b.referrer.slice(-4), at: b.at } : null,
    referred: e?.referred.size ?? 0, points, tierBps: referrals.tierBps(points), nextTier: referrals.nextTier(points), refereeBps: referrals.REFEREE_BPS, tiers: referrals.REFERRER_TIERS,
    earned: uiAmt(e?.raw ?? 0n), asReferrer: uiAmt(e?.asReferrer ?? 0n), asReferee: uiAmt(e?.asReferee ?? 0n), paid: uiAmt(paid), owed: uiAmt((e?.raw ?? 0n) - paid), settlements: e?.rows ?? 0,
    payouts: payouts.filter((p) => p.wallet === wallet).slice(-20).reverse().map(({ at, raw, ui, signature }) => ({ at, raw, amount: ui ?? uiAmt(raw), signature })) };
}

// rate limits: one faucet call per address per day, 20 per IP per day, a global daily cap; maps pruned daily
const seenAddr = new Map(), seenIp = new Map(); let seenDay = "", faucetToday = 0;
const dayKey = () => new Date().toISOString().slice(0, 10);
function rollDay() { const d = dayKey(); if (d !== seenDay) { seenDay = d; seenAddr.clear(); seenIp.clear(); seenFb.clear(); seenLookup.clear(); betCache.clear(); faucetToday = 0; } }
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") return json(res, 204, {});
  try {
    if (url.pathname === "/metrics") return json(res, 200, { metrics: APP_METRIC_CATALOG }, { "cache-control": "public, max-age=300" });
    if (url.pathname === "/health") return json(res, 200, { ok: true, cluster: CLUSTER, programId: state.programId, mint: state.mint, faucet: FAUCET_ENABLED, langs: LANGS });
    const li = url.pathname.match(/^\/i18n\/([A-Za-z-]{2,10})\.js$/);
    if (li) { const body = langScript(li[1]); if (body == null) return json(res, 404, { error: "no such language" }); res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" }); return res.end(body); }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname.endsWith(".html")) && (await servePage(req, res, url))) return;
    const po = url.pathname.match(/^\/positions\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
    if (po) {
      const f = path.join(SNAP, "settlements.jsonl");
      const rows = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.owner === po[1]) : [];
      return json(res, 200, { owner: po[1], settled: rows.reverse() }, { "cache-control": "no-store" });
    }
    // Leaderboard: points = SKR staked, per settled market (points.mjs). ?window=7d|30d|all, ?limit=n.
    if (url.pathname === "/leaderboard") {
      const w0 = url.searchParams.get("window"), win = w0 === "7d" || w0 === "30d" ? w0 : "all";   // also the cache key: never the raw string
      const days = win === "7d" ? 7 : win === "30d" ? 30 : 0;
      const since = days ? Math.floor(Date.now() / 1000) - days * 86400 : 0;
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));
      const board = leaderboardCached(win, since), own = ownWallets();
      return json(res, 200, { window: win, at: board.at, totals: board.totals, entries: board.entries.slice(0, limit).map((e) => ({ ...e, test: own.has(e.wallet) })) }, { "cache-control": "public, max-age=30" });
    }
    // ---------- referrals ----------
    // GET /referral/lookup/:code → who a code belongs to (for the "invited by" banner)
    const rl = url.pathname.match(/^\/referral\/lookup\/([A-Za-z0-9]{4,12})$/);
    if (rl) {
      const code = referrals.normalizeCode(rl[1]), w = referrals.referrerOf(referrals.load(REFERRALS_FILE), code);
      return json(res, 200, w ? { valid: true, code, referrer: w.slice(0, 4) + "…" + w.slice(-4), refereeBps: referrals.REFEREE_BPS } : { valid: false, code }, { "cache-control": "public, max-age=60" });
    }
    // GET /referral/:wallet → the wallet's code, link, binding and earnings
    const rw = url.pathname.match(/^\/referral\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
    if (rw && req.method === "GET") {
      let h; try { h = await betHistory(rw[1], false, clientIp(req)); } catch (e) { return json(res, e?.status ?? 500, { error: e?.message ?? "lookup failed" }); }
      return json(res, 200, { ...referralView(rw[1]), eligible: h.open + h.settled > 0, bets: h.open + h.settled, firstBet: h.settled === 0 && h.open > 0 }, { "cache-control": "no-store" });
    }
    // POST /referral/code {wallet} → create the wallet's code once it has placed a bet (nothing to sign: a code only
    // ever pays its owner)
    if (url.pathname === "/referral/code" && req.method === "POST") {
      let b; try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "bad body" }); }
      const wallet = String(b.wallet ?? ""); if (!isPubkey(wallet)) return json(res, 400, { error: "wallet required" });
      const db = referrals.load(REFERRALS_FILE);
      if (!db.wallets[wallet]) {
        let h; try { h = await betHistory(wallet, true, clientIp(req)); } catch (e) { return json(res, e?.status ?? 500, { error: e?.message ?? "lookup failed" }); }
        if (h.open + h.settled === 0) return json(res, 403, { error: "place a bet first — the link unlocks with your first stake" });
        // re-read after the await: another request may have saved meanwhile, and load → save must not span an await
        const cur = referrals.load(REFERRALS_FILE);
        referrals.ensureCode(cur, wallet); referrals.save(REFERRALS_FILE, cur);
        console.log("referral code", wallet.slice(0, 6), cur.wallets[wallet].code);
      }
      return json(res, 200, { ...referralView(wallet), eligible: true });
    }
    // POST /referral/bind {wallet, code, ts, signature} → bind a first-time bettor to the code it arrived with. The
    // wallet signs the canonical message naming this site and the time (valid BIND_MAX_AGE_SECS, so a signature
    // cannot be kept and replayed); only a wallet with an open position and no settled history qualifies (= first bet).
    if (url.pathname === "/referral/bind" && req.method === "POST") {
      let b; try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "bad body" }); }
      const wallet = String(b.wallet ?? ""), code = referrals.normalizeCode(b.code);
      if (!isPubkey(wallet) || !referrals.CODE_RE.test(code)) return json(res, 400, { error: "wallet and code required" });
      const host = new URL(SITE_URL).host, nowS = Math.floor(Date.now() / 1000), ts = Number(b.ts);
      let ok = false, why = "signature does not match the wallet";
      try {
        if (!Number.isInteger(ts) || Math.abs(nowS - ts) > referrals.BIND_MAX_AGE_SECS) why = "signature is too old; try again";
        else ok = nacl.sign.detached.verify(new TextEncoder().encode(referrals.bindMessage(wallet, code, host, ts)), bs58.decode(String(b.signature ?? "")), bs58.decode(wallet));
      } catch {}
      if (!ok) return json(res, 401, { error: why });
      const db = referrals.load(REFERRALS_FILE);
      if (db.bindings[wallet]) return json(res, db.bindings[wallet].code === code ? 200 : 409, db.bindings[wallet].code === code ? { ok: true, already: true } : { error: "this wallet is already bound to another code", permanent: true });
      if (!referrals.referrerOf(db, code)) return json(res, 404, { error: "unknown referral code", permanent: true });
      let h; try { h = await betHistory(wallet, true, clientIp(req)); } catch (e) { return json(res, e?.status ?? 500, { error: e?.message ?? "lookup failed" }); }
      if (h.open === 0 && h.settled === 0) return json(res, 409, { error: "place your first bet, then the link binds" });
      if (h.settled > 0) return json(res, 409, { error: "a referral link only counts on a wallet's first bet", permanent: true });
      // re-read after the await (see /referral/code): load → bind → save runs without yielding
      const cur = referrals.load(REFERRALS_FILE);
      if (cur.bindings[wallet]) return json(res, cur.bindings[wallet].code === code ? 200 : 409, cur.bindings[wallet].code === code ? { ok: true, already: true } : { error: "this wallet is already bound to another code", permanent: true });
      const r = referrals.bind(cur, { wallet, code, cluster: CLUSTER });
      if (r.error) return json(res, 409, { error: r.error, permanent: true });
      referrals.save(REFERRALS_FILE, cur);
      console.log("referral bind", wallet.slice(0, 6), "→", code);
      return json(res, 200, { ok: true });
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
      notify("⚠️ 有人對結算提出異議", `market ${market.slice(0, 8)}… · ${wallet.slice(0, 6)}…\n${reason.slice(0, 300)}\n→ 東京後台「結算裁決」分頁`, "dispute:" + market, 5);
      return json(res, 200, { ok: true, id: rec.id });
    }
    if (url.pathname === "/disputes") {
      const m = url.searchParams.get("market");
      const rows = fs.existsSync(DISPUTES) ? fs.readFileSync(DISPUTES, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
      return json(res, 200, { disputes: rows.filter((d) => !m || d.market === m).map(({ id, at, market, wallet, reason, claimedValue, status, resolution }) => ({ id, at, market, wallet: wallet.slice(0, 4) + "…" + wallet.slice(-4), reason, claimedValue, status, resolution })) });
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
      if (spec.kind === "daily") {
        // one number per UTC day from the source: show what it has reported so far for the days around the market's day
        const D = new Date(closeTs * 1000).toISOString().slice(0, 10), slots = loadSlots(SNAP), last = [...slots.keys()].sort().reverse().find((k) => slots.get(k)?.metrics?.[spec.src]?.raw?.series);
        const ser = last ? slots.get(last).metrics[spec.src].raw.series : [], src = last ? slots.get(last).metrics[spec.src].source : null;
        let resolution = null; const rf = id && /^\d+$/.test(id) ? path.join(SNAP, `resolution-${id}.json`) : null;
        if (rf && fs.existsSync(rf)) { const r = JSON.parse(fs.readFileSync(rf, "utf8")); resolution = { observed: r.observed, bucket: r.bucket, detail: r.detail, evidenceHash: r.evidenceHash, at: r.at, slot: (r.slots ?? [])[0] ?? null }; }
        return json(res, 200, { metric, kind: "daily", day: D, lagDays: spec.lagDays, source: src, latestSlot: last ?? null, recent: ser.slice(-7), reported: ser.find(([d]) => d === D)?.[1] ?? null, resolution }, { "cache-control": "public, max-age=60" });
      }
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
        // Devnet RPCs hand out a blockhash one node and simulate on another; "Blockhash not found" is transient, retry.
        let sig; for (let attempt = 1; ; attempt++) { try { sig = await sendAndConfirmTransaction(conn, tx, [faucet]); break; } catch (e) { if (attempt >= 3 || !/Blockhash not found|prior credit/i.test(String(e?.message ?? e))) throw e; await new Promise((r) => setTimeout(r, 1500)); } }
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
