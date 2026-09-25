// Leaderboard. Points come from the API (server/points.mjs): for every market you were settled in,
//   points = SKR staked, across every range you bet, won or lost.
import { esc, getSession, mountNetBadge, mountWallet, onSession, short } from "./ui";
import { API_BASE, CLUSTER, TOKEN_SYMBOL } from "./config";
import { fmtTs } from "./time";
import { t } from "./i18n";

mountNetBadge(); mountWallet();
const boardEl = document.getElementById("board")!, totalsEl = document.getElementById("totals")!, winEl = document.getElementById("windows")!, meEl = document.getElementById("me")!;
const WINDOWS: [string, string][] = [["all", t("lb.all")], ["30d", t("lb.30d")], ["7d", t("lb.7d")]];
let win = new URLSearchParams(location.search).get("window") ?? "all";
if (!WINDOWS.some(([k]) => k === win)) win = "all";
const explorer = (w: string) => `https://explorer.solana.com/address/${w}?cluster=${CLUSTER === "mainnet" ? "mainnet-beta" : "devnet"}`;
const fmtPoints = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e4 ? (v / 1e3).toFixed(1) + "k" : v.toLocaleString("en-US", { maximumFractionDigits: 0 }));

function renderWindows() {
  winEl.innerHTML = WINDOWS.map(([k, label]) => `<button class="tab${k === win ? " on" : ""}" data-w="${k}" role="tab">${esc(label)}</button>`).join("");
  winEl.querySelectorAll<HTMLButtonElement>("button[data-w]").forEach((b) => (b.onclick = () => {
    win = b.dataset.w!; const u = new URL(location.href); u.searchParams.set("window", win); history.replaceState(null, "", u);
    renderWindows(); load();
  }));
}
async function load() {
  boardEl.innerHTML = `<div class="note">${t("common.loading")}</div>`;
  let j: any;
  try { const r = await fetch(`${API_BASE}/leaderboard?window=${encodeURIComponent(win)}&limit=100`); if (!r.ok) throw new Error(String(r.status)); j = await r.json(); }
  catch { boardEl.innerHTML = `<div class="note">${t("lb.err")}</div>`; return; }
  const me = getSession()?.publicKey.toBase58() ?? null;
  const tot = j.totals ?? {};
  totalsEl.innerHTML = [[t("lb.players"), String(tot.players ?? 0)], [t("lb.settled"), String(tot.markets ?? 0)], [t("lb.awarded"), fmtPoints(tot.points ?? 0)]].map(([k, v]) => `<div><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join("");
  const rows: any[] = j.entries ?? [];
  const mine = me ? rows.find((e) => e.wallet === me) : null;
  meEl.innerHTML = me ? (mine ? t("lb.me", { rank: `<b>#${Number(mine.rank)}</b>`, pts: `<b class="mono">${esc(fmtPoints(mine.points))}</b>`, won: Number(mine.won), n: Number(mine.markets) }) : t("lb.meNone")) : t("lb.connect");
  if (!rows.length) { boardEl.innerHTML = `<div class="note">${t("lb.empty")}</div>`; return; }
  boardEl.innerHTML = `<div class="scroll"><table class="tbl"><thead><tr><th>#</th><th>${t("lb.colWallet")}</th><th class="r">${t("lb.colPoints")}</th><th class="r">${t("lb.colMarkets")}</th><th class="r">${t("lb.colWon")}</th><th class="r">${t("lb.colLast")}</th></tr></thead><tbody>${rows.map((e) => `
    <tr${e.wallet === me ? ` class="me"` : ""}>
      <td class="mono">${Number(e.rank)}</td>
      <td><a class="mono" href="${explorer(e.wallet)}" target="_blank" rel="noopener">${esc(short(e.wallet))}</a>${e.wallet === me ? ` <b>${t("lb.you")}</b>` : ""}${e.test ? ` <span class="pill">${t("lb.test")}</span>` : ""}</td>
      <td class="r mono"><b>${esc(fmtPoints(e.points))}</b></td>
      <td class="r mono">${Number(e.markets)}</td>
      <td class="r mono">${Number(e.won)} / ${Number(e.markets)}</td>
      <td class="r note">${esc(fmtTs(Date.parse(e.lastAt) / 1000))}</td>
    </tr>`).join("")}</tbody></table></div>
  <p class="note" style="margin-top:8px">${t("lb.how", { tok: TOKEN_SYMBOL })}</p>`;
}
renderWindows(); load();
onSession(() => load());
