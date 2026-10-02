import { PublicKey } from "@solana/web3.js";
import { NO_OUTCOME, fetchConfig, fetchMarkets, fetchMarketsFresh, fetchPositionsByOwner, payoutIfBucket, type MarketView } from "./kubrai";
import { metricLabel } from "./metrics";
import { bucketLabel, esc, fmtAmt, fmtTs, isBase58, mountNetBadge, mountWallet, onSession, statusPill } from "./ui";
import { API_BASE, TOKEN_SYMBOL } from "./config";
import { nextStepText } from "./timeline";
import { t } from "./i18n";
import { explorerTx } from "./explorer";

mountNetBadge(); mountWallet();
const openEl = document.getElementById("open")!, settledEl = document.getElementById("settled")!;

// Column names, also written into each cell (data-label): on a phone the tables are drawn as one card per bet with the
// name beside each value (styles.css .tbl.stack). As a table 640px wide in a 349px box, the last column, what the bet
// is worth now, sat off screen with nothing to say it was there.
const L = { bets: esc(t("pf.colBets")), status: esc(t("pf.colStatus")), worth: esc(t("pf.colWorth")), outcome: esc(t("pf.colOutcome")), paid: esc(t("pf.colPaid")) };
async function render(owner: PublicKey | null) {
  if (!owner) { openEl.innerHTML = `<div class="note">${t("pf.connect")}</div>`; settledEl.innerHTML = `<div class="note">—</div>`; return; }
  openEl.innerHTML = `<div class="note">${t("common.loading")}</div>`;
  const [markets, positions, cfg] = await Promise.all([fetchMarkets(), fetchPositionsByOwner(owner), fetchConfig()]);
  const byKey = new Map(markets.map((m) => [m.pubkey.toBase58(), m]));
  const rows = positions.map((p: any) => ({ p, m: byKey.get(p.market.toBase58()) })).filter((x: any) => x.m) as { p: any; m: MarketView }[];
  // "Now worth" divides the pools by the wallet's own stake. The stake comes straight from the chain and the pools from
  // a list that may be half a minute old, so just after a bet the two disagreed: two equal bets on one market read
  // "1 if < 10" and "2 if = 10" until the page was loaded again. The markets still open for bets are read from the
  // chain as well (one request for all of them); if that fails the cached pools stand.
  try {
    // the public RPC can leave a request hanging for good: after 4 s the cached pools stand, as they do when it fails
    const live = (await Promise.race([fetchMarketsFresh(rows.filter((x) => x.m.status === 0).map((x) => x.m.pubkey)), new Promise<null>((r) => setTimeout(() => r(null), 4000))])) ?? [];
    const liveByKey = new Map(live.map((m) => [m.pubkey.toBase58(), m]));
    for (const x of rows) x.m = liveByKey.get(x.m.pubkey.toBase58()) ?? x.m;
  } catch (e) { console.warn("live pools unavailable, showing cached ones", e); }
  if (!rows.length) openEl.innerHTML = `<div class="note">${t("pf.noOpen")}</div>`;
  else openEl.innerHTML = `<div class="scroll"><table class="tbl stack"><thead><tr><th>${t("pf.colMarket")}</th><th>${t("pf.colBets")}</th><th>${t("pf.colStatus")}</th><th class="r">${t("pf.colWorth")}</th></tr></thead><tbody>${rows.map(({ p, m }) => {
    const feeBps = p.amounts.map((a: number, i: number) => (a ? Number(BigInt(p.feeW[i].toString()) / BigInt(a)) : 0));
    const bets = p.amounts.map((a: number, i: number) => (a ? `${bucketLabel(m, i)}: <span class="mono">${fmtAmt(a)}</span>` : "")).filter(Boolean).join("<br>");
    const w = m.status === 2 ? m.outcome : m.status === 1 ? m.proposedOutcome : NO_OUTCOME;
    let value: string;
    if (m.status === 3) value = t("pf.refund", { amt: fmtAmt(p.amounts.reduce((x: number, y: number) => x + y, 0)) });
    else if (w !== NO_OUTCOME) { const r = payoutIfBucket(m, p.amounts, feeBps, w); value = r.kind === "lost" ? t("pf.lost0") : `${fmtAmt(r.payout)} (${t("kind." + r.kind)})`; }
    else { // open: show what each bet would pay if its bucket won
      value = p.amounts.map((a: number, i: number) => (a ? t("pf.ifRange", { amt: fmtAmt(payoutIfBucket(m, p.amounts, feeBps, i).payout), b: bucketLabel(m, i) }) : "")).filter(Boolean).join("<br>");
    }
    const st = m.status === 2 ? t("pf.stResolved") : m.status === 1 ? t("pf.stProposed", { b: bucketLabel(m, m.proposedOutcome) }) : m.status === 3 ? t("pf.stVoided") : Date.now() / 1000 < m.closeTs ? t("status.open") : t("status.awaiting");
    return `<tr><td><a href="/market.html?id=${m.id}">${metricLabel(m.metric)}</a><div class="note">#${m.id} · ${t("card.closes", { ts: fmtTs(m.closeTs) })}</div></td><td data-label="${L.bets}"><div>${bets}</div></td><td data-label="${L.status}"><div>${statusPill(m)}<div class="note">${st}</div><div class="note">${esc(nextStepText(m, cfg))}</div></div></td><td class="r mono" data-label="${L.worth}"><div>${value} ${TOKEN_SYMBOL}</div></td></tr>`;
  }).join("")}</tbody></table></div><div class="note" style="margin-top:8px">${t("pf.autoNote")}</div>`;

  // settled history from the API
  settledEl.innerHTML = `<div class="note">${t("common.loading")}</div>`;
  try {
    const r = await fetch(`${API_BASE}/positions/${owner.toBase58()}`); const j = await r.json();
    if (!j.settled?.length) { settledEl.innerHTML = `<div class="note">${t("pf.noSettled")}</div>`; return; }
    settledEl.innerHTML = `<div class="scroll"><table class="tbl stack"><thead><tr><th>${t("pf.colMarket")}</th><th>${t("pf.colBets")}</th><th>${t("pf.colOutcome")}</th><th class="r">${t("pf.colPaid")}</th><th>Tx</th></tr></thead><tbody>${j.settled.map((s: any) => {
      const m = byKey.get(s.market);
      const bets = s.amounts.map((a: string, i: number) => (Number(a) ? `${m ? bucketLabel(m, i) : "bucket " + i}: <span class="mono">${fmtAmt(Number(a))}</span>` : "")).filter(Boolean).join("<br>");
      const outcome = s.status === 3 ? t("status.voided") : m ? t("pf.outcomeV", { b: bucketLabel(m, Number(s.outcome)), v: Number(s.observed).toLocaleString("en-US") }) : `bucket ${esc(s.outcome)}`;
      const cls = s.kind === "won" ? "ok" : s.kind === "lost" ? "err" : "";
      const sig = isBase58(s.signature) ? s.signature : null;
      return `<tr><td>${m ? `<a href="/market.html?id=${m.id}">${metricLabel(m.metric)}</a>` : esc(metricLabel(String(s.metric)))}<div class="note">#${esc(s.id)} · ${fmtTs(Date.parse(s.at) / 1000)}</div></td><td data-label="${L.bets}"><div>${bets}</div></td><td data-label="${L.outcome}"><div>${esc(outcome)}</div></td><td class="r mono" data-label="${L.paid}"><span class="msg ${cls}" style="padding:2px 8px">${s.kind === "lost" ? "0" : fmtAmt(Number(s.payout))} ${TOKEN_SYMBOL}</span></td><td class="hash" data-label="Tx">${sig ? `<a href="${explorerTx(sig)}" target="_blank" rel="noopener">${sig.slice(0, 8)}…</a>` : "—"}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  } catch { settledEl.innerHTML = `<div class="note">${t("pf.histErr")}</div>`; }
}
onSession((s) => { render(s ? s.publicKey : null); });
