// Per-app metrics: one line of config per number (server/app-metrics.json) instead of one fetcher per app.
// Every entry becomes a snapshot field named by its `id`, and markets use the usual tags: <id>_day (increase over the
// window, for counters) or <id>_dmed (24-hour median, for levels). Kinds:
//   token_supply     { mint }                      circulating supply of an SPL / Token-2022 mint (e.g. JitoSOL = SOL staked with Jito)
//   token_balance    { account }                   balance of one token account (a vault, a treasury, a pool)
//   sol_balance      { address }                   lamports held by an account
//   account_u64      { address, offset, decimals } a u64 field inside an account (stake-pool totals, program counters)
//   defillama_tvl    { slug }                      protocol TVL in USD (DefiLlama, third-party aggregator)
//   defillama_dex    { slug, category? }           last-24h volume in USD (DefiLlama; category dexs | aggregators | derivatives)
//   jup_price        { mint, decimals? }           Jupiter price v3 in USD (third-party quote), stored ×1e8
//   program_tx       { program }                   running count of confirmed transactions that touched a program (cursor kept
//                                                  on disk; a gap longer than what the RPC still holds fails loudly instead of guessing)
// Each fetcher returns { value, raw, source } like the built-in ones, so the bundle carries evidence.
import fs from "node:fs";
import path from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";
import { fileURLToPath } from "node:url";

const MAINNET = process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";
const UA = "kubrai-snapshot/0.1 (+https://kubrai.xyz)";
const CFG = process.env.APP_METRICS ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "app-metrics.json");
const KIND_SOURCE = { token_supply: "onchain", token_balance: "onchain", sol_balance: "onchain", account_u64: "onchain", program_tx: "onchain", defillama_tvl: "thirdparty", defillama_dex: "thirdparty", jup_price: "thirdparty" };
export const APP_METRICS = fs.existsSync(CFG) ? JSON.parse(fs.readFileSync(CFG, "utf8")).metrics : [];
/** id → copy for the web/app (title, unit, scale, source, how); the API serves it as /metrics. */
export const APP_METRIC_CATALOG = Object.fromEntries(APP_METRICS.map((m) => [m.id, { id: m.id, app: m.app, package: m.package ?? null, noun: m.noun, level: m.level ?? m.noun, unit: m.unit, scale: m.scale ?? 1, digits: m.digits ?? 0, source: m.source ?? KIND_SOURCE[m.kind], how: m.how ?? "", pushCost: m.pushCost ?? null, kind: m.kind }]));

async function getJson(url, timeoutMs = 30000, retries = 1) {
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
    try { const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: ac.signal }); if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (attempt >= retries) throw new Error(`${url}: ${e?.name === "AbortError" ? `timed out after ${timeoutMs} ms` : e?.message ?? e}`); await new Promise((res) => setTimeout(res, 5000)); }
    finally { clearTimeout(t); }
  }
}
let connOnce = null; const conn = () => (connOnce ??= new Connection(MAINNET, "confirmed"));
const STATE_DIR = process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "snapshots");

const FETCH = {
  token_supply: (m) => async () => { const s = await conn().getTokenSupply(new PublicKey(m.mint)); return { value: Number(s.value.amount), raw: { mint: m.mint, decimals: s.value.decimals, uiAmount: s.value.uiAmountString }, source: `getTokenSupply ${m.mint}` }; },
  token_balance: (m) => async () => { const s = await conn().getTokenAccountBalance(new PublicKey(m.account)); return { value: Number(s.value.amount), raw: { account: m.account, decimals: s.value.decimals, uiAmount: s.value.uiAmountString }, source: `getTokenAccountBalance ${m.account}` }; },
  sol_balance: (m) => async () => { const l = await conn().getBalance(new PublicKey(m.address)); return { value: l, raw: { address: m.address, sol: l / 1e9 }, source: `getBalance ${m.address}` }; },
  account_u64: (m) => async () => { const a = await conn().getAccountInfo(new PublicKey(m.address)); if (!a) throw new Error(`account ${m.address} not found`); const v = a.data.readBigUInt64LE(m.offset); return { value: Number(v), raw: { address: m.address, offset: m.offset, owner: a.owner.toBase58(), len: a.data.length }, source: `account ${m.address} u64@${m.offset}` }; },
  defillama_tvl: (m) => async () => { const v = await getJson(`https://api.llama.fi/tvl/${m.slug}`); if (typeof v !== "number") throw new Error(`defillama tvl ${m.slug}: not a number`); return { value: Math.round(v), raw: { slug: m.slug, usd: v }, source: `https://api.llama.fi/tvl/${m.slug}` }; },
  defillama_dex: (m) => async () => { const cat = m.category ?? "dexs"; const url = `https://api.llama.fi/summary/${cat}/${m.slug}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`; const j = await getJson(url); const v = j?.total24h; if (typeof v !== "number") throw new Error(`defillama ${cat} ${m.slug}: no total24h`); return { value: Math.round(v), raw: { slug: m.slug, category: cat, total24h: v, total7d: j.total7d ?? null }, source: url.split("?")[0] }; },
  jup_price: (m) => async () => { const j = await getJson(`https://lite-api.jup.ag/price/v3?ids=${m.mint}`); const p = j?.[m.mint]?.usdPrice; if (typeof p !== "number") throw new Error(`jupiter price ${m.mint}: missing`); return { value: Math.round(p * 1e8), raw: { mint: m.mint, usdPrice: p }, source: "https://lite-api.jup.ag/price/v3" }; },
  program_tx: (m) => async () => {
    // Running total of signatures for the program since we started counting; the cursor (newest signature seen) lives in
    // snapshots/program-tx-<id>.json. If the RPC no longer holds the cursor (gap too long) the metric fails: no guessing.
    const f = path.join(STATE_DIR, `program-tx-${m.id}.json`); let st = { total: 0, cursor: null }; try { st = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
    const pk = new PublicKey(m.program); let count = 0, before = undefined, newest = null, pages = 0;
    for (;;) {
      const sigs = await conn().getSignaturesForAddress(pk, { limit: 1000, before, until: st.cursor ?? undefined });
      if (!sigs.length) break;
      newest ??= sigs[0].signature; count += sigs.filter((s) => !s.err).length; before = sigs[sigs.length - 1].signature; pages++;
      if (sigs.length < 1000) break;
      if (pages >= (m.maxPages ?? 60)) throw new Error(`program_tx ${m.id}: more than ${pages * 1000} signatures since the last run; refusing to undercount`);
    }
    if (st.cursor && pages && count === 0 && newest) { /* nothing new */ }
    const total = st.total + count; if (newest) fs.writeFileSync(f, JSON.stringify({ total, cursor: newest, at: new Date().toISOString() }));
    return { value: total, raw: { program: m.program, added: count, pages, cursor: newest ?? st.cursor }, source: `getSignaturesForAddress ${m.program} (running total)` };
  },
};
/** { hourly: {id: fn}, daily: {id: fn} } for snapshot.mjs */
export function appMetricFetchers() {
  const hourly = {}, daily = {};
  for (const m of APP_METRICS) { if (!FETCH[m.kind]) throw new Error(`app-metrics.json: unknown kind ${m.kind} for ${m.id}`); (m.tier === "daily" ? daily : hourly)[m.id] = FETCH[m.kind](m); }
  return { hourly, daily };
}
