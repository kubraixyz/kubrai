// Invite page: the wallet's referral link (unlocked by its first bet), who it brought in, and what that earned.
import { esc, getSession, mountNetBadge, mountWallet, onSession } from "./ui";
import { API_BASE, CLUSTER, TOKEN_SYMBOL } from "./config";
import { fmtTs } from "./time";

mountNetBadge(); mountWallet();
const el = document.getElementById("invite")!;
const pct = (bps: number) => (bps / 100).toFixed(0) + "%";
const amt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const explorerTx = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=${CLUSTER === "mainnet" ? "mainnet-beta" : "devnet"}`;

async function render() {
  const s = getSession(); const wallet = s?.publicKey.toBase58() ?? null;
  if (!wallet) { el.innerHTML = `<div class="fcard"><div class="note">Connect a wallet to see your invite link.</div></div>${howHtml(null)}`; return; }
  el.innerHTML = `<div class="fcard"><div class="note">Loading…</div></div>`;
  try {
    let r = await fetch(`${API_BASE}/referral/${wallet}`); let j = await r.json();
    // The code is minted on first visit after the first bet. The RPC index behind the API can trail the confirmation
    // the browser just saw by a few seconds, so a "place a bet first" right after betting is asked again once.
    for (let attempt = 0; r.ok && j.eligible && !j.code && attempt < 2; attempt++) {
      if (attempt) await new Promise((res) => setTimeout(res, 4000));
      r = await fetch(`${API_BASE}/referral/code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet }) }); j = await r.json();
      if (r.ok || r.status !== 403) break;
    }
    if (!r.ok) throw new Error(j.error ?? "failed");
    const link = j.eligible
      ? `<div class="linkbox"><input class="mono" id="link" readonly value="${esc(j.link)}"><button class="primary" id="copy">Copy link</button></div><div class="note">Your code is <b class="mono">${esc(j.code)}</b>. Anyone who opens the link and then bets for the first time is yours, on every network.</div>`
      : `<div class="msg">Place one bet to unlock your invite link.</div>`;
    const payouts = (j.payouts as any[]).length ? `<div class="note" style="margin-top:8px">Last payouts: ${(j.payouts as any[]).slice(0, 5).map((p) => `${amt(p.amount)} ${TOKEN_SYMBOL} <a href="${explorerTx(p.signature)}" target="_blank" rel="noopener">tx</a> (${esc(fmtTs(Date.parse(p.at) / 1000))})`).join(" · ")}</div>` : "";
    el.innerHTML = `
      <div class="fcard"><h2 style="margin:0">Your link</h2>${link}
        <div class="lbstats four"><div><span class="note">Invited</span><b>${Number(j.referred)}</b></div><div><span class="note">Your share</span><b>${pct(j.tierBps)}</b></div><div><span class="note">Earned</span><b>${amt(j.earned)} <small>${TOKEN_SYMBOL}</small></b></div><div><span class="note">Your points</span><b>${Math.round(j.points).toLocaleString("en-US")}</b></div></div>
        ${j.nextTier ? `<div class="note">${(j.nextTier.points - j.points).toLocaleString("en-US", { maximumFractionDigits: 0 })} more points and your share rises to ${pct(j.nextTier.bps)}.</div>` : ""}
        ${j.bound ? `<div class="note">You joined through <b class="mono">${esc(j.bound.code)}</b> (${esc(j.bound.referrer)}): ${pct(j.refereeBps)} of the fee on every win comes back to you.</div>` : ""}
      </div>
      <div class="fcard"><h3 style="margin:0">Earnings</h3>
        <div class="kv"><b>As inviter</b><span class="mono">${amt(j.asReferrer)} ${TOKEN_SYMBOL}</span><b>As invitee (fee back)</b><span class="mono">${amt(j.asReferee)} ${TOKEN_SYMBOL}</span><b>Paid so far</b><span class="mono">${amt(j.paid)} ${TOKEN_SYMBOL}</span><b>Owed</b><span class="mono">${amt(j.owed)} ${TOKEN_SYMBOL}</span></div>
        <div class="note">Paid every Monday, straight to your wallet's ${TOKEN_SYMBOL} account, from the fees collected. Sums under 0.01 ${TOKEN_SYMBOL} wait; a wallet without a ${TOKEN_SYMBOL} account gets one opened once it is owed 5 ${TOKEN_SYMBOL}.</div>${payouts}
      </div>
      ${howHtml(j)}`;
    const cp = document.getElementById("copy") as HTMLButtonElement | null, inp = document.getElementById("link") as HTMLInputElement | null;
    if (cp && inp) cp.onclick = async () => { try { await navigator.clipboard.writeText(inp.value); cp.textContent = "Copied"; } catch { inp.select(); } setTimeout(() => (cp.textContent = "Copy link"), 1500); };
  } catch (e: any) { el.innerHTML = `<div class="fcard"><div class="msg err">${esc(e?.message ?? e)}</div></div>`; }
}
function howHtml(j: any) {
  const tiers: { points: number; bps: number }[] = j?.tiers ?? [{ points: 0, bps: 2000 }, { points: 10_000, bps: 2500 }, { points: 100_000, bps: 3000 }];
  const refereeBps = j?.refereeBps ?? 1000;
  return `<div class="fcard"><h3 style="margin:0">How it works</h3>
    <ol class="fsteps">
      <li>Bet once: your link unlocks. Share it anywhere.</li>
      <li>A friend opens it and places a first bet: their wallet is bound to your code, for good. They get ${pct(refereeBps)} of the fee on every win back.</li>
      <li>You earn a share of the fee every time an invitee wins. Fees are 3% of winnings (less with discounts), so with 10 invitees each winning 100 ${TOKEN_SYMBOL} a week you earn about ${amt(10 * 3 * (tiers[0].bps / 10000))} ${TOKEN_SYMBOL} a week.</li>
    </ol>
    <table class="tbl" style="min-width:0"><thead><tr><th>Your all-time points</th><th class="r">Your share of invitees' fees</th></tr></thead><tbody>${tiers.map((t) => `<tr${j && t.bps === j.tierBps ? ' class="me"' : ""}><td>${t.points ? `from ${t.points.toLocaleString("en-US")}` : "from the first bet"}</td><td class="r"><b>${pct(t.bps)}</b></td></tr>`).join("")}</tbody></table>
  </div>`;
}
onSession(() => render());
document.addEventListener("kubrai:referral-bound", () => render());
