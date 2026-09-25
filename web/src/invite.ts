// Invite page: the wallet's referral link (unlocked by its first bet), who it brought in, and what that earned.
import { esc, getSession, mountNetBadge, mountWallet, onSession } from "./ui";
import { API_BASE, CLUSTER, TOKEN_SYMBOL } from "./config";
import { fmtTs } from "./time";
import { t } from "./i18n";

mountNetBadge(); mountWallet();
const el = document.getElementById("invite")!;
const pct = (bps: number) => (bps / 100).toFixed(0) + "%";
const amt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const explorerTx = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=${CLUSTER === "mainnet" ? "mainnet-beta" : "devnet"}`;

async function render() {
  const s = getSession(); const wallet = s?.publicKey.toBase58() ?? null;
  if (!wallet) { el.innerHTML = `<div class="fcard"><div class="note">${t("inv.connect")}</div></div>${howHtml(null)}`; return; }
  el.innerHTML = `<div class="fcard"><div class="note">${t("common.loading")}</div></div>`;
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
      ? `<div class="linkbox"><input class="mono" id="link" readonly value="${esc(j.link)}"><button class="primary" id="copy">${t("inv.copy")}</button></div><div class="note">${t("inv.code", { code: `<b class="mono">${esc(j.code)}</b>` })}</div>`
      : `<div class="msg">${t("inv.locked")}</div>`;
    const payouts = (j.payouts as any[]).length ? `<div class="note" style="margin-top:8px">${t("inv.lastPayouts")} ${(j.payouts as any[]).slice(0, 5).map((p) => `${amt(p.amount)} ${TOKEN_SYMBOL} <a href="${explorerTx(p.signature)}" target="_blank" rel="noopener">tx</a> (${esc(fmtTs(Date.parse(p.at) / 1000))})`).join(" · ")}</div>` : "";
    el.innerHTML = `
      <div class="fcard"><h2 style="margin:0">${t("inv.yourLink")}</h2>${link}
        <div class="lbstats four"><div><span class="note">${t("inv.invited")}</span><b>${Number(j.referred)}</b></div><div><span class="note">${t("inv.share")}</span><b>${pct(j.tierBps)}</b></div><div><span class="note">${t("inv.earned")}</span><b>${amt(j.earned)} <small>${TOKEN_SYMBOL}</small></b></div><div><span class="note">${t("inv.points")}</span><b>${Math.round(j.points).toLocaleString("en-US")}</b></div></div>
        ${j.nextTier ? `<div class="note">${t("inv.next", { n: (j.nextTier.points - j.points).toLocaleString("en-US", { maximumFractionDigits: 0 }), pct: pct(j.nextTier.bps) })}</div>` : ""}
        ${j.bound ? `<div class="note">${t("inv.joined", { code: `<b class="mono">${esc(j.bound.code)}</b>`, who: esc(j.bound.referrer), pct: pct(j.refereeBps) })}</div>` : ""}
      </div>
      <div class="fcard"><h3 style="margin:0">${t("inv.earnings")}</h3>
        <div class="kv"><b>${t("inv.asInviter")}</b><span class="mono">${amt(j.asReferrer)} ${TOKEN_SYMBOL}</span><b>${t("inv.asInvitee")}</b><span class="mono">${amt(j.asReferee)} ${TOKEN_SYMBOL}</span><b>${t("inv.paid")}</b><span class="mono">${amt(j.paid)} ${TOKEN_SYMBOL}</span><b>${t("inv.owed")}</b><span class="mono">${amt(j.owed)} ${TOKEN_SYMBOL}</span></div>
        <div class="note">${t("inv.payNote", { tok: TOKEN_SYMBOL })}</div>${payouts}
      </div>
      ${howHtml(j)}`;
    const cp = document.getElementById("copy") as HTMLButtonElement | null, inp = document.getElementById("link") as HTMLInputElement | null;
    if (cp && inp) cp.onclick = async () => { try { await navigator.clipboard.writeText(inp.value); cp.textContent = t("common.copied"); } catch { inp.select(); } setTimeout(() => (cp.textContent = t("inv.copy")), 1500); };
  } catch (e: any) { el.innerHTML = `<div class="fcard"><div class="msg err">${esc(e?.message ?? e)}</div></div>`; }
}
function howHtml(j: any) {
  const tiers: { points: number; bps: number }[] = j?.tiers ?? [{ points: 0, bps: 2000 }, { points: 10_000, bps: 2500 }, { points: 100_000, bps: 3000 }];
  const refereeBps = j?.refereeBps ?? 1000;
  return `<div class="fcard"><h3 style="margin:0">${t("inv.how")}</h3>
    <ol class="fsteps">
      <li>${t("inv.how1")}</li>
      <li>${t("inv.how2", { pct: pct(refereeBps) })}</li>
      <li>${t("inv.how3", { tok: TOKEN_SYMBOL, amt: amt(10 * 3 * (tiers[0].bps / 10000)) })}</li>
    </ol>
    <table class="tbl" style="min-width:0"><thead><tr><th>${t("inv.colAllTime")}</th><th class="r">${t("inv.colShare")}</th></tr></thead><tbody>${tiers.map((x) => `<tr${j && x.bps === j.tierBps ? ' class="me"' : ""}><td>${x.points ? t("inv.tierFrom", { n: x.points.toLocaleString("en-US") }) : t("inv.tierFirst")}</td><td class="r"><b>${pct(x.bps)}</b></td></tr>`).join("")}</tbody></table>
  </div>`;
}
onSession(() => render());
document.addEventListener("kubrai:referral-bound", () => render());
