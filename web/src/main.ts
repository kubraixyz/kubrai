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
    // Home shows only live markets (open or awaiting finalization). Personal history lives on /portfolio.html;
    // any past market stays reachable by URL.
    const live = ms.filter((m) => m.status === 0 || m.status === 1);
    root.innerHTML = live.length ? live.map(card).join("") : `<div class="note">No open markets right now.</div>`;
  } catch (e: any) { root.innerHTML = `<div class="msg err">Could not load markets: ${e.message ?? e}</div>`; }
})();

// Android build link (served from /apk/, written by app/scripts/build-apk.sh)
(async () => {
  try {
    const r = await fetch("/apk/latest-" + (import.meta.env.VITE_CLUSTER ?? "devnet") + ".json", { cache: "no-store" }); if (!r.ok) return;
    const j = await r.json();
    const a = document.getElementById("apklink") as HTMLAnchorElement | null, meta = document.getElementById("apkmeta"), p = document.getElementById("apk");
    if (!a || !meta || !p) return;
    a.href = "/apk/" + j.file; a.textContent = `Download Kubrai ${j.version} for Android (${j.cluster})`;
    meta.textContent = `${(j.bytes / 1048576).toFixed(0)} MB · built ${new Date(j.builtAt).toLocaleDateString("en-GB", { dateStyle: "medium" })} · sha256 ${j.sha256.slice(0, 12)}…`;
    p.hidden = false;
  } catch {}
})();
