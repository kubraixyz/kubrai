import { PublicKey } from "@solana/web3.js";
import { API_BASE, CLUSTER, IS_TEST, TOKEN_DECIMALS, TOKEN_SYMBOL } from "./config";
import { STATUS, totalPool, type MarketView } from "./kubrai";
import { fmtValue } from "./metrics";
import { connectWallet, devWallet, listWallets, type Session } from "./wallet";

export const fmtAmt = (base: number, digits = 2) => (base / 10 ** TOKEN_DECIMALS).toLocaleString("en-US", { maximumFractionDigits: digits });
export const fmtTs = (ts: number) => new Date(ts * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
export const short = (pk: PublicKey | string) => { const s = pk.toString(); return s.slice(0, 4) + "…" + s.slice(-4); };
export function statusPill(m: MarketView) {
  const now = Date.now() / 1000;
  const label = m.status === 0 ? (now < m.openTs ? "Upcoming" : now < m.closeTs ? "Open" : "Awaiting result") : STATUS[m.status];
  const cls = m.status === 0 ? "open" : STATUS[m.status].toLowerCase();
  return `<span class="pill ${cls}">${label}</span>`;
}
export function timeLeft(ts: number) {
  const s = ts - Date.now() / 1000; if (s <= 0) return "closed";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}
/** Human label of bucket i: "< t0", "t0 – t1", "≥ tlast". Yes/no markets read "No (< t)" / "Yes (≥ t)". */
export function bucketLabel(m: MarketView, i: number) {
  const f = (v: number) => fmtValue(m.metric, v).replace(/ [^ ]+$/, "");
  const t = m.thresholds, n = m.nBuckets;
  if (n === 2) return i === 1 ? `Yes · ≥ ${f(t[0])}` : `No · < ${f(t[0])}`;
  if (i === 0) return `< ${f(t[0])}`;
  if (i === n - 1) return `≥ ${f(t[n - 2])}`;
  return `${f(t[i - 1])} – ${f(t[i] - 1)}`;
}
const BUCKET_COLORS = ["#c4553f", "#c98a3a", "#a3a03a", "#5f9f4a", "#0f8f7c", "#2f7fb8", "#6a5fb8", "#9a4f9a"];
export const bucketColor = (m: MarketView, i: number) => (m.nBuckets === 2 ? (i === 1 ? "var(--yes)" : "var(--no)") : BUCKET_COLORS[Math.round((i * (BUCKET_COLORS.length - 1)) / Math.max(1, m.nBuckets - 1))]);
export function poolsHtml(m: MarketView, highlight = -1) {
  const tot = totalPool(m);
  const cells = m.pools.map((p, i) => `<div class="pool" style="--c:${bucketColor(m, i)}${highlight === i ? ";outline:2px solid var(--c)" : ""}"><b>${bucketLabel(m, i)}</b><span class="amt">${fmtAmt(p, 0)} ${TOKEN_SYMBOL}</span><div class="pct">${tot ? Math.round((p / tot) * 100) + "% of pool" : "no bets yet"}</div></div>`).join("");
  const bar = m.pools.map((p, i) => `<i style="width:${tot ? (p / tot) * 100 : 100 / m.nBuckets}%;background:${bucketColor(m, i)}"></i>`).join("");
  return `<div class="pools n${m.nBuckets}">${cells}</div><div class="bar multi">${bar}</div>${m.seed ? `<div class="note">+ ${fmtAmt(m.seed, 0)} ${TOKEN_SYMBOL} house prize added to the winning bucket, fee-free.</div>` : ""}`;
}

export function mountNetBadge() {
  const el = document.getElementById("netbadge"); if (!el) return;
  if (IS_TEST) el.innerHTML = `<span class="testnet">TEST NETWORK · ${CLUSTER} · tokens have no value</span>`;
}

let session: Session | null = null;
const listeners: ((s: Session | null) => void)[] = [];
export const onSession = (fn: (s: Session | null) => void) => { listeners.push(fn); fn(session); };
export const getSession = () => session;
function setSession(s: Session | null) { session = s; try { s ? localStorage.setItem("kubrai.wallet", s.label) : localStorage.removeItem("kubrai.wallet"); } catch {} listeners.forEach((f) => f(s)); renderWallet(); }

export function mountWallet() {
  renderWallet();
  // auto-reconnect the last wallet
  try {
    const last = localStorage.getItem("kubrai.wallet");
    if (last === "Test wallet (browser)") setSession(devWallet());
    else if (last) setTimeout(async () => { const w = listWallets().find((x) => x.name === last); if (w) try { setSession(await connectWallet(w)); } catch {} }, 300);
  } catch {}
}
function renderWallet() {
  const el = document.getElementById("wallet"); if (!el) return;
  if (session) {
    el.innerHTML = `<span class="mono note">${session.label} · ${short(session.publicKey)}</span>${IS_TEST && API_BASE ? `<button id="wfaucet" title="1000 ${TOKEN_SYMBOL} + a little SOL for fees, once per day">Get test tokens</button>` : ""}<button id="wdis">Disconnect</button>`;
    el.querySelector<HTMLButtonElement>("#wdis")!.onclick = async () => { await session?.disconnect(); setSession(null); };
    const f = el.querySelector<HTMLButtonElement>("#wfaucet");
    if (f) f.onclick = async () => {
      f.disabled = true; f.textContent = "Sending…";
      try { const r = await fetch(API_BASE + "/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: session!.publicKey.toBase58() }) }); const j = await r.json(); f.textContent = r.ok ? `Got ${j.tokens}` : (j.error ?? "Failed"); }
      catch (e: any) { f.textContent = "Faucet unreachable"; }
      setTimeout(() => { f.disabled = false; f.textContent = "Get test tokens"; }, 4000);
      listeners.forEach((fn) => fn(session));
    };
    return;
  }
  const wallets = listWallets();
  el.innerHTML = wallets.map((w, i) => `<button data-i="${i}">${w.name}</button>`).join("") + (IS_TEST ? `<button id="wdev" title="A throwaway keypair stored in this browser. Test network only.">Test wallet</button>` : "") + (wallets.length === 0 && !IS_TEST ? `<span class="note">Install Phantom, Solflare or open in Seeker</span>` : "");
  el.querySelectorAll<HTMLButtonElement>("button[data-i]").forEach((b) => (b.onclick = async () => { try { setSession(await connectWallet(wallets[Number(b.dataset.i)])); } catch (e: any) { alert(e.message ?? e); } }));
  const d = el.querySelector<HTMLButtonElement>("#wdev"); if (d) d.onclick = () => setSession(devWallet());
}
