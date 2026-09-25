// Metric sources. Every fetcher returns { value, raw, source } so the snapshot
// bundle carries the evidence, not just the number.
import { Connection, PublicKey } from "@solana/web3.js";
import { findAllDomainsForTld } from "@onsol/tldparser";
import { appMetricFetchers } from "./app-metrics.mjs";
const APP = appMetricFetchers();

const UA = "kubrai-snapshot/0.1 (+https://kubrai.xyz)";
const SKR_MINT = new PublicKey("SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3");
const SKR_STAKING_PROGRAM = new PublicKey("SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ");
const MAINNET = process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";

async function getJson(url, timeoutMs = 30000, retries = 1) {
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: ac.signal });
      if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (attempt >= retries) throw new Error(`${url}: ${e?.name === "AbortError" ? `timed out after ${timeoutMs} ms` : e?.message ?? e}`);
      await new Promise((res) => setTimeout(res, 5000));
    } finally { clearTimeout(t); }
  }
}

// --- Solana dApp Store (first-party GraphQL used by the store app itself; recovered from the app's operation documents) ---
const STORE_GQL = "https://dappstore.solanamobile.com/graphql";
// SystemContext is what the store app sends: locale, platform SDK level, screen density, device model.
const SYSTEM_CONTEXT = { locale: "en-US", platformSdk: 36, pixelDensity: 440, model: "Seeker" };
// Be a polite client: one request at a time, ≥250 ms apart, back off when the edge answers with HTML (WAF / rate limit).
let storeChain = Promise.resolve(); let lastStoreCall = 0;
// The edge is CloudFront with a rate rule: ~1,400 requests in 20 min (even at 100/min) earned the VPS IP a ~1 h 403.
// Catalog paging (≈70 requests/hour) runs at 1 req/s; the per-app review scan runs slower (STORE_REVIEW_GAP_MS).
const STORE_GAP_MS = Number(process.env.STORE_GAP_MS ?? 1000);
const STORE_REVIEW_GAP_MS = Number(process.env.STORE_REVIEW_GAP_MS ?? 2400);
function storeGql(query, variables = {}, timeoutMs = 60000, gapMs = STORE_GAP_MS) {
  const run = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = lastStoreCall + gapMs - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastStoreCall = Date.now();
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const r = await fetch(STORE_GQL, { method: "POST", headers: { "content-type": "application/json", "user-agent": UA }, body: JSON.stringify({ query, variables: { systemContext: SYSTEM_CONTEXT, ...variables } }), signal: ac.signal });
        const text = await r.text();
        if (!/^\s*\{/.test(text)) { if (attempt < 3) { await new Promise((res) => setTimeout(res, 15000 * (attempt + 1))); continue; } throw new Error(`store edge returned non-JSON (HTTP ${r.status}) after retries`); }
        const j = JSON.parse(text); if (j.errors?.length && !j.data) throw new Error("store graphql: " + JSON.stringify(j.errors).slice(0, 200)); return j.data;
      } finally { clearTimeout(t); }
    }
  };
  const p = storeChain.then(run, run); storeChain = p.catch(() => {}); return p;
}
const SUMMARY = `fragment S on DApp { androidPackage auxStatus { __typename } rating { rating reviewsByRating } lastRelease(systemContext: $systemContext) { displayName updatedOn androidDetails { versionCode } } }`;
/** Every listed app, deduplicated across categories (an app can sit in several). */
export async function storeCatalog() {
  const cats = (await storeGql(`query C($systemContext: SystemContext!) { topCategories(systemContext: $systemContext, first: 20) { edges { node { id name } } } }`)).topCategories.edges.map((e) => e.node);
  const apps = new Map(); const perCategory = {};
  for (const c of cats) {
    let after = null, n = 0;
    for (let page = 0; page < 80; page++) {
      const d = await storeGql(`query P($systemContext: SystemContext!, $id: ID!, $after: String) { dAppsCategory { dApps(systemContext: $systemContext, categoryId: $id, first: 20, after: $after) { edges { node { ...S } } pageInfo { hasNextPage endCursor } } } } ${SUMMARY}`, { id: c.id, after });
      const conn = d.dAppsCategory.dApps;
      for (const e of conn.edges) { n++; const a = e.node; if (!apps.has(a.androidPackage)) apps.set(a.androidPackage, { name: a.lastRelease?.displayName, reviews: (a.rating?.reviewsByRating ?? []).reduce((x, y) => x + y, 0), rating: a.rating?.rating ?? null, updatedOn: a.lastRelease?.updatedOn, aux: a.auxStatus?.__typename ?? null }); }
      if (!conn.pageInfo.hasNextPage) break; after = conn.pageInfo.endCursor;
    }
    perCategory[c.name] = n;
  }
  return { categories: cats.length, perCategory, apps };
}
import fs from "node:fs"; import path from "node:path";
const snapshotDir = () => process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots");
let catalogCache = null;
const catalog = async () => (catalogCache ??= await storeCatalog());
export async function dappStoreActiveApps() {
  const c = await catalog();
  const active = [...c.apps.values()].filter((a) => !a.aux || !/Uninstall/.test(a.aux)).length;
  const reviewTotals = Object.fromEntries([...c.apps.entries()].filter(([, a]) => a.reviews > 0).map(([p, a]) => [p, a.reviews]));
  return { value: active, raw: { activeCount: active, uniqueListed: c.apps.size, categories: c.categories, perCategory: c.perCategory, reviewTotals }, source: "dappstore.solanamobile.com/graphql (dAppsCategory, all categories, deduplicated by package)" };
}
/** Store-wide lifetime review count (sum over every listed app). Reviews are device-gated, so this counts phones acting. */
export async function storeReviewsTotal() {
  const c = await catalog(); let total = 0, appsWithReviews = 0;
  for (const a of c.apps.values()) { total += a.reviews; if (a.reviews > 0) appsWithReviews++; }
  return { value: total, raw: { total, appsWithReviews, appsListed: c.apps.size }, source: "dappstore.solanamobile.com/graphql (sum of every app's rating histogram)" };
}
export const APP_SLUGS = { jupiter: "ag.jup.jupiter.android", tokenrun: "com.tokenrun.app", mattle: "fun.mattle.twa", cherry: "fun.cherry", seedvault: "com.solanamobile.wallet", lootgo: "com.lootgo.app", jito: "network.jito.www.twa", sleepagotchi: "com.sleepagotchi.soft.app", moonwalk: "fit.moonwalk.mobile.app", ore: "supply.ore.app" };
/** Total reviews per watched app, straight from the store (sum of the 1–5★ histogram). */
export async function dappReviews() {
  const pkgs = Object.values(APP_SLUGS);
  const d = await storeGql(`query R($systemContext: SystemContext!, $pkgs: [String!]!) { dAppsByAndroidPackages(systemContext: $systemContext, androidPackages: $pkgs) { ...S } } ${SUMMARY}`, { pkgs });
  const byPkg = Object.fromEntries((d.dAppsByAndroidPackages ?? []).filter(Boolean).map((a) => [a.androidPackage, { reviews: (a.rating?.reviewsByRating ?? []).reduce((x, y) => x + y, 0), rating: a.rating?.rating ?? null, name: a.lastRelease?.displayName, histogram: a.rating?.reviewsByRating ?? null }]));
  const watched = Object.fromEntries(Object.entries(APP_SLUGS).map(([slug, pkg]) => [slug, byPkg[pkg] ?? null]));
  return { value: Object.values(watched).filter(Boolean).length, raw: watched, source: "dappstore.solanamobile.com/graphql (dAppsByAndroidPackages; reviews are device-gated)" };
}

/** Distinct reviewers and review count over the trailing 7 days, store-wide. Reviews are device-gated (one per
 *  device per app), so each extra reviewer is a phone.
 *  Cost control: recent reviews per app are cached (store-reviews-cache.json, unhashed). An app is re-scanned only
 *  when its lifetime total differs from the cached one; otherwise its cached recent reviews are reused. Deleted
 *  reviews therefore linger until the app's total changes again (rare, and the market uses a median anyway). */
const REVIEW_CACHE = "store-reviews-cache.json";
const readReviewCache = () => { try { return JSON.parse(fs.readFileSync(path.join(snapshotDir(), REVIEW_CACHE), "utf8")); } catch { return { apps: {} }; } };
const writeReviewCache = (cache) => { try { fs.writeFileSync(path.join(snapshotDir(), REVIEW_CACHE), JSON.stringify({ ...cache, savedAt: new Date().toISOString() })); } catch {} };
export async function storeReviewers7d() {
  const c = await catalog(); const now = Date.now(), since = now - 7 * 864e5, hardStop = now - 8 * 864e5;
  const cache = readReviewCache(); cache.apps ??= {};
  const apps = [...c.apps.entries()].filter(([, a]) => a.reviews > 0);
  const toScan = apps.filter(([p, a]) => cache.apps[p]?.total !== a.reviews).map(([p]) => p);
  let requests = 0, failures = 0, scanned = 0;
  const scan = async (pkg, total) => {
    let after = null; const recent = [];
    for (let page = 0; page < 30; page++) {
      let d; try { requests++; d = await storeGql(`query R($systemContext: SystemContext!, $p: String!, $after: String) { dAppReviews(systemContext: $systemContext, androidPackage: $p, first: 10, after: $after) { edges { node { id createdAt rating walletAddress domain } } pageInfo { hasNextPage endCursor } } }`, { p: pkg, after }, 60000, STORE_REVIEW_GAP_MS); } catch { return false; }
      const conn = d?.dAppReviews; if (!conn) return false; let oldest = Infinity;
      for (const { node: r } of conn.edges) { const t = Date.parse(r.createdAt); oldest = Math.min(oldest, t); if (t >= hardStop) recent.push({ t, w: r.walletAddress ?? null, d: r.domain ?? null, s: r.rating ?? null }); }
      if (!conn.pageInfo.hasNextPage || oldest < hardStop) break; after = conn.pageInfo.endCursor;
    }
    cache.apps[pkg] = { total, at: now, recent }; return true;
  };
  for (const pkg of toScan) {
    const ok = await scan(pkg, c.apps.get(pkg).reviews); if (ok) scanned++; else failures++;
    if (scanned % 25 === 0) writeReviewCache(cache);   // keep progress so a blocked run resumes instead of restarting
  }
  for (const p of Object.keys(cache.apps)) if (!c.apps.has(p)) delete cache.apps[p];   // delisted apps
  writeReviewCache(cache);
  if (failures > 0) throw new Error(`reviewers_7d: ${failures}/${toScan.length} apps failed to scan; refusing to report a partial count`);
  const wallets = new Set(), domains = new Set(); let reviews = 0, appsWithNew = 0;
  for (const [p] of apps) { const e = cache.apps[p]; if (!e) continue; let n = 0; for (const r of e.recent) { if (r.t < since || r.t > now) continue; n++; if (r.w) wallets.add(r.w); if (r.d) domains.add(r.d); } if (n) { appsWithNew++; reviews += n; } }
  return { value: wallets.size, raw: { reviewers7d: wallets.size, reviews7d: reviews, domains7d: domains.size, appsWithNewReviews: appsWithNew, appsRescanned: scanned, appsWithReviews: apps.length, appsTotal: c.apps.size, requests, failures }, source: "dappstore.solanamobile.com/graphql (dAppReviews per app, trailing 7 days, distinct walletAddress)" };
}

// --- Seeker Genesis Token: one per activated device; the Token-2022 group on the mint holds the count ---
const SGT_GROUP_MINT = new PublicKey("GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te");
export async function seekerGenesisTokens(conn = new Connection(MAINNET)) {
  const info = await conn.getParsedAccountInfo(SGT_GROUP_MINT);
  const ext = info.value?.data?.parsed?.info?.extensions ?? [];
  const grp = ext.find((e) => e.extension === "tokenGroup")?.state;
  if (!grp || typeof grp.size !== "number") throw new Error("tokenGroup extension not found on the Genesis Token mint");
  return { value: grp.size, raw: { groupMint: SGT_GROUP_MINT.toBase58(), size: grp.size, maxSize: grp.maxSize, updateAuthority: grp.updateAuthority }, source: "rpc getParsedAccountInfo(Genesis Token mint).tokenGroup.size" };
}

// --- SeekerTracker (third-party aggregator; kept only for metrics we cannot derive ourselves) ---
export async function skrIdsTotal() {
  const j = await getJson("https://seekertracker.com/api/activations");
  return { value: j.totalDomains, raw: { totalDomains: j.totalDomains, todayCount: j.todayCount, thisWeekCount: j.thisWeekCount, thisMonthCount: j.thisMonthCount, last: j.data?.slice(-7) }, source: "seekertracker.com/api/activations" };
}
export async function dailyActiveSeekers() {
  const j = await getJson("https://seekertracker.com/api/das");
  return { value: j.das, raw: { das: j.das, was: j.was, mas: j.mas, totalIndexed: j.totalIndexed, updatedAt: j.updatedAt }, source: "seekertracker.com/api/das" };
}
// --- On-chain (anyone can recompute against any RPC) ---
const SKR_TLD_PARENT = new PublicKey("F3A8kuikEiu6k2399oSJ1PWfcJYDHqpwoQ2e8psSDNuF"); // AllDomains parent account of the .skr TLD
/** Number of .skr name records on-chain (getProgramAccounts on the AllDomains name program, ~20 s). */
export async function skrIdsOnchain(conn = new Connection(MAINNET)) {
  const accts = await findAllDomainsForTld(conn, SKR_TLD_PARENT);
  return { value: accts.length, raw: { tldParent: SKR_TLD_PARENT.toBase58(), method: "findAllDomainsForTld (@onsol/tldparser)" }, source: "rpc getProgramAccounts(.skr name records)" };
}
export async function skrSupply(conn = new Connection(MAINNET)) {
  const s = await conn.getTokenSupply(SKR_MINT);
  return { value: Number(s.value.amount), raw: s.value, source: "rpc getTokenSupply" };
}
// SKR staking vault (found 2026-09-10 via getTokenLargestAccounts: the largest SKR
// holder, owned by a PDA of the staking program). We re-verify that ownership on
// every snapshot instead of trusting the constant.
const SKR_STAKING_VAULT = new PublicKey("8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8");
export async function skrStaked(conn = new Connection(MAINNET)) {
  const parsed = await conn.getParsedAccountInfo(SKR_STAKING_VAULT);
  const info = parsed.value?.data?.parsed?.info;
  if (!info || info.mint !== SKR_MINT.toBase58()) throw new Error("staking vault is not an SKR token account");
  const owner = new PublicKey(info.owner);
  const ownerAcc = await conn.getAccountInfo(owner);
  const ownedByStaking = ownerAcc?.owner?.equals(SKR_STAKING_PROGRAM) ?? false;
  if (!ownedByStaking) throw new Error("staking vault owner is no longer the staking program");
  return { value: Number(info.tokenAmount.amount), raw: { vault: SKR_STAKING_VAULT.toBase58(), vaultOwner: owner.toBase58(), vaultOwnerProgram: ownerAcc.owner.toBase58(), amount: info.tokenAmount.amount, uiAmount: info.tokenAmount.uiAmountString }, source: "rpc getParsedAccountInfo(staking vault)" };
}
export async function skrPriceUsd() {
  const j = await getJson(`https://lite-api.jup.ag/price/v3?ids=${SKR_MINT.toBase58()}`);
  const p = j[SKR_MINT.toBase58()];
  return { value: Math.round(Number(p.usdPrice) * 1e8), raw: p, source: "jup.ag price v3 (scaled 1e8)" };
}

// --- ORE (the mining game on Solana mainnet; every value is read from ORE program accounts, anyone can recompute) ---
export const ORE_PROGRAM = new PublicKey("oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv");
const ORE_BOARD = new PublicKey("BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi");
const oreRoundPda = (id) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(id)); return PublicKey.findProgramAddressSync([Buffer.from("round"), b], ORE_PROGRAM)[0]; };
const u64 = (d, o) => Number(d.readBigUInt64LE(o));
// Board account (40 bytes): round_id @8, production_cost_ema @32 (lamports per ORE). Round account (952 bytes): id @8,
// deployed[25] @16 (lamports per square), motherlode @656 (ORE base units, 11 decimals; > 0 only in a round that hit).
// Layouts verified against the mainnet accounts on 2026-09-03 and 2026-09-23.
let oreBoardOnce = null;   // one board read per snapshot run (the cost metric and the round scan share it)
export const oreBoard = (conn) => (oreBoardOnce ??= oreBoardRead(conn));
async function oreBoardRead(conn = new Connection(MAINNET)) {
  const a = await conn.getAccountInfo(ORE_BOARD);
  if (!a || !a.owner.equals(ORE_PROGRAM) || a.data.length < 40) throw new Error("ORE board account missing or not owned by the ORE program");
  return { roundId: u64(a.data, 8), costEmaLamports: u64(a.data, 32) };
}
/** Protocol-smoothed cost of one ORE in lamports (the ORE program's own production_cost_ema). */
export async function oreCostEma(conn = new Connection(MAINNET)) {
  const b = await oreBoard(conn);
  return { value: b.costEmaLamports, raw: { board: ORE_BOARD.toBase58(), roundId: b.roundId, costEmaLamports: b.costEmaLamports, costSolPerOre: b.costEmaLamports / 1e9 }, source: "rpc getAccountInfo(ORE board).production_cost_ema (lamports per ORE)" };
}
// Running totals over every finished ORE round (id < board.round_id): SOL deployed and motherlode hits. Each hourly
// snapshot continues from the latest earlier snapshot's totals (raw.toRound) and scans only the rounds since, so a
// daily market resolves on close − open like any cumulative metric. The ORE program keeps ~1,200 finished rounds
// (~21 h); a gap longer than that cannot be filled, so the metric fails instead of guessing. The very first snapshot
// starts both totals at 0 from the current round.
const ORE_CUM_KEY = "ore_deployed_cum";
function oreLatestTotals() {
  const dir = process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots");
  const cur = process.env.SNAPSHOT_SLOT ?? new Date().toISOString().slice(0, 13);
  if (!fs.existsSync(dir)) return null;
  const slots = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}T\d{2}\.json$/.test(f)).map((f) => f.slice(0, 13)).filter((s) => s < cur).sort().reverse();
  for (const s of slots) {
    try { const b = JSON.parse(fs.readFileSync(path.join(dir, s + ".json"), "utf8")); const d = b.metrics?.[ORE_CUM_KEY], h = b.metrics?.ore_motherlode_cum; if (d?.raw?.toRound != null && h?.raw?.toRound === d.raw.toRound) return { slot: s, toRound: d.raw.toRound, deployed: d.value, hits: h.value }; } catch {}
  }
  return null;
}
let oreScan = null;
async function oreRoundsScan(conn = new Connection(MAINNET)) {
  const board = await oreBoard(conn); const last = board.roundId - 1;
  const prev = oreLatestTotals();
  const from = prev ? prev.toRound + 1 : last + 1;
  if (from - 1 > last) throw new Error(`ORE round counter went backwards (previous ${prev?.toRound}, board ${board.roundId})`);
  let deployed = 0, hits = 0, rounds = 0; const hitRounds = [];
  const ids = []; for (let id = from; id <= last; id++) ids.push(id);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100); const accs = await conn.getMultipleAccountsInfo(chunk.map(oreRoundPda));
    accs.forEach((a, j) => {
      if (!a || !a.owner.equals(ORE_PROGRAM) || a.data.length < 952) throw new Error(`ORE round ${chunk[j]} is no longer on-chain: gap since snapshot ${prev?.slot} too long to fill`);
      const d = a.data; let tot = 0; for (let k = 0; k < 25; k++) tot += u64(d, 16 + k * 8);
      deployed += tot; rounds++; const ml = u64(d, 656); if (ml > 0) { hits++; hitRounds.push({ round: chunk[j], ore: ml / 1e11 }); }
    });
  }
  const base = { fromRound: from, toRound: last, rounds, prevSlot: prev?.slot ?? null, boardRound: board.roundId };
  return {
    ore_deployed_cum: { value: (prev?.deployed ?? 0) + deployed, raw: { ...base, deployedLamports: deployed, deployedSol: deployed / 1e9 }, source: "rpc getMultipleAccountsInfo(ORE round PDAs): sum of deployed[25] over finished rounds, running total" },
    ore_motherlode_cum: { value: (prev?.hits ?? 0) + hits, raw: { ...base, hits, hitRounds }, source: "rpc getMultipleAccountsInfo(ORE round PDAs): rounds with motherlode > 0, running total" },
  };
}
const oreShared = () => (oreScan ??= oreRoundsScan());
export const oreDeployedCum = async () => (await oreShared()).ore_deployed_cum;
export const oreMotherlodeCum = async () => (await oreShared()).ore_motherlode_cum;

// Hourly tier: cheap reads (≈80 store requests + a handful of RPC calls). Daily tier (the 00:00 UTC run) adds the
// expensive scans. Markets settle on whichever tier carries their source.
export const HOURLY_METRICS = {
  sgt_total: seekerGenesisTokens,
  dapp_store_active_apps: dappStoreActiveApps,
  store_reviews_total: storeReviewsTotal,
  dapp_reviews: dappReviews,
  skr_supply: skrSupply,
  skr_staked: skrStaked,
  skr_price_usd_e8: skrPriceUsd,
  skr_ids_total: skrIdsTotal,
  das: dailyActiveSeekers,
  ore_cost_ema: oreCostEma,
  ore_deployed_cum: oreDeployedCum,
  ore_motherlode_cum: oreMotherlodeCum,
  ...APP.hourly,
};
export const DAILY_METRICS = {
  reviewers_7d: storeReviewers7d,   // per-app review scan, minutes
  // skr_ids_onchain (skrIdsOnchain, ~20 s getProgramAccounts) is kept in the code but not recorded: no .skr markets since 2026-09-12.
  ...APP.daily,
};
export const METRICS = { ...HOURLY_METRICS, ...DAILY_METRICS };
