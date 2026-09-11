import { PublicKey } from "@solana/web3.js";
import { bs58 } from "./wallet";
import { NO_OUTCOME, buildPlaceBetTx, confirmBySig, currentFeeBps, earlyBirdUntil, fetchConfig, fetchMarket, fetchPosition, impliedPayout, type MarketView } from "./kubrai";
import { SOURCE_LABEL, fmtValue, metricInfo, metricLabel } from "./metrics";
import { balances, bucketColor, bucketLabel, esc, fmtAmt, fmtTs, getSession, mountNetBadge, mountWallet, onSession, poolsHtml, refreshBalances, statusPill, timeLeft } from "./ui";
import { API_BASE, TOKEN_DECIMALS, TOKEN_SYMBOL } from "./config";

mountNetBadge(); mountWallet();
const root = document.getElementById("market")!;
const id = Number(new URLSearchParams(location.search).get("id"));
let m: MarketView, cfg: any, bucket = 0;

async function load() { [m, cfg] = await Promise.all([fetchMarket(id), fetchConfig()]); render(); }
function render() {
  const copy = metricInfo(m.metric);
  const now = Date.now() / 1000, open = m.status === 0 && now >= m.openTs && now < m.closeTs;
  const fee = currentFeeBps(cfg, m), earlyUntil = earlyBirdUntil(cfg, m);
  document.title = `Kubrai · ${metricLabel(m.metric)}`;
  root.innerHTML = `
    <div class="meta" style="display:flex;gap:10px;color:var(--dim);font-size:13px">${statusPill(m)}<span>Market #${m.id}</span><span>${m.status === 0 ? timeLeft(m.closeTs) : ""}</span></div>
    <h1>${m.nBuckets === 2 ? `${metricLabel(m.metric)} ≥&nbsp;<span class="mono">${fmtValue(m.metric, m.thresholds[0])}</span>?` : `${metricLabel(m.metric)}: which range?`}</h1>
    <p class="lead">${copy?.how ?? ""}</p>
    <div class="kv" style="margin-bottom:16px">${copy?.cumulative ? `<b>Baseline at open</b><span class="mono">${fmtValue(m.metric, m.baseline)}</span>` : `<b>Value at open</b><span class="mono">${fmtValue(m.metric, m.baseline)}</span>`}<b>Data source</b><span>${SOURCE_LABEL[copy?.source ?? "thirdparty"]}</span></div>
    ${poolsHtml(m, m.status >= 1 && m.proposedOutcome !== NO_OUTCOME ? m.proposedOutcome : -1)}
    <h2>Bet</h2>
    <div id="bet"></div>
    <h2>Schedule</h2>
    <div class="kv">
      <b>Betting opens</b><span>${fmtTs(m.openTs)}</span>
      <b>Betting closes</b><span>${fmtTs(m.closeTs)}</span>
      <b>Early-bird fee</b><span>${(cfg.feeBps - cfg.earlyBirdDiscountBps) / 100}% on winnings until ${fmtTs(earlyUntil)}, then ${cfg.feeBps / 100}%</span>
      <b>Result proposed</b><span>${m.proposedAt ? `${fmtTs(m.proposedAt)} · observed <span class="mono">${fmtValue(m.metric, m.proposedValue)}</span> → <b>${bucketLabel(m, m.proposedOutcome)}</b>` : "after close"}</span>
      ${m.nBuckets > 2 ? `<b>How ranges are set</b><span>Cut at the quantiles of the recent history of this metric, so every range started out roughly equally likely. Odds then move with the pools.</span>` : ""}
      <b>Dispute window</b><span>${cfg.disputeWindowSecs.toNumber() / 3600} h after the proposal; anyone can then finalize</span>
      <b>Snapshot hash</b><span class="hash">${m.proposedAt ? m.snapshotHash : "—"}</span>
      ${m.status === 1 ? `<b>Disagree?</b><span><div id="dispute"><button id="dbtn">Dispute this result</button> <span class="note">Open until ${fmtTs(m.proposedAt + cfg.disputeWindowSecs.toNumber())}. You sign a message with your wallet; the operator is paged and must re-propose or void before the window ends.</span></div><div id="dlist" class="note"></div></span>` : ""}
      <b>Market account</b><span class="hash">${m.pubkey.toBase58()}</span>
    </div>`;
  renderBet(open, fee);
  mountDispute();
}
async function mountDispute() {
  const box = document.getElementById("dispute"); if (!box) return;
  try { const r = await fetch(`${API_BASE}/disputes?market=${m.pubkey.toBase58()}`); const j = await r.json(); const open = (j.disputes ?? []).filter((d: any) => d.status === "open"); if (open.length) document.getElementById("dlist")!.textContent = `${open.length} open dispute${open.length > 1 ? "s" : ""} already filed.`; } catch {}
  const btn = document.getElementById("dbtn") as HTMLButtonElement;
  btn.onclick = async () => {
    const s = getSession(); if (!s) { alert("Connect a wallet first."); return; }
    const reason = prompt("Why is the proposed result wrong? (what you observed, where)"); if (!reason || reason.trim().length < 5) return;
    const claimed = prompt("What should the observed value be? (leave empty if unsure)") ?? "";
    btn.disabled = true;
    try {
      const msg = `kubrai-dispute v1\nmarket=${m.pubkey.toBase58()}\nwallet=${s.publicKey.toBase58()}\nclaimed=${claimed.trim()}\nreason=${reason.trim().slice(0, 2000)}`;
      const sig = await s.signMessage(new TextEncoder().encode(msg));
      const r = await fetch(`${API_BASE}/dispute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ market: m.pubkey.toBase58(), wallet: s.publicKey.toBase58(), reason: reason.trim().slice(0, 2000), claimedValue: claimed.trim() || null, signature: bs58(sig) }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "failed");
      document.getElementById("dlist")!.textContent = "Dispute filed. The operator has been notified.";
    } catch (e: any) { alert(e?.message ?? e); btn.disabled = false; }
  };
}
function renderBet(open: boolean, fee: number) {
  const box = document.getElementById("bet")!;
  const s = getSession();
  if (!open) { box.innerHTML = `<div class="note">${m.status === 0 && Date.now() / 1000 < m.openTs ? "Betting has not opened yet." : "Betting is closed for this market."}</div>`; return; }
  box.innerHTML = `<div class="betbox">
    <div class="sides">${m.pools.map((_, i) => `<button class="${bucket === i ? "on" : ""}" style="--c:${bucketColor(m, i)}" data-b="${i}">${bucketLabel(m, i)}</button>`).join("")}</div>
    <div class="amtrow"><input id="amt" type="number" min="${cfg.minBet.toNumber() / 10 ** TOKEN_DECIMALS}" step="1" placeholder="Amount in ${TOKEN_SYMBOL}">${s ? `<button id="max" type="button" title="Bet your whole ${TOKEN_SYMBOL} balance">Max</button>` : ""}</div>
    ${s && balances.loaded ? `<div class="note">Available: <span class="mono">${fmtAmt(balances.token)} ${TOKEN_SYMBOL}</span>${balances.sol < 0.002 ? ` · <span class="warn">you need a little SOL for the network fee</span>` : ""}</div>` : ""}
    <div class="quote" id="quote"></div>
    ${s ? `<button class="primary" id="go" style="background:${bucketColor(m, bucket)};border-color:${bucketColor(m, bucket)}">Place bet on “${bucketLabel(m, bucket)}”</button>` : `<div class="note">Connect a wallet above to bet.</div>`}
    <div id="msg"></div>
    <div class="note">Parimutuel: the quote is what you'd get if pools stayed as they are now. Fee (${fee / 100}%) applies to winnings only, locked in at the time of this bet.</div>
  </div>`;
  const amtEl = box.querySelector<HTMLInputElement>("#amt")!, quote = box.querySelector("#quote")!;
  const upd = () => {
    const a = Math.round((Number(amtEl.value) || 0) * 10 ** TOKEN_DECIMALS);
    if (!a) { quote.innerHTML = `<span class="note">Enter an amount to see the payout if “${bucketLabel(m, bucket)}” wins.</span>`; return; }
    const q = impliedPayout(m, bucket, a, fee);
    quote.innerHTML = `<span>If <b>${bucketLabel(m, bucket)}</b> wins you receive</span><span class="big">${fmtAmt(q.total)} ${TOKEN_SYMBOL}</span><span class="note">= your ${fmtAmt(a)} back + ${fmtAmt(q.fromLosers)} from the losing pools − ${fmtAmt(q.fee)} fee${q.fromSeed ? ` + ${fmtAmt(q.fromSeed)} house prize (fee-free)` : ""}. Any other outcome loses ${fmtAmt(a)}.</span>`;
  };
  amtEl.oninput = upd; upd();
  const mx = box.querySelector<HTMLButtonElement>("#max"); if (mx) mx.onclick = () => { amtEl.value = String(Math.floor(balances.token / 10 ** TOKEN_DECIMALS)); upd(); };
  box.querySelectorAll<HTMLButtonElement>(".sides button").forEach((b) => (b.onclick = () => { bucket = Number(b.dataset.b); renderBet(open, fee); }));
  const go = box.querySelector<HTMLButtonElement>("#go"), msg = box.querySelector("#msg")!;
  if (go) go.onclick = async () => {
    const sess = getSession()!; const a = Math.round((Number(amtEl.value) || 0) * 10 ** TOKEN_DECIMALS);
    if (a < cfg.minBet.toNumber()) { msg.innerHTML = `<div class="msg err">Minimum bet is ${fmtAmt(cfg.minBet.toNumber())} ${TOKEN_SYMBOL}.</div>`; return; }
    go.disabled = true; msg.innerHTML = `<div class="msg">Confirm in your wallet…</div>`;
    try {
      const tx = await buildPlaceBetTx(sess.publicKey, m, bucket, a, new PublicKey(cfg.mint));
      const sig = await sess.signAndSend(tx);
      msg.innerHTML = `<div class="msg">Sent. Waiting for confirmation… <span class="hash">${esc(sig)}</span></div>`;
      await confirmBySig(sig);
      msg.innerHTML = `<div class="msg ok">Bet placed: ${fmtAmt(a)} ${TOKEN_SYMBOL} on “${bucketLabel(m, bucket)}”.</div>`;
      await refreshBalances(); await load(); await showPosition();
    } catch (e: any) { msg.innerHTML = `<div class="msg err">${esc(e?.message ?? e)}</div>`; go.disabled = false; }
  };
}
async function showPosition() {
  const s = getSession(); if (!s) return;
  const p = await fetchPosition(m.pubkey, s.publicKey); if (!p) return;
  const el = document.createElement("div"); el.className = "kv"; el.style.marginTop = "12px";
  const parts = (p.amounts as any[]).slice(0, m.nBuckets).map((x, i) => [x.toNumber(), i]).filter(([x]) => x > 0).map(([x, i]) => `${bucketLabel(m, i)}: ${fmtAmt(x)}`);
  el.innerHTML = `<b>Your position</b><span>${parts.length ? parts.join(" · ") + " " + TOKEN_SYMBOL : "none"}</span>`;
  document.getElementById("bet")!.appendChild(el);
}
onSession(() => { if (m) { render(); showPosition(); } });
load().catch((e) => (root.innerHTML = `<div class="msg err">Could not load market #${esc(id)}: ${esc(e.message ?? e)}</div>`));
