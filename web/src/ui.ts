import { PublicKey } from "@solana/web3.js";
import { CLUSTER, IS_TEST, TOKEN_DECIMALS, TOKEN_SYMBOL } from "./config";
import { STATUS, type MarketView } from "./kubrai";
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
export function poolsHtml(m: MarketView) {
  const tot = m.poolYes + m.poolNo, py = tot ? Math.round((m.poolYes / tot) * 100) : 50;
  return `<div class="pools">
    <div class="pool yes"><b>Yes</b><span class="amt">${fmtAmt(m.poolYes, 0)} ${TOKEN_SYMBOL}</span><div class="pct">${tot ? py + "% of pool" : "no bets yet"}</div></div>
    <div class="pool no"><b>No</b><span class="amt">${fmtAmt(m.poolNo, 0)} ${TOKEN_SYMBOL}</span><div class="pct">${tot ? 100 - py + "% of pool" : "no bets yet"}</div></div>
  </div><div class="bar"><i style="width:${py}%"></i></div>${m.seed ? `<div class="note">+ ${fmtAmt(m.seed, 0)} ${TOKEN_SYMBOL} house prize added to the winning side, fee-free.</div>` : ""}`;
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
  if (session) { el.innerHTML = `<span class="mono note">${session.label} · ${short(session.publicKey)}</span><button id="wdis">Disconnect</button>`; el.querySelector<HTMLButtonElement>("#wdis")!.onclick = async () => { await session?.disconnect(); setSession(null); }; return; }
  const wallets = listWallets();
  el.innerHTML = wallets.map((w, i) => `<button data-i="${i}">${w.name}</button>`).join("") + (IS_TEST ? `<button id="wdev" title="A throwaway keypair stored in this browser. Test network only.">Test wallet</button>` : "") + (wallets.length === 0 && !IS_TEST ? `<span class="note">Install Phantom, Solflare or open in Seeker</span>` : "");
  el.querySelectorAll<HTMLButtonElement>("button[data-i]").forEach((b) => (b.onclick = async () => { try { setSession(await connectWallet(wallets[Number(b.dataset.i)])); } catch (e: any) { alert(e.message ?? e); } }));
  const d = el.querySelector<HTMLButtonElement>("#wdev"); if (d) d.onclick = () => setSession(devWallet());
}
