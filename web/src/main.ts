import { fetchMarkets, totalPool, type MarketView } from "./kubrai";
import { CATEGORY_ORDER, fmtValue, metricCategory, metricInfo, metricLabel } from "./metrics";
import { esc, fmtAmt, mountNetBadge, mountWallet, poolsHtml, statusPill, timeLeft } from "./ui";
import { TOKEN_SYMBOL } from "./config";
import { fmtTsShort, localizeUtc } from "./time";
import { t } from "./i18n";

mountNetBadge(); mountWallet();
const root = document.getElementById("markets")!;
const metricCadence2 = (id: string) => (/_next$/.test(id) ? "cad.next" : /_(week|wmed)$/.test(id) ? "cad.week" : "cad.day");
function card(m: MarketView) {
  const q = metricLabel(m.metric);
  return `<a class="card" href="/market.html?id=${m.id}">
    <div class="meta">${statusPill(m)}<span>#${m.id}</span><span class="pill">${esc(t(metricCadence2(m.metric)))}</span><span>${m.status === 0 && Date.now() / 1000 < m.closeTs ? `${timeLeft(m.closeTs)} · ${t("card.closes", { ts: fmtTsShort(m.closeTs) })}` : m.status === 0 ? t("card.closedSoon", { ts: fmtTsShort(m.closeTs) }) : m.status === 1 ? t("card.proposed", { ts: fmtTsShort(m.proposedAt) }) : t("card.closed", { ts: fmtTsShort(m.closeTs) })}</span></div>
    <div class="title">${m.nBuckets === 2 ? t("q.yesno", { q, v: `<span class="mono">${fmtValue(m.metric, m.thresholds[0])}</span>` }) : t("q.range", { q })}</div>
    <div class="meta"><span class="pill">${t("src." + (metricInfo(m.metric)?.source ?? "thirdparty"))}</span>${metricInfo(m.metric)?.cumulative && m.baseline ? `<span>${t("card.fromAtOpen", { v: fmtValue(m.metric, m.baseline) })}</span>` : ""}</div>
    ${poolsHtml(m, m.status === 2 || m.status === 4 ? m.outcome : m.status === 1 ? m.proposedOutcome : -1)}
    <div class="meta"><span>${t("card.bettors", { n: m.positions })}</span><span>${t("card.inPot", { amt: fmtAmt(totalPool(m) + m.seed, 0), tok: TOKEN_SYMBOL })}</span></div>
  </a>`;
}
// Markets are split by where they are in their life: open for bets, closed and waiting for the result, result
// proposed (dispute window running), settled. The tab lives in the URL (?status=) so a link lands on the same view.
type Stage = "open" | "awaiting" | "proposed" | "settled";
const STAGES: [Stage, string][] = [["open", t("stage.open")], ["awaiting", t("stage.awaiting")], ["proposed", t("stage.proposed")], ["settled", t("stage.settled")]];
const stageOf = (m: MarketView, now: number): Stage => (m.status === 0 ? (now < m.closeTs ? "open" : "awaiting") : m.status === 1 ? "proposed" : "settled");
const EMPTY: Record<Stage, string> = { open: t("empty.open"), awaiting: t("empty.awaiting"), proposed: t("empty.proposed"), settled: t("empty.settled") };
let stage: Stage = (STAGES.some(([k]) => k === new URLSearchParams(location.search).get("status")) ? new URLSearchParams(location.search).get("status") : "open") as Stage;
const segEl = document.getElementById("stages")!;
let all: MarketView[] = [];
function renderStages() {
  const now = Date.now() / 1000; const count = (k: Stage) => all.filter((m) => stageOf(m, now) === k).length;
  segEl.innerHTML = `<div class="seg" role="tablist">${STAGES.map(([k, label]) => `<button role="tab" data-s="${k}" class="${k === stage ? "on" : ""}">${label}<small>${count(k)}</small></button>`).join("")}</div>`;
  segEl.querySelectorAll<HTMLButtonElement>("button[data-s]").forEach((b) => (b.onclick = () => { stage = b.dataset.s as Stage; const u = new URL(location.href); if (stage === "open") u.searchParams.delete("status"); else u.searchParams.set("status", stage); history.replaceState(null, "", u); renderStages(); renderList(); }));
}
// Category chips under the stage tabs: one category at a time (the dApp Store's own grouping), chosen in the URL (?cat=)
const catLabel = (c: string) => (t("cat." + c) === "cat." + c ? c : t("cat." + c));
let cat = new URLSearchParams(location.search).get("cat") ?? "";
const catEl = document.getElementById("cats")!;
function renderList() {
  const now = Date.now() / 1000;
  // open/awaiting/proposed: soonest close first; settled: most recent first
  const inStage = all.filter((m) => stageOf(m, now) === stage).sort((a, b) => (stage === "settled" ? b.closeTs - a.closeTs || b.id - a.id : a.closeTs - b.closeTs || a.id - b.id));
  const cats = CATEGORY_ORDER.filter((c) => inStage.some((m) => metricCategory(m.metric) === c)).concat([...new Set(inStage.map((m) => metricCategory(m.metric)))].filter((c) => !CATEGORY_ORDER.includes(c)));
  if (!cats.includes(cat)) cat = cats[0] ?? "";
  catEl.innerHTML = cats.length ? `<div class="chips" role="tablist">${cats.map((c) => `<button role="tab" data-c="${esc(c)}" class="chip${c === cat ? " on" : ""}">${esc(catLabel(c))}<small>${inStage.filter((m) => metricCategory(m.metric) === c).length}</small></button>`).join("")}</div>` : "";
  catEl.querySelectorAll<HTMLButtonElement>("button[data-c]").forEach((b) => (b.onclick = () => { cat = b.dataset.c!; const u = new URL(location.href); u.searchParams.set("cat", cat); history.replaceState(null, "", u); renderList(); }));
  const items = inStage.filter((m) => metricCategory(m.metric) === cat);
  const html = (stage === "open" && items.length ? `<p class="note">${t("group.dayBlurb")}</p>` : "") + (items.length ? `<div class="grid">${items.map(card).join("")}</div>` : "");
  root.innerHTML = html || `<div class="note">${EMPTY[stage]}</div>`; localizeUtc(root);
}
(async () => {
  try { all = await fetchMarkets(); renderStages(); renderList(); }
  catch (e: any) { root.innerHTML = `<div class="msg err">${t("err.markets", { err: esc(e.message ?? e) })}</div>`; }
})();

// Android build link (served from /apk/, written by app/scripts/build-apk.sh)
(async () => {
  try {
    const r = await fetch("/apk/latest-" + (import.meta.env.VITE_CLUSTER ?? "devnet") + ".json", { cache: "no-store" }); if (!r.ok) return;
    const j = await r.json();
    const a = document.getElementById("apklink") as HTMLAnchorElement | null, meta = document.getElementById("apkmeta"), p = document.getElementById("apk");
    if (!a || !meta || !p) return;
    a.href = "/apk/" + j.file; a.textContent = t("apk.download", { v: j.version, net: j.cluster });
    meta.textContent = t("apk.meta", { mb: (j.bytes / 1048576).toFixed(0), date: new Date(j.builtAt).toLocaleDateString("en-GB", { dateStyle: "medium" }), sha: j.sha256.slice(0, 12) });
    p.hidden = false;
  } catch {}
})();
