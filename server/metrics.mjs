// Metric sources. Every fetcher returns { value, raw, source } so the snapshot
// bundle carries the evidence, not just the number.
import { Connection, PublicKey } from "@solana/web3.js";
import { findAllDomainsForTld } from "@onsol/tldparser";

const UA = "kubrai-snapshot/0.1 (+https://kubrai.xyz)";
const SKR_MINT = new PublicKey("SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3");
const SKR_STAKING_PROGRAM = new PublicKey("SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ");
const MAINNET = process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";

async function getJson(url, timeoutMs = 30000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: ac.signal });
    if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// --- Solana dApp Store (first-party GraphQL used by the store app itself; recovered from the app's operation documents) ---
const STORE_GQL = "https://dappstore.solanamobile.com/graphql";
// SystemContext is what the store app sends: locale, platform SDK level, screen density, device model.
const SYSTEM_CONTEXT = { locale: "en-US", platformSdk: 36, pixelDensity: 440, model: "Seeker" };
// Be a polite client: one request at a time, ≥250 ms apart, back off when the edge answers with HTML (WAF / rate limit).
let storeChain = Promise.resolve(); let lastStoreCall = 0;
const STORE_GAP_MS = Number(process.env.STORE_GAP_MS ?? 600);   // ≤100 req/min: a full first scan takes ~13 min, later days only touch apps whose totals moved
function storeGql(query, variables = {}, timeoutMs = 60000) {
  const run = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = lastStoreCall + STORE_GAP_MS - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
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
/** Per-app lifetime review totals from the most recent snapshot file before today (null if none). */
function previousCatalogTotals() {
  try {
    const dir = process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots"); const today = new Date().toISOString().slice(0, 10);
    const days = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) < today).sort();
    for (let i = days.length - 1; i >= 0; i--) { const t = JSON.parse(fs.readFileSync(path.join(dir, days[i]), "utf8")).metrics?.dapp_store_active_apps?.raw?.reviewTotals; if (t) return t; }
  } catch {}
  return null;
}
let catalogCache = null;
const catalog = async () => (catalogCache ??= await storeCatalog());
export async function dappStoreActiveApps() {
  const c = await catalog();
  const active = [...c.apps.values()].filter((a) => !a.aux || !/Uninstall/.test(a.aux)).length;
  const reviewTotals = Object.fromEntries([...c.apps.entries()].filter(([, a]) => a.reviews > 0).map(([p, a]) => [p, a.reviews]));
  return { value: active, raw: { activeCount: active, uniqueListed: c.apps.size, categories: c.categories, perCategory: c.perCategory, reviewTotals }, source: "dappstore.solanamobile.com/graphql (dAppsCategory, all categories, deduplicated by package)" };
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
 *  device per app), so each extra reviewer is a phone. Pages each app's reviews newest-first until older than 8 days. */
export async function storeReviewers7d() {
  const c = await catalog(); const since = Date.now() - 7 * 864e5, hardStop = Date.now() - 8 * 864e5;
  // Only apps whose lifetime review total moved since the last snapshot can have new reviews; the rest are skipped.
  const prev = previousCatalogTotals();
  const pkgs = [...c.apps.entries()].filter(([p, a]) => a.reviews > 0 && (prev == null || (prev[p] ?? 0) !== a.reviews)).map(([p]) => p);
  const wallets = new Set(), domains = new Set(); let reviews = 0, appsWithNew = 0, requests = 0, failures = 0;
  const worker = async (pkg) => {
    let after = null, newHere = 0;
    for (let page = 0; page < 30; page++) {
      let d; try { requests++; d = await storeGql(`query R($systemContext: SystemContext!, $p: String!, $after: String) { dAppReviews(systemContext: $systemContext, androidPackage: $p, first: 10, after: $after) { edges { node { id createdAt rating walletAddress domain } } pageInfo { hasNextPage endCursor } } }`, { p: pkg, after }); } catch { failures++; return; }
      const conn = d?.dAppReviews; if (!conn) { failures++; return; } let oldest = Infinity;
      for (const { node: r } of conn.edges) { const t = Date.parse(r.createdAt); oldest = Math.min(oldest, t); if (t >= since) { reviews++; newHere++; if (r.walletAddress) wallets.add(r.walletAddress); if (r.domain) domains.add(r.domain); } }
      if (!conn.pageInfo.hasNextPage || oldest < hardStop) break; after = conn.pageInfo.endCursor;
    }
    if (newHere) appsWithNew++;
  };
  for (const pkg of pkgs) await worker(pkg);   // storeGql already serializes; keep it simple
  return { value: wallets.size, raw: { reviewers7d: wallets.size, reviews7d: reviews, domains7d: domains.size, appsWithNewReviews: appsWithNew, appsScanned: pkgs.length, appsTotal: c.apps.size, usedDiff: prev != null, requests, failures }, source: "dappstore.solanamobile.com/graphql (dAppReviews per app, trailing 7 days, distinct walletAddress)" };
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

export const METRICS = {
  skr_ids_onchain: skrIdsOnchain,
  skr_ids_total: skrIdsTotal,
  dapp_reviews: dappReviews,
  sgt_total: seekerGenesisTokens,
  reviewers_7d: storeReviewers7d,
  das: dailyActiveSeekers,
  dapp_store_active_apps: dappStoreActiveApps,
  skr_supply: skrSupply,
  skr_staked: skrStaked,
  skr_price_usd_e8: skrPriceUsd,
};
