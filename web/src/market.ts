import { PublicKey } from "@solana/web3.js";
import { buildPlaceBetTx, confirmBySig, currentFeeBps, fetchConfig, fetchMarket, fetchPosition, impliedPayout, type MarketView } from "./kubrai";
import { METRIC_COPY, fmtValue, metricLabel } from "./metrics";
import { fmtAmt, fmtTs, getSession, mountNetBadge, mountWallet, onSession, poolsHtml, statusPill, timeLeft } from "./ui";
import { TOKEN_DECIMALS, TOKEN_SYMBOL } from "./config";

mountNetBadge(); mountWallet();
const root = document.getElementById("market")!;
const id = Number(new URLSearchParams(location.search).get("id"));
let m: MarketView, cfg: any, side: "yes" | "no" = "yes";

async function load() { [m, cfg] = await Promise.all([fetchMarket(id), fetchConfig()]); render(); }
function render() {
  const copy = METRIC_COPY[m.metric];
  const now = Date.now() / 1000, open = m.status === 0 && now >= m.openTs && now < m.closeTs;
  const fee = currentFeeBps(cfg, m), earlyUntil = m.openTs + cfg.earlyBirdSecs.toNumber();
  document.title = `Kubrai · ${metricLabel(m.metric)}`;
  root.innerHTML = `
    <div class="meta" style="display:flex;gap:10px;color:var(--dim);font-size:13px">${statusPill(m)}<span>Market #${m.id}</span><span>${m.status === 0 ? timeLeft(m.closeTs) : ""}</span></div>
    <h1>${metricLabel(m.metric)} ≥ <span class="mono">${fmtValue(m.metric, m.threshold)}</span>?</h1>
    <p class="lead">${copy?.how ?? ""}</p>
    ${poolsHtml(m)}
    <h2>Bet</h2>
    <div id="bet"></div>
    <h2>Schedule</h2>
    <div class="kv">
      <b>Betting opens</b><span>${fmtTs(m.openTs)}</span>
      <b>Betting closes</b><span>${fmtTs(m.closeTs)}</span>
      <b>Early-bird fee</b><span>${(cfg.feeBps - cfg.earlyBirdDiscountBps) / 100}% on winnings until ${fmtTs(earlyUntil)}, then ${cfg.feeBps / 100}%</span>
      <b>Result proposed</b><span>${m.proposedAt ? `${fmtTs(m.proposedAt)} · ${m.proposedOutcome === 1 ? "YES" : "NO"} · observed <span class="mono">${fmtValue(m.metric, m.proposedValue)}</span>` : "after close"}</span>
      <b>Dispute window</b><span>${cfg.disputeWindowSecs.toNumber() / 3600} h after the proposal; anyone can then finalize</span>
      <b>Snapshot hash</b><span class="hash">${m.proposedAt ? m.snapshotHash : "—"}</span>
      <b>Market account</b><span class="hash">${m.pubkey.toBase58()}</span>
    </div>`;
  renderBet(open, fee);
}
function renderBet(open: boolean, fee: number) {
  const box = document.getElementById("bet")!;
  const s = getSession();
  if (!open) { box.innerHTML = `<div class="note">${m.status === 0 && Date.now() / 1000 < m.openTs ? "Betting has not opened yet." : "Betting is closed for this market."}</div>`; return; }
  box.innerHTML = `<div class="betbox">
    <div class="sides"><button class="yes-side ${side === "yes" ? "on" : ""}" data-s="yes">YES</button><button class="no-side ${side === "no" ? "on" : ""}" data-s="no">NO</button></div>
    <input id="amt" type="number" min="${cfg.minBet.toNumber() / 10 ** TOKEN_DECIMALS}" step="1" placeholder="Amount in ${TOKEN_SYMBOL}">
    <div class="quote" id="quote"></div>
    ${s ? `<button class="primary ${side}" id="go">Place bet</button>` : `<div class="note">Connect a wallet above to bet.</div>`}
    <div id="msg"></div>
    <div class="note">Parimutuel: the quote is what you'd get if pools stayed as they are now. Fee (${fee / 100}%) applies to winnings only, locked in at the time of this bet.</div>
  </div>`;
  const amtEl = box.querySelector<HTMLInputElement>("#amt")!, quote = box.querySelector("#quote")!;
  const upd = () => {
    const a = Math.round((Number(amtEl.value) || 0) * 10 ** TOKEN_DECIMALS);
    if (!a) { quote.innerHTML = `<span class="note">Enter an amount to see the payout if ${side.toUpperCase()} wins.</span>`; return; }
    const q = impliedPayout(m, side, a, fee);
    quote.innerHTML = `<span>If <b>${side.toUpperCase()}</b> wins you receive</span><span class="big">${fmtAmt(q.total)} ${TOKEN_SYMBOL}</span><span class="note">= your ${fmtAmt(a)} back + ${fmtAmt(q.fromLosers)} from the losing pool − ${fmtAmt(q.fee)} fee${q.fromSeed ? ` + ${fmtAmt(q.fromSeed)} house prize (fee-free)` : ""}. If ${side === "yes" ? "NO" : "YES"} wins you lose ${fmtAmt(a)}.</span>`;
  };
  amtEl.oninput = upd; upd();
  box.querySelectorAll<HTMLButtonElement>(".sides button").forEach((b) => (b.onclick = () => { side = b.dataset.s as any; renderBet(open, fee); }));
  const go = box.querySelector<HTMLButtonElement>("#go"), msg = box.querySelector("#msg")!;
  if (go) go.onclick = async () => {
    const sess = getSession()!; const a = Math.round((Number(amtEl.value) || 0) * 10 ** TOKEN_DECIMALS);
    if (a < cfg.minBet.toNumber()) { msg.innerHTML = `<div class="msg err">Minimum bet is ${fmtAmt(cfg.minBet.toNumber())} ${TOKEN_SYMBOL}.</div>`; return; }
    go.disabled = true; msg.innerHTML = `<div class="msg">Confirm in your wallet…</div>`;
    try {
      const tx = await buildPlaceBetTx(sess.publicKey, m, side, a, new PublicKey(cfg.mint));
      const sig = await sess.signAndSend(tx);
      msg.innerHTML = `<div class="msg">Sent. Waiting for confirmation… <span class="hash">${sig}</span></div>`;
      await confirmBySig(sig);
      msg.innerHTML = `<div class="msg ok">Bet placed: ${fmtAmt(a)} ${TOKEN_SYMBOL} on ${side.toUpperCase()}.</div>`;
      await load(); await showPosition();
    } catch (e: any) { msg.innerHTML = `<div class="msg err">${e?.message ?? e}</div>`; go.disabled = false; }
  };
}
async function showPosition() {
  const s = getSession(); if (!s) return;
  const p = await fetchPosition(m.pubkey, s.publicKey); if (!p) return;
  const el = document.createElement("div"); el.className = "kv"; el.style.marginTop = "12px";
  el.innerHTML = `<b>Your position</b><span>YES ${fmtAmt(p.yesAmount.toNumber())} · NO ${fmtAmt(p.noAmount.toNumber())} ${TOKEN_SYMBOL}</span>`;
  document.getElementById("bet")!.appendChild(el);
}
onSession(() => { if (m) { render(); showPosition(); } });
load().catch((e) => (root.innerHTML = `<div class="msg err">Could not load market #${id}: ${e.message ?? e}</div>`));
