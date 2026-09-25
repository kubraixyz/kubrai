// Leaderboard. Points come from the API (server/points.mjs): for every market you were settled in,
//   points = SKR staked, across every range you bet, won or lost.
import { esc, getSession, mountNetBadge, mountWallet, onSession, short } from "./ui";
import { API_BASE, CLUSTER, TOKEN_SYMBOL } from "./config";
import { fmtTs } from "./time";

mountNetBadge(); mountWallet();
const boardEl = document.getElementById("board")!, totalsEl = document.getElementById("totals")!, winEl = document.getElementById("windows")!, meEl = document.getElementById("me")!;
const WINDOWS: [string, string][] = [["all", "All time"], ["30d", "Last 30 days"], ["7d", "Last 7 days"]];
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
  boardEl.innerHTML = `<div class="note">Loading…</div>`;
  let j: any;
  try { const r = await fetch(`${API_BASE}/leaderboard?window=${encodeURIComponent(win)}&limit=100`); if (!r.ok) throw new Error(String(r.status)); j = await r.json(); }
  catch { boardEl.innerHTML = `<div class="note">The leaderboard is unavailable right now.</div>`; return; }
  const me = getSession()?.publicKey.toBase58() ?? null;
  const tot = j.totals ?? {};
  totalsEl.innerHTML = [["Players", String(tot.players ?? 0)], ["Markets settled", String(tot.markets ?? 0)], ["Points awarded", fmtPoints(tot.points ?? 0)]].map(([k, v]) => `<div><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join("");
  const rows: any[] = j.entries ?? [];
  const mine = me ? rows.find((e) => e.wallet === me) : null;
  meEl.innerHTML = me ? (mine ? `You are <b>#${Number(mine.rank)}</b> with <b class="mono">${esc(fmtPoints(mine.points))}</b> points · ${Number(mine.won)} of ${Number(mine.markets)} markets won.` : `Your wallet has no settled market in this window yet. Points arrive when a market you bet on pays out.`) : `Connect a wallet to see your own rank.`;
  if (!rows.length) { boardEl.innerHTML = `<div class="note">No market has settled in this window yet.</div>`; return; }
  boardEl.innerHTML = `<div class="scroll"><table class="tbl"><thead><tr><th>#</th><th>Wallet</th><th class="r">Points</th><th class="r">Markets</th><th class="r">Won</th><th class="r">Last settled</th></tr></thead><tbody>${rows.map((e) => `
    <tr${e.wallet === me ? ` class="me"` : ""}>
      <td class="mono">${Number(e.rank)}</td>
      <td><a class="mono" href="${explorer(e.wallet)}" target="_blank" rel="noopener">${esc(short(e.wallet))}</a>${e.wallet === me ? ` <b>you</b>` : ""}${e.test ? ` <span class="pill">Kubrai test bot</span>` : ""}</td>
      <td class="r mono"><b>${esc(fmtPoints(e.points))}</b></td>
      <td class="r mono">${Number(e.markets)}</td>
      <td class="r mono">${Number(e.won)} / ${Number(e.markets)}</td>
      <td class="r note">${esc(fmtTs(Date.parse(e.lastAt) / 1000))}</td>
    </tr>`).join("")}</tbody></table></div>
  <p class="note" style="margin-top:8px">1 point per ${TOKEN_SYMBOL} staked in a market that paid out, every range counted, won or lost. Voided markets score nothing. Wallets marked “Kubrai test bot” are ours: they keep the devnet pools moving and are not players.</p>`;
}
renderWindows(); load();
onSession(() => load());
