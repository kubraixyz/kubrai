import { fetchMarkets, totalPool, type MarketView } from "./kubrai";
import { CATEGORY_ORDER, catalogEntry, fmtExact, metricCategory, metricInfo, metricLabel, question } from "./metrics";
import { bucketColor, bucketLabel, esc, fmtAmt, mountNetBadge, mountWallet, timeLeft } from "./ui";
import { TOKEN_SYMBOL } from "./config";
import { fmtTsShort, localizeUtc } from "./time";
import { t } from "./i18n";

mountNetBadge(); mountWallet();
const root = document.getElementById("markets")!;
// Home cards stay minimal: what the question is, how the pool leans, when it closes. Everything else is on the market page.
function card(m: MarketView) {
  const tot = totalPool(m);
  const hi = m.status === 2 || m.status === 4 ? m.outcome : m.status === 1 ? m.proposedOutcome : -1;
  const when = m.status === 0 && Date.now() / 1000 < m.closeTs ? timeLeft(m.closeTs) : m.status === 0 ? t("card.closedSoon", { ts: fmtTsShort(m.closeTs) }) : m.status === 1 ? t("card.proposed", { ts: fmtTsShort(m.proposedAt) }) : t("card.closed", { ts: fmtTsShort(m.closeTs) });
  const rows = m.pools.map((p, i) => { const pct = tot ? Math.round((p / tot) * 100) : 0; return `<div class="orow${hi === i ? " win" : ""}" style="--c:${bucketColor(m, i)}"><i style="width:${tot ? pct : 0}%"></i><span>${bucketLabel(m, i)}</span><b>${tot ? pct + "%" : "–"}</b></div>`; }).join("");
  return `<a class="card mini" href="/market.html?id=${m.id}">
    <div class="meta"><span>${when}</span></div>
    <div class="title">${question(m, `<span class="mono">${fmtExact(m.metric, m.thresholds[0])}</span>`)}</div>
    <div class="orows">${rows}</div>
    <div class="meta"><span>${t("card.inPot", { amt: fmtAmt(tot, 0), tok: TOKEN_SYMBOL })}</span><span>${t("card.bettors", { n: m.positions })}</span></div>
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
function setStage(k: Stage) { stage = k; const u = new URL(location.href); if (stage === "open") u.searchParams.delete("status"); else u.searchParams.set("status", stage); history.replaceState(null, "", u); renderStages(); renderList(); }
function renderStages() {
  const now = Date.now() / 1000, hits = found(all); const count = (k: Stage) => hits.filter((m) => stageOf(m, now) === k).length;   // with a search running the tabs count its matches
  segEl.innerHTML = `<div class="seg" role="tablist">${STAGES.map(([k, label]) => `<button role="tab" data-s="${k}" class="${k === stage ? "on" : ""}">${label}<small>${count(k)}</small></button>`).join("")}</div>`;
  segEl.querySelectorAll<HTMLButtonElement>("button[data-s]").forEach((b) => (b.onclick = () => setStage(b.dataset.s as Stage)));
}
// Search (the box beside the stage tabs). A query is matched against what a card says — its question in the viewer's
// language and clock, the app, the category — plus the market's number ("#139") and its metric id, case, accents and
// full-width forms aside. Every word typed has to begin a word there ("ore" finds ORE, not "Store"); a word in a script
// written without spaces (Chinese, Japanese) is found anywhere. It looks across all categories of the selected stage
// (the chips make way for a result line), the tab counts become match counts, and it rides in the URL (?q=) like the tab.
const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").normalize("NFKC").toLowerCase();
const hays = new Map<number, string>();
function hay(m: MarketView) {
  let h = hays.get(m.id);
  if (h === undefined) {
    const base = m.metric.replace(/_(next|today|day|week|dmed|wmed|med7)$/, ""), c = metricCategory(m.metric);
    const asked = question(m, fmtExact(m.metric, m.thresholds[0])).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
    hays.set(m.id, (h = fold([`#${m.id}`, asked, metricLabel(m.metric), catalogEntry(base)?.app ?? "", c, catLabel(c), base].join(" "))));
  }
  return h;
}
const qEl = document.getElementById("q") as HTMLInputElement | null;
let q = (new URLSearchParams(location.search).get("q") ?? "").trim().slice(0, 60);
const terms = () => fold(q).split(/\s+/).filter(Boolean);
const finder = (w: string) => { if (!/^[a-z0-9]/.test(w)) return (h: string) => h.includes(w); const re = new RegExp("(?:^|[^a-z0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); return (h: string) => re.test(h); };
const found = (list: MarketView[]) => { const fs = terms().map(finder); return fs.length ? list.filter((m) => { const h = hay(m); return fs.every((f) => f(h)); }) : list; };
let loaded = false;
function setQuery(v: string) { q = v.trim(); const u = new URL(location.href); if (q) u.searchParams.set("q", q); else u.searchParams.delete("q"); history.replaceState(null, "", u); if (loaded) { renderStages(); renderList(); } }
if (qEl) {
  qEl.value = q; qEl.oninput = () => setQuery(qEl.value);
  // on a phone the keyboard takes half the screen: the box goes to the top so the matches show under it while typing
  qEl.onfocus = () => { if (matchMedia("(max-width:720px)").matches) setTimeout(() => qEl.closest(".search")?.scrollIntoView({ block: "start", behavior: "smooth" }), 250); };
}
// Category chips under the stage tabs: one category at a time (the dApp Store's own grouping), chosen in the URL (?cat=)
const catLabel = (c: string) => (t("cat." + c) === "cat." + c ? c : t("cat." + c));
let cat = new URLSearchParams(location.search).get("cat") ?? "";
const catEl = document.getElementById("cats")!;
function renderList() {
  const now = Date.now() / 1000;
  // open/awaiting/proposed: soonest close first; settled: most recent first
  const inStage = all.filter((m) => stageOf(m, now) === stage).sort((a, b) => (stage === "settled" ? b.closeTs - a.closeTs || b.id - a.id : a.closeTs - b.closeTs || a.id - b.id));
  if (terms().length) {
    // A search with nothing to show says where the matches are (or that all N markets were checked), never a bare "0".
    const hits = found(inStage), qq = `<b>${esc(q)}</b>`, clear = `<button id="qclear">${t("search.clear")}</button>`;
    const other = hits.length ? [] : STAGES.map(([k, label]) => [k, label, found(all).filter((m) => stageOf(m, now) === k).length] as const).filter(([k, , n]) => k !== stage && n > 0);
    catEl.innerHTML = `<div class="found" role="status">${hits.length ? `<span>${t("search.count", { n: hits.length, total: inStage.length, q: qq })}</span>`
      : other.length ? `<span>${t("search.noneHere", { stage: STAGES.find(([k]) => k === stage)![1], q: qq })} ${t("search.elsewhere")}</span>${other.map(([k, label, n]) => `<button data-s="${k}">${label}<small>${n}</small></button>`).join("")}`
      : `<span>${t("search.none", { q: qq, total: all.length })}</span>`}${clear}</div>`;
    catEl.querySelectorAll<HTMLButtonElement>("button[data-s]").forEach((b) => (b.onclick = () => setStage(b.dataset.s as Stage)));
    catEl.querySelector<HTMLButtonElement>("#qclear")!.onclick = () => { if (qEl) { qEl.value = ""; qEl.focus(); } setQuery(""); };
    root.innerHTML = hits.length ? `<div class="grid">${hits.map(card).join("")}</div>` : ""; localizeUtc(root);
    return;
  }
  const cats = CATEGORY_ORDER.filter((c) => inStage.some((m) => metricCategory(m.metric) === c)).concat([...new Set(inStage.map((m) => metricCategory(m.metric)))].filter((c) => !CATEGORY_ORDER.includes(c)));
  if (!cats.includes(cat)) cat = cats[0] ?? "";
  catEl.innerHTML = cats.length ? `<div class="chips" role="tablist">${cats.map((c) => `<button role="tab" data-c="${esc(c)}" class="chip${c === cat ? " on" : ""}">${esc(catLabel(c))}<small>${inStage.filter((m) => metricCategory(m.metric) === c).length}</small></button>`).join("")}</div>` : "";
  catEl.querySelectorAll<HTMLButtonElement>("button[data-c]").forEach((b) => (b.onclick = () => { cat = b.dataset.c!; const u = new URL(location.href); u.searchParams.set("cat", cat); history.replaceState(null, "", u); renderList(); }));
  const items = inStage.filter((m) => metricCategory(m.metric) === cat);
  const html = (stage === "open" && items.length ? `<p class="note">${t("group.dayBlurb")}</p>` : "") + (items.length ? `<div class="grid">${items.map(card).join("")}</div>` : "");
  root.innerHTML = html || `<div class="note">${EMPTY[stage]}</div>`; localizeUtc(root);
}
(async () => {
  try { all = await fetchMarkets(); loaded = true; renderStages(); renderList(); }
  catch (e: any) { root.innerHTML = `<div class="msg err">${t("err.markets", { err: esc(e.message ?? e) })}</div>`; }
})();

