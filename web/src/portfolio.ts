import { PublicKey } from "@solana/web3.js";
import { NO_OUTCOME, fetchConfig, fetchMarkets, fetchPositionsByOwner, payoutIfBucket, type MarketView } from "./kubrai";
import { metricLabel } from "./metrics";
import { bucketLabel, fmtAmt, fmtTs, mountNetBadge, mountWallet, onSession, statusPill } from "./ui";
import { API_BASE, TOKEN_SYMBOL } from "./config";

mountNetBadge(); mountWallet();
const openEl = document.getElementById("open")!, settledEl = document.getElementById("settled")!;

async function render(owner: PublicKey | null) {
  if (!owner) { openEl.innerHTML = `<div class="note">Connect a wallet to see your bets.</div>`; settledEl.innerHTML = `<div class="note">—</div>`; return; }
  openEl.innerHTML = `<div class="note">Loading…</div>`;
  const [markets, positions, cfg] = await Promise.all([fetchMarkets(), fetchPositionsByOwner(owner), fetchConfig()]);
  const byKey = new Map(markets.map((m) => [m.pubkey.toBase58(), m]));
  const rows = positions.map((p) => ({ p, m: byKey.get(p.market.toBase58()) })).filter((x) => x.m) as { p: any; m: MarketView }[];
  if (!rows.length) openEl.innerHTML = `<div class="note">No open bets. <a href="/">Pick a market</a>.</div>`;
  else openEl.innerHTML = `<div class="scroll"><table class="tbl"><thead><tr><th>Market</th><th>Your bets</th><th>Status</th><th class="r">Now worth</th></tr></thead><tbody>${rows.map(({ p, m }) => {
    const feeBps = p.amounts.map((a: number, i: number) => (a ? Number(BigInt(p.feeW[i].toString()) / BigInt(a)) : 0));
    const bets = p.amounts.map((a: number, i: number) => (a ? `${bucketLabel(m, i)}: <span class="mono">${fmtAmt(a)}</span>` : "")).filter(Boolean).join("<br>");
    const w = m.status === 2 ? m.outcome : m.status === 1 ? m.proposedOutcome : NO_OUTCOME;
    let value: string;
    if (m.status === 3) value = `refund ${fmtAmt(p.amounts.reduce((x: number, y: number) => x + y, 0))}`;
    else if (w !== NO_OUTCOME) { const r = payoutIfBucket(m, p.amounts, feeBps, w); value = r.kind === "lost" ? "0 (lost)" : `${fmtAmt(r.payout)} (${r.kind})`; }
    else { // open: show what each bet would pay if its bucket won
      value = p.amounts.map((a: number, i: number) => (a ? `${fmtAmt(payoutIfBucket(m, p.amounts, feeBps, i).payout)} if ${bucketLabel(m, i)}` : "")).filter(Boolean).join("<br>");
    }
    const st = m.status === 2 ? "Resolved · paying out soon" : m.status === 1 ? `Result proposed: ${bucketLabel(m, m.proposedOutcome)}` : m.status === 3 ? "Voided · refunding" : Date.now() / 1000 < m.closeTs ? "Open" : "Awaiting result";
    return `<tr><td><a href="/market.html?id=${m.id}">${metricLabel(m.metric)}</a><div class="note">#${m.id} · closes ${fmtTs(m.closeTs)}</div></td><td>${bets}</td><td>${statusPill(m)}<div class="note">${st}</div></td><td class="r mono">${value} ${TOKEN_SYMBOL}</td></tr>`;
  }).join("")}</tbody></table></div><div class="note" style="margin-top:8px">Payouts are settled automatically after the dispute window; nothing to claim. “Now worth” assumes pools stay as they are.</div>`;

  // settled history from the API
  settledEl.innerHTML = `<div class="note">Loading…</div>`;
  try {
    const r = await fetch(`${API_BASE}/positions/${owner.toBase58()}`); const j = await r.json();
    if (!j.settled?.length) { settledEl.innerHTML = `<div class="note">Nothing settled yet.</div>`; return; }
    settledEl.innerHTML = `<div class="scroll"><table class="tbl"><thead><tr><th>Market</th><th>Your bets</th><th>Outcome</th><th class="r">Paid</th><th>Tx</th></tr></thead><tbody>${j.settled.map((s: any) => {
      const m = byKey.get(s.market);
      const bets = s.amounts.map((a: string, i: number) => (Number(a) ? `${m ? bucketLabel(m, i) : "bucket " + i}: <span class="mono">${fmtAmt(Number(a))}</span>` : "")).filter(Boolean).join("<br>");
      const outcome = s.status === 3 ? "Voided" : m ? `${bucketLabel(m, s.outcome)} (observed ${Number(s.observed).toLocaleString("en-US")})` : `bucket ${s.outcome}`;
      const cls = s.kind === "won" ? "ok" : s.kind === "lost" ? "err" : "";
      return `<tr><td>${m ? `<a href="/market.html?id=${m.id}">${metricLabel(m.metric)}</a>` : s.metric}<div class="note">#${s.id} · ${fmtTs(Date.parse(s.at) / 1000)}</div></td><td>${bets}</td><td>${outcome}</td><td class="r mono"><span class="msg ${cls}" style="padding:2px 8px">${s.kind === "lost" ? "0" : fmtAmt(Number(s.payout))} ${TOKEN_SYMBOL}</span></td><td class="hash"><a href="https://explorer.solana.com/tx/${s.signature}?cluster=devnet" target="_blank" rel="noopener">${s.signature.slice(0, 8)}…</a></td></tr>`;
    }).join("")}</tbody></table></div>`;
  } catch { settledEl.innerHTML = `<div class="note">Settlement history unavailable right now.</div>`; }
}
onSession((s) => { render(s ? s.publicKey : null); });
