import { fetchMarkets, totalPool, type MarketView } from "./kubrai";
import { fmtValue, metricInfo, metricLabel } from "./metrics";
import { fmtAmt, mountNetBadge, mountWallet, poolsHtml, statusPill, timeLeft } from "./ui";
import { TOKEN_SYMBOL } from "./config";

mountNetBadge(); mountWallet();
const root = document.getElementById("markets")!;
function card(m: MarketView) {
  const q = metricLabel(m.metric);
  return `<a class="card" href="/market.html?id=${m.id}">
    <div class="meta">${statusPill(m)}<span>#${m.id}</span><span>${m.status === 0 ? timeLeft(m.closeTs) : ""}</span></div>
    <div class="title">${m.nBuckets === 2 ? `${q} ≥&nbsp;<span class="mono">${fmtValue(m.metric, m.thresholds[0])}</span>?` : `${q}: which range?`}</div>
    <div class="meta"><span class="pill">${{ onchain: "on-chain", store: "store data", thirdparty: "3rd-party data" }[metricInfo(m.metric)?.source ?? "thirdparty"]}</span>${metricInfo(m.metric)?.cumulative ? `<span>from ${fmtValue(m.metric, m.baseline)} at open</span>` : ""}</div>
    ${poolsHtml(m)}
    <div class="meta"><span>${m.positions} bettors</span><span>${fmtAmt(totalPool(m) + m.seed, 0)} ${TOKEN_SYMBOL} in pot</span></div>
  </a>`;
}
(async () => {
  try {
    const ms = await fetchMarkets();
    const live = ms.filter((m) => m.status === 0 || m.status === 1);                 // open or awaiting finalization
    const past = ms.filter((m) => m.status === 2 || ((m.status === 3 || m.status === 4) && m.positions > 0)); // resolved, or voided with bettors
    // voided/swept markets nobody bet on are noise: hidden
    root.innerHTML = (live.length ? live.map(card).join("") : `<div class="note">No open markets right now.</div>`);
    if (past.length) {
      const sec = document.createElement("section");
      sec.innerHTML = `<h2>Past markets</h2><div class="grid">${past.map(card).join("")}</div>`;
      root.insertAdjacentElement("afterend", sec);
    }
  } catch (e: any) { root.innerHTML = `<div class="msg err">Could not load markets: ${e.message ?? e}</div>`; }
})();
