import { PublicKey } from "@solana/web3.js";
import { API_BASE, CLUSTER, IS_TEST, TOKEN_DECIMALS, TOKEN_SYMBOL } from "./config";
import { STATUS, connection, fetchConfig, totalPool, type MarketView } from "./kubrai";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { fmtExact, metricInfo } from "./metrics";
import { connectWallet, devWallet, listWallets, type Session } from "./wallet";
import { fmtTs as fmtTsLocal, timeLeft as timeLeftLocal } from "./time";
import { bindIfPending, captureReferral } from "./referral";
import { LANG, LANGS, setLang, t } from "./i18n";

/** HTML-escape anything that did not originate in our own source. */
export const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
export const isBase58 = (s: unknown) => typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,90}$/.test(s);
export const fmtAmt = (base: number, digits = 2) => (base / 10 ** TOKEN_DECIMALS).toLocaleString("en-US", { maximumFractionDigits: digits });
/** Viewer's local time with its zone named ("25 Sept 2026, 14:10 GMT+8"). */
export const fmtTs = fmtTsLocal;
export const short = (pk: PublicKey | string) => { const s = pk.toString(); return s.slice(0, 4) + "…" + s.slice(-4); };
export function statusPill(m: MarketView) {
  const now = Date.now() / 1000;
  const label = m.status === 0 ? (now < m.openTs ? t("status.upcoming") : now < m.closeTs ? t("status.open") : t("status.awaiting")) : t("status." + STATUS[m.status].toLowerCase());
  const cls = m.status === 0 ? (now < m.openTs ? "upcoming" : now < m.closeTs ? "open" : "awaiting") : STATUS[m.status].toLowerCase();
  return `<span class="pill ${cls}">${label}</span>`;
}
export const timeLeft = timeLeftLocal;
/** Human label of bucket i: "< t0", "t0 – t1", "≥ tlast". Yes/no markets read "No (< t)" / "Yes (≥ t)". Edges are printed
 *  exactly (fmtExact, never rounded); a middle range of a whole-number metric ends at the last whole number inside it ("11 – 12",
 *  or "= 10" when only one number fits), a scaled one (prices, SOL, SKR) is written "A – <B". */
export function bucketLabel(m: MarketView, i: number) {
  const f = (v: number) => fmtExact(m.metric, v).replace(/ [^ ]+$/, "");
  const th = m.thresholds, n = m.nBuckets, scaled = !!metricInfo(m.metric)?.scale;
  if (n === 2) return i === 1 ? `${t("bucket.yes")} · ≥ ${f(th[0])}` : `${t("bucket.no")} · < ${f(th[0])}`;
  if (i === 0) return `< ${f(th[0])}`;
  if (i === n - 1) return `≥ ${f(th[n - 2])}`;
  if (scaled) return `${f(th[i - 1])} – <${f(th[i])}`;
  return th[i] - th[i - 1] === 1 ? `= ${f(th[i - 1])}` : `${f(th[i - 1])} – ${f(th[i] - 1)}`;
}
const BUCKET_COLORS = ["#c4553f", "#c98a3a", "#a3a03a", "#5f9f4a", "#0f8f7c", "#2f7fb8", "#6a5fb8", "#9a4f9a"];
export const bucketColor = (m: MarketView, i: number) => (m.nBuckets === 2 ? (i === 1 ? "var(--yes)" : "var(--no)") : BUCKET_COLORS[Math.round((i * (BUCKET_COLORS.length - 1)) / Math.max(1, m.nBuckets - 1))]);
export function poolsHtml(m: MarketView, highlight = -1) {
  const tot = totalPool(m);
  const cells = m.pools.map((p, i) => `<div class="pool" style="--c:${bucketColor(m, i)}${highlight === i ? ";outline:2px solid var(--c)" : ""}"><b>${bucketLabel(m, i)}</b><span class="amt">${fmtAmt(p, 0)} ${TOKEN_SYMBOL}</span><div class="pct">${tot ? t("pool.pct", { pct: Math.round((p / tot) * 100) }) : t("pool.none")}</div></div>`).join("");
  const bar = m.pools.map((p, i) => `<i style="width:${tot ? (p / tot) * 100 : 100 / m.nBuckets}%;background:${bucketColor(m, i)}"></i>`).join("");
  return `<div class="pools n${m.nBuckets}">${cells}</div><div class="bar multi">${bar}</div>${m.seed ? `<div class="note">${t("pool.seed", { amt: fmtAmt(m.seed, 0), tok: TOKEN_SYMBOL })}</div>` : ""}`;
}

/** The system strip above the header: the test-network notice and the Android row. */
export function mountNetBadge() {
  const el = document.getElementById("netbadge");
  if (el && IS_TEST) el.innerHTML = `<span class="testnet">${t("net.test", { net: CLUSTER })}</span>`;
  mountLangPicker(); mountApkRow();
}
// Android build row (files served from /apk/, written by app/scripts/build-apk.sh). The API embeds latest-<cluster>.json
// as __BOOT__.apk and un-hides the row server-side with the link already set; this adds the version and size. The fetch
// is for the Vite dev server, which has no API. With no build and no test badge (mainnet) the whole strip goes.
async function mountApkRow() {
  const p = document.getElementById("apk"), bar = document.getElementById("sysbar");
  try {
    const boot = (globalThis as any).__BOOT__; let j = boot?.apk;
    if (!boot) { const r = await fetch("/apk/latest-" + CLUSTER + ".json", { cache: "no-store" }); if (r.ok) j = await r.json(); }
    const a = document.getElementById("apklink") as HTMLAnchorElement | null, meta = document.getElementById("apkmeta");
    if (p && a && meta && j?.file) { a.href = "/apk/" + j.file; a.title = "sha256 " + String(j.sha256 ?? ""); meta.textContent = t("apk.meta", { v: j.version, mb: (j.bytes / 1048576).toFixed(0) }); p.hidden = false; }
  } catch {}
  if (bar) bar.hidden = !IS_TEST && (!p || p.hidden);
}

let session: Session | null = null;
export const balances = { token: 0, sol: 0, loaded: false };
let mintCache: PublicKey | null = null;
/** Token + SOL balance of the connected wallet; safe when the token account does not exist yet. */
export async function refreshBalances() {
  if (!session) { balances.loaded = false; renderWallet(); return; }
  try {
    mintCache ??= new PublicKey((await fetchConfig()).mint);
    const [sol, tok] = await Promise.all([
      connection.getBalance(session.publicKey),
      connection.getTokenAccountBalance(getAssociatedTokenAddressSync(mintCache, session.publicKey)).then((r) => Number(r.value.amount)).catch(() => 0),
    ]);
    balances.sol = sol / 1e9; balances.token = tok; balances.loaded = true;
  } catch { balances.loaded = false; }
  renderWallet();
}
const listeners: ((s: Session | null) => void)[] = [];
export const onSession = (fn: (s: Session | null) => void) => { listeners.push(fn); fn(session); };
export const getSession = () => session;
function setSession(s: Session | null) { session = s; try { s ? localStorage.setItem("kubrai.wallet", s.label) : localStorage.removeItem("kubrai.wallet"); } catch {} balances.loaded = false; listeners.forEach((f) => f(s)); renderWallet(); refreshBalances(); if (s) bindIfPending(s); }

/** Feedback: a small button pinned to the corner of every page. No wallet needed; the note goes to /feedback with the
 *  page it was written on, plus the wallet address when one happens to be connected. Same endpoint the app uses. */
export function mountFeedback() {
  if (!API_BASE || document.getElementById("fbbtn")) return;
  const btn = document.createElement("button"); btn.id = "fbbtn"; btn.className = "fbbtn"; btn.textContent = t("fb.button");
  document.body.appendChild(btn);
  btn.onclick = () => {
    if (document.getElementById("fbbox")) return;
    const box = document.createElement("div"); box.id = "fbbox"; box.className = "fbbox";
    box.innerHTML = `<div class="fbhead"><b>${t("fb.head")}</b><button class="ghost" id="fbx" aria-label="${esc(t("common.close"))}">\u2715</button></div>
      <textarea id="fbmsg" rows="5" maxlength="4000" placeholder="${esc(t("fb.msgPh"))}"></textarea>
      <input id="fbcontact" maxlength="200" placeholder="${esc(t("fb.contactPh"))}">
      <input id="fbweb" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
      <div class="fbrow"><span class="note" id="fbnote">${t("fb.orEmail")}</span><button class="primary" id="fbsend">${t("fb.send")}</button></div>`;
    document.body.appendChild(box);
    const $ = <T extends HTMLElement>(id: string) => box.querySelector<T>("#" + id)!;
    const msg = $<HTMLTextAreaElement>("fbmsg"), send = $<HTMLButtonElement>("fbsend"), note = $("fbnote");
    msg.focus(); $("fbx").onclick = () => box.remove();
    send.onclick = async () => {
      if ($<HTMLInputElement>("fbweb").value) { box.remove(); return; }   // honeypot
      if (msg.value.trim().length < 5) { note.textContent = t("fb.tooShort"); return; }
      send.disabled = true; send.textContent = t("fb.sending");
      try {
        const r = await fetch(API_BASE + "/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: msg.value, wallet: session ? session.publicKey.toBase58() : null, diagnostics: { app: "web", page: location.pathname + location.search, contact: $<HTMLInputElement>("fbcontact").value.slice(0, 200), ua: navigator.userAgent.slice(0, 200), lang: navigator.language } }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "HTTP " + r.status);
        box.innerHTML = `<div class="fbhead"><b>${t("fb.thanks")}</b></div><div class="note">${t("fb.thanksNote")}</div>`;
        setTimeout(() => box.remove(), 2500);
      } catch (e: any) { note.textContent = t("fb.fail", { err: String(e?.message ?? e) }); send.disabled = false; send.textContent = t("fb.send"); }
    };
  };
}
/** Language picker in the header; the choice is a cookie so the server renders the next page in it. */
function mountLangPicker() {
  const host = document.querySelector("header.top"); if (!host || document.getElementById("lang")) return;
  const sel = document.createElement("select"); sel.id = "lang"; sel.className = "lang"; sel.setAttribute("aria-label", t("lang.label"));
  sel.innerHTML = LANGS.map(([k, name]) => `<option value="${k}"${k === LANG ? " selected" : ""}>${name}</option>`).join("");
  sel.onchange = () => setLang(sel.value);
  const box = document.getElementById("wallet"); if (box) box.before(sel); else host.appendChild(sel);
}
// The wallet is a pill at the right of the header; clicking it opens a menu (SharePot-style): the connect list, or the
// balance card with the faucet, Disconnect and links. Outside clicks and Escape close it.
let menuOpen = false;
export function openWalletMenu() { menuOpen = true; renderWallet(); document.getElementById("wmenu")?.scrollIntoView({ block: "nearest" }); }
// composedPath, not contains: picking a wallet re-renders the menu before this runs, so the clicked button is detached by then
document.addEventListener("click", (e) => { const box = document.getElementById("wallet"); if (menuOpen && box && !e.composedPath().includes(box)) { menuOpen = false; renderWallet(); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menuOpen) { menuOpen = false; renderWallet(); } });
export function mountWallet() {
  renderWallet(); captureReferral(); mountFeedback();
  // auto-reconnect the last wallet
  try {
    const last = localStorage.getItem("kubrai.wallet");
    if (last === DEV_WALLET_LABEL) setSession(devWallet());
    else if (last) setTimeout(async () => { const w = listWallets().find((x) => x.name === last); if (w) try { setSession(await connectWallet(w)); } catch {} }, 300);
  } catch {}
}
const DEV_WALLET_LABEL = "Test wallet (browser)";
function renderWallet() {
  const el = document.getElementById("wallet"); if (!el) return;
  const toggle = (e: Event) => { e.stopPropagation(); menuOpen = !menuOpen; renderWallet(); };
  if (!session) {
    const wallets = listWallets();
    el.innerHTML = `<button class="primary wbtn" id="wbtn">${t("wallet.connect")}</button>${menuOpen ? `<div class="menu" id="wmenu"><div class="mh">${t("wallet.connectTitle")}</div>${wallets.map((w, i) => `<button data-i="${i}">${esc(w.name)}</button>`).join("")}${IS_TEST ? `<button id="wdev" title="${esc(t("wallet.devTitle"))}">${t("wallet.dev")}</button>` : ""}${!wallets.length && !IS_TEST ? `<div class="note" style="padding:6px">${t("wallet.install")}</div>` : ""}</div>` : ""}`;
    el.querySelector<HTMLButtonElement>("#wbtn")!.onclick = toggle;
    el.querySelectorAll<HTMLButtonElement>("button[data-i]").forEach((b) => (b.onclick = async () => { try { setSession(await connectWallet(wallets[Number(b.dataset.i)])); } catch (e: any) { alert(e.message ?? e); } }));
    const d = el.querySelector<HTMLButtonElement>("#wdev"); if (d) d.onclick = () => setSession(devWallet());
    return;
  }
  const addr = session.publicKey.toBase58(), lowSol = balances.loaded && balances.sol < 0.002;
  el.innerHTML = `<button class="wbtn" id="wbtn"><span class="dot"></span><span class="mono">${short(addr)}</span>${balances.loaded ? `<span class="note">${fmtAmt(balances.token, 0)} ${TOKEN_SYMBOL}</span>` : ""}</button>${menuOpen ? `<div class="menu wmenu" id="wmenu">
    <div class="whead"><div><div class="mh">${esc(session.label === DEV_WALLET_LABEL ? t("wallet.dev") : session.label)}</div><button class="addr" id="wcopy" title="${esc(t("wallet.copyTitle"))}">${short(addr)}</button></div><button class="ghost" id="wdis">${t("wallet.disconnect")}</button></div>
    <div class="wtotal"><span class="note">${t("wallet.balance", { tok: TOKEN_SYMBOL })}</span><span class="sol">${balances.loaded ? balances.sol.toFixed(3) + " SOL" : ""}</span><b>${balances.loaded ? fmtAmt(balances.token) : "…"}</b></div>
    ${lowSol ? `<div class="note warn" style="padding:0 4px">${t("wallet.lowSol")}</div>` : ""}
    ${IS_TEST && API_BASE ? `<button id="wfaucet" class="cta" title="${esc(t("wallet.faucetTitle", { tok: TOKEN_SYMBOL }))}">${t("wallet.faucet")}</button>` : ""}
    <hr><a class="mi" href="/portfolio.html">${t("nav.mybets")}</a><a class="mi" href="/invite.html">${t("nav.invite")}</a></div>` : ""}`;
  el.querySelector<HTMLButtonElement>("#wbtn")!.onclick = toggle;
  const dis = el.querySelector<HTMLButtonElement>("#wdis"); if (dis) dis.onclick = async () => { await session?.disconnect(); setSession(null); };
  const cp = el.querySelector<HTMLButtonElement>("#wcopy");
  if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(addr); cp.textContent = t("common.copied"); } catch { cp.textContent = addr; } setTimeout(() => { if (cp.isConnected) cp.textContent = short(addr); }, 1500); };
  const f = el.querySelector<HTMLButtonElement>("#wfaucet");
  if (f) f.onclick = async () => {
    f.disabled = true; f.textContent = t("wallet.sending");
    let outcome = t("wallet.faucetUnreachable");
    try { const r = await fetch(API_BASE + "/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: addr }) }); const j = await r.json(); outcome = r.ok ? t("wallet.got", { what: j.tokens + (j.genesisToken && j.genesisToken !== "failed" ? " + " + t("wallet.testSgt") : "") }) : (j.error ?? t("wallet.failed")); }
    catch {}
    await refreshBalances();   // re-renders the menu; the button below is the new one
    const f2 = el.querySelector<HTMLButtonElement>("#wfaucet"); if (f2) { f2.disabled = true; f2.textContent = outcome; setTimeout(() => { if (f2.isConnected) { f2.disabled = false; f2.textContent = t("wallet.faucet"); } }, 5000); }
    listeners.forEach((fn) => fn(session));
  };
}
