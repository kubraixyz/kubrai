import { fetchMarkets, type MarketView } from "./kubrai";
import { fmtValue, metricLabel } from "./metrics";
import { fmtAmt, mountNetBadge, mountWallet, poolsHtml, statusPill, timeLeft } from "./ui";
import { TOKEN_SYMBOL } from "./config";

mountNetBadge(); mountWallet();
const root = document.getElementById("markets")!;
function card(m: MarketView) {
  const q = metricLabel(m.metric);
  return `<a class="card" href="/market.html?id=${m.id}">
    <div class="meta">${statusPill(m)}<span>#${m.id}</span><span>${m.status === 0 ? timeLeft(m.closeTs) : ""}</span></div>
    <div class="title">${q} ≥&nbsp;<span class="mono">${fmtValue(m.metric, m.threshold)}</span>?</div>
    ${poolsHtml(m)}
    <div class="meta"><span>${m.positions} bettors</span><span>${fmtAmt(m.poolYes + m.poolNo + m.seed, 0)} ${TOKEN_SYMBOL} in pot</span></div>
  </a>`;
}
(async () => {
  try {
    const ms = await fetchMarkets();
    root.innerHTML = ms.length ? ms.map(card).join("") : `<div class="note">No markets yet.</div>`;
  } catch (e: any) { root.innerHTML = `<div class="msg err">Could not load markets: ${e.message ?? e}</div>`; }
})();
