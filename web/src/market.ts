import { PublicKey } from "@solana/web3.js";
import { bs58 } from "./wallet";
import { NO_OUTCOME, bootMarkets, buildPlaceBetTx, confirmBySig, earlyBirdUntil, fetchConfig, fetchMarket, fetchMarkets, fetchPosition, impliedPayout, totalPool, type MarketView } from "./kubrai";
import { SOURCE_LABEL, bareTitle, fmtExact, fmtValue, metricInfo, question } from "./metrics";
import { balances, bucketColor, bucketLabel, esc, fmtAmt, fmtTs, getSession, mountNetBadge, mountWallet, onSession, openWalletMenu, poolsHtml, refreshBalances, statusPill } from "./ui";
import { API_BASE, CLUSTER, TOKEN_DECIMALS, TOKEN_SYMBOL } from "./config";
import { discountLabel, feeWithDiscounts, holderProof, stakeRuleText, type HolderProof } from "./holder";
import { connection, programId } from "./kubrai";
import { nextStepHead, timelineGrid } from "./timeline";
import { bindReferralAfterBet } from "./referral";
import { explorerTx } from "./explorer";
import { fmtRange, fmtTsShort, fmtWait, inWords, zoneName, zoneShort } from "./time";
import { dayName, daysHtml, placeDays, seriesOf } from "./series";
import { t } from "./i18n";

mountNetBadge(); mountWallet();
document.addEventListener("click", (e) => { if ((e.target as HTMLElement | null)?.id === "goconnect") openWalletMenu(); });
const root = document.getElementById("market")!;
const idParam = new URLSearchParams(location.search).get("id");
const id = idParam != null && /^\d{1,9}$/.test(idParam) ? Number(idParam) : NaN;
let m: MarketView, cfg: any, bucket = 0;
// The amount being typed. The bet box is drawn again whenever the wallet's discounts, the session or the chosen range
// change; drawn from scratch it came back empty, and an amount typed while the wallet was still loading vanished
// (black-box test 2026-10-05). Cleared once a bet lands, so a second click cannot repeat it by accident.
let amtDraft = "";
// Drawn again while someone is typing in the amount field (the page or just the box): the new field gets the keyboard
// back, or the next keys typed go nowhere and a phone closes its keyboard.
let refocusAmt = false;
const noteAmtFocus = () => { if (document.activeElement?.id === "amt") refocusAmt = true; };
// A bet the chain has not answered for after the first minute of waiting. While set, every render of the bet box shows
// this note and draws the bet button disabled — wallet events re-render the box, and a fresh enabled button would invite
// a second real bet. Cleared once the bet confirms or the chain rejects it; a page reload clears it too.
let hold: string | null = null;
function setHold(html: string) {
  hold = html;
  const msg = document.getElementById("msg"); if (msg) msg.innerHTML = html;
  const go = document.getElementById("go") as HTMLButtonElement | null; if (go) go.disabled = true;
}
let proof: HolderProof = { accounts: [], sgt: false, stake: false, sgtDiscountBps: 0, stakeDiscountBps: 0, minFeeBps: 0, stakeLabel: "" };
// The holder-discount lookup goes to the public RPC, which can leave a request hanging for good (2026-09-26: every
// market page with a wallet connected sat on "Loading…"). The page never waits for it: it renders at the full fee
// and re-renders once the lookup answers; after 8 s it gives up (no discount shown, the bet still goes through).
let proofJob: Promise<void> | null = null;
function refreshProof(rerender = true) {
  const owner = getSession()?.publicKey ?? null;
  const job = proofJob = Promise.race([holderProof(connection, programId, owner, cfg?.feeTiers ?? null), new Promise<null>((r) => setTimeout(() => r(null), 8000))])
    .then((p) => { if (!p || proofJob !== job) return; const changed = p.sgt !== proof.sgt || p.stake !== proof.stake; proof = p; if (changed && rerender && m) render(); });
  return job;
}

async function load(fresh = false) { [m, cfg] = await Promise.all([fetchMarket(id, { fresh }), fetchConfig({ fresh })]); render(); void refreshProof(); void loadPosition(); }
onSession(() => { if (!cfg) return; proof = { ...proof, accounts: [], sgt: false, stake: false }; render(); void refreshProof(); });
function render() {
  noteAmtFocus();
  const copy = metricInfo(m.metric, m.closeTs, m.resolveAfterTs);
  const now = Date.now() / 1000, open = m.status === 0 && now >= m.openTs && now < m.closeTs;
  const earlyUntil = earlyBirdUntil(cfg, m), early = now < earlyUntil;
  const fee = feeWithDiscounts(cfg.feeBps, early, cfg.earlyBirdDiscountBps, proof);
  const tiers = cfg.feeTiers;
  document.title = `Kubrai · ${bareTitle(m)} · ${dayName(m)}`;   // with its day: the tabs and history entries of one question were all alike
  root.innerHTML = `
    <div class="mtop">${statusPill(m)}<span>${t("mkt.n", { id: m.id })}</span></div>
    <h1>${question(m, `<span class="mono">${fmtExact(m.metric, m.thresholds[0])}</span>`)}</h1>
    <div class="mnow"><b>${esc(open ? t("mkt.headOpen", { in: inWords(m.closeTs) }) : nextStepHead(m, cfg))}</b><span>${t("card.inPot", { amt: fmtAmt(totalPool(m), 0), tok: TOKEN_SYMBOL })}</span><span>${t("card.bettors", { n: m.positions })}</span><span class="zone" title="${esc(zoneName())}">${t("mkt.zoneShort", { z: esc(zoneShort()) })}</span></div>
    ${timelineGrid(m, cfg)}
    <p class="lead">${copy?.how ?? ""}</p>
    <div class="kv" style="margin-bottom:16px"><b>${t("mkt.source")}</b><span>${copy?.sourceLabel ?? SOURCE_LABEL[copy?.source ?? "thirdparty"]}</span></div>
    ${poolsHtml(m, m.status >= 1 && m.proposedOutcome !== NO_OUTCOME ? m.proposedOutcome : -1)}
    <h2>${t("mkt.bet")}</h2>
    <div id="bet"></div>
    <h2>${t("mkt.rules")}</h2>
    <div class="kv">
      <b>${t("mkt.earlyBird")}</b><span>${t("mkt.earlyBirdV", { a: (cfg.feeBps - cfg.earlyBirdDiscountBps) / 100, ts: fmtTs(earlyUntil), b: cfg.feeBps / 100 })}</span>
      ${tiers ? `<b>${t("mkt.discounts")}</b><span>${[tiers.sgtDiscountBps ? t("mkt.sgtDisc", { pct: tiers.sgtDiscountBps / 100 }) : "", stakeRuleText(tiers)].filter(Boolean).join(" · ")}${tiers.minFeeBps ? ` · ${t("mkt.floor", { pct: tiers.minFeeBps / 100 })}` : ""}. ${t("mkt.proven")}${CLUSTER === "devnet" ? ` <span class="warn">${t("mkt.devnetNote")}</span>` : ""}</span>` : ""}
      <b>${t("mkt.proposed")}</b><span>${m.proposedAt ? t("mkt.proposedV", { ts: fmtTs(m.proposedAt), v: `<span class="mono">${fmtValue(m.metric, m.proposedValue, m.thresholds)}</span>`, b: `<b>${bucketLabel(m, m.proposedOutcome)}</b>` }) : t("mkt.afterClose")}</span>
      ${m.nBuckets > 2 ? `<b>${t("mkt.ranges")}</b><span>${t("mkt.rangesV")}</span>` : ""}
      <b>${t("mkt.dispute")}</b><span>${t("mkt.disputeV", { h: cfg.disputeWindowSecs.toNumber() / 3600 })}</span>
      <b>${t("mkt.snapshots")}</b><span id="evidence" class="note">${t("common.loading")}</span>
      <b>${t("mkt.hash")}</b><span class="hash">${m.proposedAt ? m.snapshotHash + " " + t("mkt.hashOn") : t("mkt.hashLater")}</span>
      ${m.status === 1 ? `<b>${t("mkt.disagree")}</b><span><div id="dispute"><button id="dbtn">${t("mkt.disputeBtn")}</button> <span class="note">${t("mkt.disputeNote", { ts: fmtTs(m.proposedAt + cfg.disputeWindowSecs.toNumber()) })}</span></div><div id="dlist" class="note"></div></span>` : ""}
      <b>${t("mkt.account")}</b><span class="hash">${m.pubkey.toBase58()}</span>
    </div>`;
  renderBet(open, fee);
  mountDispute();
  loadEvidence();
}
async function mountDispute() {
  const box = document.getElementById("dispute"); if (!box) return;
  try { const r = await fetch(`${API_BASE}/disputes?market=${m.pubkey.toBase58()}`); const j = await r.json(); const open = (j.disputes ?? []).filter((d: any) => d.status === "open"); if (open.length) document.getElementById("dlist")!.textContent = t("mkt.disputesFiled", { n: open.length }); } catch {}
  const btn = document.getElementById("dbtn") as HTMLButtonElement;
  btn.onclick = async () => {
    const s = getSession(); if (!s) { alert(t("mkt.connectFirst")); return; }
    const reason = prompt(t("mkt.disputeWhy")); if (!reason || reason.trim().length < 5) return;
    const claimed = prompt(t("mkt.disputeValue")) ?? "";
    btn.disabled = true;
    try {
      const msg = `kubrai-dispute v1\nmarket=${m.pubkey.toBase58()}\nwallet=${s.publicKey.toBase58()}\nclaimed=${claimed.trim()}\nreason=${reason.trim().slice(0, 2000)}`;
      const sig = await s.signMessage(new TextEncoder().encode(msg));
      const r = await fetch(`${API_BASE}/dispute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ market: m.pubkey.toBase58(), wallet: s.publicKey.toBase58(), reason: reason.trim().slice(0, 2000), claimedValue: claimed.trim() || null, signature: bs58(sig) }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "failed");
      document.getElementById("dlist")!.textContent = t("mkt.disputeDone");
    } catch (e: any) { alert(e?.message ?? e); btn.disabled = false; }
  };
}
function renderBet(open: boolean, fee: number) {
  const box = document.getElementById("bet")!;
  const s = getSession();
  noteAmtFocus();
  if (!open) { refocusAmt = false; box.innerHTML = `<div class="note">${m.status === 0 && Date.now() / 1000 < m.openTs ? t("bet.notOpen") : t("bet.closed")}</div>`; drawPosition(); return; }
  box.innerHTML = `<div class="betbox">
    <div class="sides">${m.pools.map((_, i) => `<button class="${bucket === i ? "on" : ""}" style="--c:${bucketColor(m, i)}" data-b="${i}">${bucketLabel(m, i)}</button>`).join("")}</div>
    <div class="amtrow"><input id="amt" type="number" min="${cfg.minBet.toNumber() / 10 ** TOKEN_DECIMALS}" step="1" value="${esc(amtDraft)}" placeholder="${esc(t("bet.amountPh", { tok: TOKEN_SYMBOL }))}">${s ? `<button id="max" type="button" title="${esc(t("bet.maxTitle", { tok: TOKEN_SYMBOL }))}">${t("bet.max")}</button>` : ""}</div>
    ${s && balances.loaded ? `<div class="note">${t("bet.available")} <span class="mono">${fmtAmt(balances.token)} ${TOKEN_SYMBOL}</span>${balances.sol < 0.002 ? ` · <span class="warn">${t("bet.needSol")}</span>` : ""}</div>` : ""}
    <div class="quote" id="quote"></div>
    ${s ? `<button class="primary" id="go"${hold ? " disabled" : ""} style="background:${bucketColor(m, bucket)};border-color:${bucketColor(m, bucket)}">${t("bet.place", { b: bucketLabel(m, bucket) })}</button>` : `<button class="primary" id="goconnect">${t("wallet.connect")}</button>`}
    <div id="msg">${hold ?? ""}</div>
    <div class="note">${t("bet.parimutuel")} <b>${t("bet.yourFee", { pct: fee / 100 })}</b>${discountLabel(Date.now() / 1000 < earlyBirdUntil(cfg, m), proof) ? ` (${discountLabel(Date.now() / 1000 < earlyBirdUntil(cfg, m), proof)})` : ""} ${t("bet.feeNote")}</div>
  </div>`;
  const amtEl = box.querySelector<HTMLInputElement>("#amt")!, quote = box.querySelector("#quote")!;
  const upd = () => {
    const a = Math.round((Number(amtEl.value) || 0) * 10 ** TOKEN_DECIMALS);
    if (!(a > 0)) { quote.innerHTML = `<span class="note">${t("bet.enterAmount", { b: bucketLabel(m, bucket) })}</span>`; return; }   // a typed "-1" used to be quoted: "you receive -1"
    if (a < cfg.minBet.toNumber()) { quote.innerHTML = `<span class="note">${t("bet.min", { amt: fmtAmt(cfg.minBet.toNumber()), tok: TOKEN_SYMBOL })}</span>`; return; }
    if (balances.loaded && a > balances.token) { quote.innerHTML = `<span class="note">${t("bet.overBalance", { amt: fmtAmt(balances.token), tok: TOKEN_SYMBOL })}</span>`; return; }
    const q = impliedPayout(m, bucket, a, fee);
    quote.innerHTML = `<span>${t("bet.ifWins", { b: `<b>${bucketLabel(m, bucket)}</b>` })}</span><span class="big">${fmtAmt(q.total)} ${TOKEN_SYMBOL}</span><span class="note">${t("bet.breakdown", { stake: fmtAmt(a), losers: fmtAmt(q.fromLosers), fee: fmtAmt(q.fee) })}${q.fromSeed ? ` ${t("bet.plusSeed", { seed: fmtAmt(q.fromSeed) })}` : ""}. ${t("bet.otherLoses", { stake: fmtAmt(a) })}</span>`;
  };
  amtEl.oninput = () => { amtDraft = amtEl.value; upd(); }; upd(); drawPosition();
  // with the caret at the end: focus alone leaves it at the start of a number field (1, then 2-3-4-5-6, came out as
  // 234561), and a number field takes no setSelectionRange; setting its value again moves the caret after it
  if (refocusAmt) { refocusAmt = false; amtEl.focus({ preventScroll: true }); const v = amtEl.value; amtEl.value = ""; amtEl.value = v; }
  const mx = box.querySelector<HTMLButtonElement>("#max"); if (mx) mx.onclick = () => { amtEl.value = String(Math.floor(balances.token / 10 ** TOKEN_DECIMALS)); amtDraft = amtEl.value; upd(); };
  box.querySelectorAll<HTMLButtonElement>(".sides button").forEach((b) => (b.onclick = () => { bucket = Number(b.dataset.b); renderBet(open, fee); }));
  const go = box.querySelector<HTMLButtonElement>("#go"), msg = box.querySelector("#msg")!;
  if (go) go.onclick = async () => {
    const sess = getSession()!; const a = Math.round((Number(amtEl.value) || 0) * 10 ** TOKEN_DECIMALS), side = bucket;
    if (a < cfg.minBet.toNumber()) { msg.innerHTML = `<div class="msg err">${t("bet.min", { amt: fmtAmt(cfg.minBet.toNumber()), tok: TOKEN_SYMBOL })}</div>`; return; }
    // More than the wallet holds stops here, before the wallet asks for a signature; it used to fail after it, with the
    // program's raw error. The balance is read again first, so tokens that arrived a moment ago are not refused.
    if (balances.loaded && a > balances.token) { await refreshBalances(); if (balances.loaded && a > balances.token) { (document.getElementById("msg") ?? msg).innerHTML = `<div class="msg err">${t("bet.overBalance", { amt: fmtAmt(balances.token), tok: TOKEN_SYMBOL })}</div>`; return; } }
    go.disabled = true; msg.innerHTML = `<div class="msg">${t("bet.confirm")}</div>`;
    // While the bet is on its way the row of days does not respond: a day switched and switched back is a fresh page, with the button unlocked.
    const days = document.getElementById("days"); days?.toggleAttribute("inert", true);
    // The box may have been re-rendered while we waited (wallet events do that): always write to the elements on the page.
    const msgNow = () => document.getElementById("msg") ?? msg, goNow = () => (document.getElementById("go") as HTMLButtonElement | null) ?? go;
    const sigLink = (sig: string) => `<a class="mono" style="word-break:break-all" href="${explorerTx(sig)}" target="_blank" rel="noopener">${esc(sig)}</a>`;
    // Everything that follows a confirmed bet, whether it confirmed in seconds or minutes later.
    const landed = async () => {
      hold = null; amtDraft = "";
      const okHtml = `<div class="msg ok">${t("bet.placed", { amt: fmtAmt(a), tok: TOKEN_SYMBOL, b: bucketLabel(m, side) })}</div>`;
      const cur = msgNow(); cur.innerHTML = okHtml;
      try {
        const refNote = await bindReferralAfterBet(sess, cur);
        await refreshBalances(); await load(true); await loadPosition();
        // load() re-rendered the page: keep the confirmation visible in the fresh bet box
        const fresh = document.getElementById("msg"); if (fresh) fresh.innerHTML = okHtml;
        if (refNote) { const b = document.getElementById("bet"); if (b) b.insertAdjacentHTML("beforeend", `<div class="msg ok" style="margin-top:8px">${esc(refNote)}</div>`); }
      } catch (e) { console.warn("refresh after bet failed", e); goNow().disabled = false; }   // the bet is on-chain: a failed refresh must not read as a failed bet
    };
    try {
      await refreshProof(false);
      // A wallet funded seconds ago can hit an RPC node that has not seen the credit yet; one retry covers it.
      const send = async () => sess.signAndSend(await buildPlaceBetTx(sess.publicKey, m, side, a, new PublicKey(cfg.mint), proof.accounts));
      const sig = await send().catch(async (e) => { if (!/prior credit|Blockhash not found/i.test(String(e?.message ?? e))) throw e; msg.innerHTML = `<div class="msg">${t("bet.retry")}</div>`; await new Promise((r) => setTimeout(r, 4000)); return send(); });
      msg.innerHTML = `<div class="msg">${t("bet.sent")} <span class="hash">${esc(sig)}</span></div>`;
      let st = await confirmBySig(sig, 60_000);
      if (st === "pending") {
        // Slow is not failed: a transaction the chain has not answered for usually lands a little later, and a red
        // "failed" here has made people bet twice. Say so, keep the button locked, and keep looking for five more minutes.
        setHold(`<div class="msg">${t("bet.slow", { sig: sigLink(sig) })}</div>`);
        st = await confirmBySig(sig, 5 * 60_000, { everyMs: 3000, history: true });
      }
      if (st === "confirmed") { await landed(); return; }
      setHold(`<div class="msg">${t("bet.unconfirmed", { min: 6, sig: sigLink(sig) })}</div>`);   // stays locked until the page is reloaded
    } catch (e: any) { hold = null; msgNow().innerHTML = `<div class="msg err">${esc(e?.message ?? e)}</div>`; goNow().disabled = false; }
    finally { days?.toggleAttribute("inert", false); }
  };
}
// The connected wallet's own stake on this market, one number per range (null: no wallet, or nothing staked here).
// It is held apart from the bet box because the box is redrawn many times over (a wallet event, the discount lookup
// answering, another range picked) and each redraw puts the line back. It used to be added once, right after a bet:
// whoever came back to a market they had already bet on saw no sign of it, and a redraw wiped it even then.
let myPos: number[] | null = null, posOwner = "";
function drawPosition() {
  const box = document.getElementById("bet"); if (!box) return;
  box.querySelector("#mypos")?.remove();
  if (!myPos) return;
  const parts = myPos.slice(0, m.nBuckets).map((x, i) => [x, i]).filter(([x]) => x > 0).map(([x, i]) => `${bucketLabel(m, i)}: ${fmtAmt(x)}`);
  const el = document.createElement("div"); el.id = "mypos"; el.className = "kv"; el.style.marginTop = "12px";
  el.innerHTML = `<b>${t("bet.position")}</b><span>${parts.length ? parts.join(" · ") + " " + TOKEN_SYMBOL : t("bet.none")}</span>`;
  box.appendChild(el);
}
async function loadPosition() {
  const s = getSession(), owner = s ? s.publicKey.toBase58() : "";
  if (owner !== posOwner) { myPos = null; posOwner = owner; drawPosition(); }   // one wallet's stake never stays up while another's is fetched
  if (!s || !m) return;
  const p = await fetchPosition(m.pubkey, s.publicKey);
  if ((getSession()?.publicKey.toBase58() ?? "") !== owner) return;             // the wallet changed while we waited
  if (p) { myPos = (p.amounts as any[]).map((x) => x.toNumber()); drawPosition(); }   // no answer (an RPC hiccup reads the same as no position) leaves what is shown alone
}
onSession(() => { if (m) { render(); void loadPosition(); } });
// The other days of this question, in a row above the market (series.ts). It is drawn from the market list the page
// arrived with, so it is there before the market itself and never holds the page up; a question asked only once, or no
// list at all, leaves the row out.
async function showDays() {
  const box = document.getElementById("days"); if (!box) return;
  let all = bootMarkets(); if (!all) { try { all = await fetchMarkets(); } catch { return; } }
  const cur = all.find((x) => x.id === id), days = cur ? seriesOf(all, cur) : [];
  if (!cur || days.length < 2) return;
  box.innerHTML = daysHtml(days, cur); placeDays(box.firstElementChild as HTMLElement);
}
void showDays();
// A link with no market number in it, or with one that no market has (mistyped, or cut short when it was shared), says
// so in plain words and offers the way back. It used to show whatever the decoder threw: "Could not load market #NaN:
// Trying to access beyond buffer length".
const missingHtml = (key: string) => `<div class="msg">${t(key, { id: esc(idParam ?? "") })}</div><p><a href="/">${t("nav.all")}</a></p>`;
if (Number.isNaN(id)) root.innerHTML = missingHtml(idParam ? "err.marketMissing" : "err.marketNoId");
else load().catch((e) => {
  const known = bootMarkets();   // the list the page arrived with: a number that is not in it is not a market
  const gone = (known ? !known.some((x) => x.id === id) : false) || /does not exist|has no data|beyond buffer/i.test(String(e?.message ?? e));
  root.innerHTML = gone ? missingHtml("err.marketMissing") : `<div class="msg err">${t("err.market", { id: esc(id), err: esc(e.message ?? e) })}</div>`;
});

/** The hourly snapshots behind this market, with their values, so nobody has to dig through the API.
 *  One format everywhere: "<label>  <value>  <snapshot hour, local time>  sha256 <prefix>  memo tx". */
async function loadEvidence() {
  const el = document.getElementById("evidence"); if (!el) return;
  try {
    const r = await fetch(`${API_BASE}/evidence?metric=${encodeURIComponent(m.metric)}&open=${m.openTs}&close=${m.closeTs}&baseline=${m.baseline}&id=${m.id}&resolveAfter=${m.resolveAfterTs}`);
    if (!r.ok) { el.textContent = t("ev.none"); return; }
    const e = await r.json(); const fv = (v: number | null | undefined) => (v == null ? "—" : fmtValue(m.metric, v, m.thresholds));
    const when = (slot?: string | null) => !slot ? "" : slot === "on-chain" ? t("ev.onchainBaseline") : `<a href="${API_BASE}/snapshots/${slot}" target="_blank" rel="noopener" title="${esc(t("ev.rawSnapshot"))}">${esc(fmtTsShort(Date.parse(slot + ":00:00Z") / 1000))}</a>`;
    const proof = (x: any) => x?.sha256 ? ` · sha256 <span class="hash">${esc(x.sha256.slice(0, 12))}…</span>${x.memo ? ` · <a href="${explorerTx(x.memo)}" target="_blank" rel="noopener">${t("ev.memo")}</a>` : ""}` : "";
    const row = (label: string, value: string, x: any) => `<div><b>${label}</b> <span class="mono">${value}</span>${x?.slot ? ` · ${when(x.slot)}` : ""}${proof(x)}</div>`;
    const rows: string[] = [];
    if (e.kind === "daily") {
      const dayWin = (d: string) => { const s = Date.parse(d + "T00:00:00Z") / 1000; return esc(fmtRange(s, s + 86400)); };
      rows.push(row(t("ev.dailyDay"), dayWin(e.day), null));
      if (e.resolution) rows.push(row(t("ev.result"), fv(e.resolution.observed), e.resolution.slot ? { slot: e.resolution.slot } : null));
      else {
        // Not read yet. The source usually shows the day's number long before the market reads it, and a page that
        // prints that number without saying when it is read looks like a market that forgot to settle (2026-10-02).
        const dayEnd = Date.parse(e.day + "T00:00:00Z") / 1000 + 86400, readAt: number = e.readAt ?? m.resolveAfterTs, wait = fmtWait(readAt - dayEnd);
        rows.push(row(t("ev.dailyReported"), e.reported != null ? fv(e.reported) : t("ev.dailyNotYet", { wait }), null));
        rows.push(row(t("ev.dailyReadAt"), esc(fmtTs(readAt)), null));
        rows.push(`<div class="note">${esc(t("ev.dailyReadNote", { wait }))}</div>`);
      }
      if (e.recent?.length) rows.push(`<details><summary>${t("ev.dailyRecent")}</summary>${e.recent.map(([d, v]: [string, number]) => row(dayWin(d), fv(v), null)).join("")}</details>`);
      if (e.source) rows.push(`<div class="note">${esc(e.source)}</div>`);
      el.innerHTML = rows.join(""); return;
    }
    if (e.kind === "cum") {
      rows.push(e.opening ? row(t("ev.opening"), fv(e.opening.value), e.opening) : row(t("ev.opening"), t("ev.notYet"), null));
      if (e.resolution) { rows.push(row(t("ev.closing"), fv(e.closing?.value), e.closing)); rows.push(row(t("ev.result"), fv(e.resolution.observed), null)); }
      else if (e.latest) { rows.push(row(t("ev.latest"), fv(e.latest.value), e.latest)); rows.push(row(t("ev.soFar"), fv(e.soFar), null)); }
    } else {
      rows.push(row(t("ev.samples"), t("ev.samplesV", { n: e.samples, of: e.expected }), null));
      if (e.soFar != null) rows.push(row(e.resolution ? t("ev.resultMedian") : t("ev.medianSoFar"), fv(e.resolution ? e.resolution.observed : e.soFar), null));
      if (e.series?.length) rows.push(`<details><summary>${t("ev.every")}</summary>${e.series.map((x: any) => row("", fv(x.value), x)).join("")}</details>`);
    }
    el.innerHTML = rows.join("");
  } catch { el.textContent = t("ev.none"); }
}
