import { PublicKey } from "@solana/web3.js";
import { bs58 } from "./wallet";
import { NO_OUTCOME, buildPlaceBetTx, confirmBySig, earlyBirdUntil, fetchConfig, fetchMarket, fetchPosition, impliedPayout, type MarketView } from "./kubrai";
import { SOURCE_LABEL, fmtValue, metricInfo, metricLabel } from "./metrics";
import { balances, bucketColor, bucketLabel, esc, fmtAmt, fmtTs, getSession, mountNetBadge, mountWallet, onSession, poolsHtml, refreshBalances, statusPill, timeLeft } from "./ui";
import { API_BASE, CLUSTER, TOKEN_DECIMALS, TOKEN_SYMBOL } from "./config";
import { discountLabel, feeWithDiscounts, holderProof, stakeRuleText, type HolderProof } from "./holder";
import { connection, programId } from "./kubrai";
import { timelineHtml } from "./timeline";
import { bindReferralAfterBet } from "./referral";
import { fmtTsShort, zoneName } from "./time";
import { t } from "./i18n";

mountNetBadge(); mountWallet();
const root = document.getElementById("market")!;
const id = Number(new URLSearchParams(location.search).get("id"));
let m: MarketView, cfg: any, bucket = 0;
let proof: HolderProof = { accounts: [], sgt: false, stake: false, sgtDiscountBps: 0, stakeDiscountBps: 0, minFeeBps: 0, stakeLabel: "" };
async function refreshProof() { proof = await holderProof(connection, programId, getSession()?.publicKey ?? null, cfg?.feeTiers ?? null); }

async function load(fresh = false) { [m, cfg] = await Promise.all([fetchMarket(id, { fresh }), fetchConfig({ fresh })]); await refreshProof(); render(); }
onSession(async () => { if (!cfg) return; await refreshProof(); render(); });
function render() {
  const copy = metricInfo(m.metric);
  const now = Date.now() / 1000, open = m.status === 0 && now >= m.openTs && now < m.closeTs;
  const earlyUntil = earlyBirdUntil(cfg, m), early = now < earlyUntil;
  const fee = feeWithDiscounts(cfg.feeBps, early, cfg.earlyBirdDiscountBps, proof);
  const tiers = cfg.feeTiers;
  document.title = `Kubrai · ${metricLabel(m.metric)}`;
  root.innerHTML = `
    <div class="meta" style="display:flex;gap:10px;color:var(--dim);font-size:13px">${statusPill(m)}<span>${t("mkt.n", { id: m.id })}</span><span>${m.status === 0 ? timeLeft(m.closeTs) : ""}</span></div>
    <h1>${m.nBuckets === 2 ? t("q.yesno", { q: metricLabel(m.metric), v: `<span class="mono">${fmtValue(m.metric, m.thresholds[0])}</span>` }) : t("q.range", { q: metricLabel(m.metric) })}</h1>
    <p class="lead">${copy?.how ?? ""}</p>
    <div class="kv" style="margin-bottom:16px"><b>${t("mkt.source")}</b><span>${SOURCE_LABEL[copy?.source ?? "thirdparty"]}</span></div>
    ${poolsHtml(m, m.status >= 1 && m.proposedOutcome !== NO_OUTCOME ? m.proposedOutcome : -1)}
    <h2>${t("mkt.bet")}</h2>
    <div id="bet"></div>
    <h2>${t("mkt.timeline")} <span class="note" style="text-transform:none;letter-spacing:0;font-family:var(--sans)">· ${t("mkt.zone", { z: esc(zoneName()) })}</span></h2>
    ${timelineHtml(m, cfg)}
    <h2>${t("mkt.rules")}</h2>
    <div class="kv">
      <b>${t("mkt.earlyBird")}</b><span>${t("mkt.earlyBirdV", { a: (cfg.feeBps - cfg.earlyBirdDiscountBps) / 100, ts: fmtTs(earlyUntil), b: cfg.feeBps / 100 })}</span>
      ${tiers ? `<b>${t("mkt.discounts")}</b><span>${[tiers.sgtDiscountBps ? t("mkt.sgtDisc", { pct: tiers.sgtDiscountBps / 100 }) : "", stakeRuleText(tiers)].filter(Boolean).join(" · ")}${tiers.minFeeBps ? ` · ${t("mkt.floor", { pct: tiers.minFeeBps / 100 })}` : ""}. ${t("mkt.proven")}${CLUSTER === "devnet" ? ` <span class="warn">${t("mkt.devnetNote")}</span>` : ""}</span>` : ""}
      <b>${t("mkt.proposed")}</b><span>${m.proposedAt ? t("mkt.proposedV", { ts: fmtTs(m.proposedAt), v: `<span class="mono">${fmtValue(m.metric, m.proposedValue)}</span>`, b: `<b>${bucketLabel(m, m.proposedOutcome)}</b>` }) : t("mkt.afterClose")}</span>
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
  if (!open) { box.innerHTML = `<div class="note">${m.status === 0 && Date.now() / 1000 < m.openTs ? t("bet.notOpen") : t("bet.closed")}</div>`; return; }
  box.innerHTML = `<div class="betbox">
    <div class="sides">${m.pools.map((_, i) => `<button class="${bucket === i ? "on" : ""}" style="--c:${bucketColor(m, i)}" data-b="${i}">${bucketLabel(m, i)}</button>`).join("")}</div>
    <div class="amtrow"><input id="amt" type="number" min="${cfg.minBet.toNumber() / 10 ** TOKEN_DECIMALS}" step="1" placeholder="${esc(t("bet.amountPh", { tok: TOKEN_SYMBOL }))}">${s ? `<button id="max" type="button" title="${esc(t("bet.maxTitle", { tok: TOKEN_SYMBOL }))}">${t("bet.max")}</button>` : ""}</div>
    ${s && balances.loaded ? `<div class="note">${t("bet.available")} <span class="mono">${fmtAmt(balances.token)} ${TOKEN_SYMBOL}</span>${balances.sol < 0.002 ? ` · <span class="warn">${t("bet.needSol")}</span>` : ""}</div>` : ""}
    <div class="quote" id="quote"></div>
    ${s ? `<button class="primary" id="go" style="background:${bucketColor(m, bucket)};border-color:${bucketColor(m, bucket)}">${t("bet.place", { b: bucketLabel(m, bucket) })}</button>` : `<div class="note">${t("bet.connect")}</div>`}
    <div id="msg"></div>
    <div class="note">${t("bet.parimutuel")} <b>${t("bet.yourFee", { pct: fee / 100 })}</b>${discountLabel(Date.now() / 1000 < earlyBirdUntil(cfg, m), proof) ? ` (${discountLabel(Date.now() / 1000 < earlyBirdUntil(cfg, m), proof)})` : ""} ${t("bet.feeNote")}</div>
  </div>`;
  const amtEl = box.querySelector<HTMLInputElement>("#amt")!, quote = box.querySelector("#quote")!;
  const upd = () => {
    const a = Math.round((Number(amtEl.value) || 0) * 10 ** TOKEN_DECIMALS);
    if (!a) { quote.innerHTML = `<span class="note">${t("bet.enterAmount", { b: bucketLabel(m, bucket) })}</span>`; return; }
    const q = impliedPayout(m, bucket, a, fee);
    quote.innerHTML = `<span>${t("bet.ifWins", { b: `<b>${bucketLabel(m, bucket)}</b>` })}</span><span class="big">${fmtAmt(q.total)} ${TOKEN_SYMBOL}</span><span class="note">${t("bet.breakdown", { stake: fmtAmt(a), losers: fmtAmt(q.fromLosers), fee: fmtAmt(q.fee) })}${q.fromSeed ? ` ${t("bet.plusSeed", { seed: fmtAmt(q.fromSeed) })}` : ""}. ${t("bet.otherLoses", { stake: fmtAmt(a) })}</span>`;
  };
  amtEl.oninput = upd; upd();
  const mx = box.querySelector<HTMLButtonElement>("#max"); if (mx) mx.onclick = () => { amtEl.value = String(Math.floor(balances.token / 10 ** TOKEN_DECIMALS)); upd(); };
  box.querySelectorAll<HTMLButtonElement>(".sides button").forEach((b) => (b.onclick = () => { bucket = Number(b.dataset.b); renderBet(open, fee); }));
  const go = box.querySelector<HTMLButtonElement>("#go"), msg = box.querySelector("#msg")!;
  if (go) go.onclick = async () => {
    const sess = getSession()!; const a = Math.round((Number(amtEl.value) || 0) * 10 ** TOKEN_DECIMALS);
    if (a < cfg.minBet.toNumber()) { msg.innerHTML = `<div class="msg err">${t("bet.min", { amt: fmtAmt(cfg.minBet.toNumber()), tok: TOKEN_SYMBOL })}</div>`; return; }
    go.disabled = true; msg.innerHTML = `<div class="msg">${t("bet.confirm")}</div>`;
    try {
      await refreshProof();
      // A wallet funded seconds ago can hit an RPC node that has not seen the credit yet; one retry covers it.
      const send = async () => sess.signAndSend(await buildPlaceBetTx(sess.publicKey, m, bucket, a, new PublicKey(cfg.mint), proof.accounts));
      const sig = await send().catch(async (e) => { if (!/prior credit|Blockhash not found/i.test(String(e?.message ?? e))) throw e; msg.innerHTML = `<div class="msg">${t("bet.retry")}</div>`; await new Promise((r) => setTimeout(r, 4000)); return send(); });
      msg.innerHTML = `<div class="msg">${t("bet.sent")} <span class="hash">${esc(sig)}</span></div>`;
      await confirmBySig(sig);
      const okHtml = `<div class="msg ok">${t("bet.placed", { amt: fmtAmt(a), tok: TOKEN_SYMBOL, b: bucketLabel(m, bucket) })}</div>`;
      msg.innerHTML = okHtml;
      const refNote = await bindReferralAfterBet(sess);
      await refreshBalances(); await load(true); await showPosition();
      // load() re-rendered the page: keep the confirmation visible in the fresh bet box
      const fresh = document.getElementById("msg"); if (fresh) fresh.innerHTML = okHtml;
      if (refNote) { const b = document.getElementById("bet"); if (b) b.insertAdjacentHTML("beforeend", `<div class="msg ok" style="margin-top:8px">${esc(refNote)}</div>`); }
    } catch (e: any) { msg.innerHTML = `<div class="msg err">${esc(e?.message ?? e)}</div>`; go.disabled = false; }
  };
}
async function showPosition() {
  const s = getSession(); if (!s) return;
  const p = await fetchPosition(m.pubkey, s.publicKey); if (!p) return;
  const el = document.createElement("div"); el.className = "kv"; el.style.marginTop = "12px";
  const parts = (p.amounts as any[]).slice(0, m.nBuckets).map((x, i) => [x.toNumber(), i]).filter(([x]) => x > 0).map(([x, i]) => `${bucketLabel(m, i)}: ${fmtAmt(x)}`);
  el.innerHTML = `<b>${t("bet.position")}</b><span>${parts.length ? parts.join(" · ") + " " + TOKEN_SYMBOL : t("bet.none")}</span>`;
  document.getElementById("bet")!.appendChild(el);
}
onSession(() => { if (m) { render(); showPosition(); } });
load().catch((e) => (root.innerHTML = `<div class="msg err">${t("err.market", { id: esc(id), err: esc(e.message ?? e) })}</div>`));

/** The hourly snapshots behind this market, with their values, so nobody has to dig through the API.
 *  One format everywhere: "<label>  <value>  <snapshot hour, local time>  sha256 <prefix>  memo tx". */
async function loadEvidence() {
  const el = document.getElementById("evidence"); if (!el) return;
  try {
    const r = await fetch(`${API_BASE}/evidence?metric=${encodeURIComponent(m.metric)}&open=${m.openTs}&close=${m.closeTs}&baseline=${m.baseline}&id=${m.id}`);
    if (!r.ok) { el.textContent = t("ev.none"); return; }
    const e = await r.json(); const fv = (v: number | null | undefined) => (v == null ? "—" : fmtValue(m.metric, v));
    const when = (slot?: string | null) => !slot ? "" : slot === "on-chain" ? t("ev.onchainBaseline") : `<a href="${API_BASE}/snapshots/${slot}" target="_blank" rel="noopener" title="snapshot slot ${esc(slot)} UTC">${esc(fmtTsShort(Date.parse(slot + ":00:00Z") / 1000))}</a>`;
    const proof = (x: any) => x?.sha256 ? ` · sha256 <span class="hash">${esc(x.sha256.slice(0, 12))}…</span>${x.memo ? ` · <a href="https://explorer.solana.com/tx/${x.memo}?cluster=devnet" target="_blank" rel="noopener">${t("ev.memo")}</a>` : ""}` : "";
    const row = (label: string, value: string, x: any) => `<div><b>${label}</b> <span class="mono">${value}</span>${x?.slot ? ` · ${when(x.slot)}` : ""}${proof(x)}</div>`;
    const rows: string[] = [];
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
