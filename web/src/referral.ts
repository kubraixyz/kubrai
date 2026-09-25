// Referral links (server/referrals.mjs). A visitor who lands with ?ref=CODE keeps the code in this browser; the
// first bet the connected wallet places then binds the wallet to it — signed by the wallet, so only its owner can.
import { API_BASE } from "./config";
import { bs58, type Session } from "./wallet";
import { t } from "./i18n";

const KEY = "kubrai.ref";
const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
export const pendingReferral = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const clear = () => { try { localStorage.removeItem(KEY); } catch {} };

/** On every page: remember ?ref=CODE and show who invited us (once verified by the API). */
export function captureReferral() {
  if (!API_BASE) return;
  const code = new URLSearchParams(location.search).get("ref")?.trim().toUpperCase();
  if (code && /^[A-Z0-9]{4,12}$/.test(code)) { try { localStorage.setItem(KEY, code); } catch {} }
  const have = pendingReferral(); if (!have) return;
  fetch(`${API_BASE}/referral/lookup/${have}`).then((r) => r.json()).then((j) => {
    if (!j.valid) { clear(); return; }
    if (!pendingReferral()) return;   // bound (and cleared) while we were looking it up
    const host = document.querySelector("header.top"); if (!host || document.getElementById("refbar")) return;
    const bar = document.createElement("div"); bar.id = "refbar"; bar.className = "refbar";
    bar.innerHTML = t("ref.bar", { who: `<b class="mono">${esc(j.referrer)}</b>`, pct: (j.refereeBps / 100).toFixed(0) });
    host.after(bar);
  }).catch(() => {});
}

/** On connect: if a code is pending and this wallet's only activity is its first bet, bind now (a bet whose confirmation
 *  failed in the browser, or one placed on another device, still counts). Asks the API first so the wallet only ever
 *  sees a signature prompt when the binding will go through. */
export async function bindIfPending(s: Session): Promise<void> {
  const code = pendingReferral(); if (!code || !API_BASE) return;
  try {
    const j = await (await fetch(`${API_BASE}/referral/${s.publicKey.toBase58()}`)).json();
    if (j.bound) { clear(); document.getElementById("refbar")?.remove(); return; }
    if (j.firstBet) await bindReferralAfterBet(s);
  } catch {}
}

/** After a confirmed bet: bind the wallet to the pending code. Returns a short note for the UI, or null. */
export async function bindReferralAfterBet(s: Session): Promise<string | null> {
  const code = pendingReferral(); if (!code || !API_BASE) return null;
  const wallet = s.publicKey.toBase58();
  try {
    const ts = Math.floor(Date.now() / 1000);
    const sig = await s.signMessage(new TextEncoder().encode(`kubrai-referral v1\ndomain=${location.host}\nwallet=${wallet}\ncode=${code}\nts=${ts}`));
    const r = await fetch(`${API_BASE}/referral/bind`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet, code, ts, signature: bs58(sig) }) });
    const j = await r.json();
    if (r.ok) { clear(); document.getElementById("refbar")?.remove(); document.dispatchEvent(new Event("kubrai:referral-bound")); return j.already ? null : t("ref.applied", { pct: 10 }); }
    if (j.permanent) { clear(); document.getElementById("refbar")?.remove(); }   // wrong wallet for this link; stop asking
    return null;
  } catch { return null; }   // user declined the signature or network hiccup: the code stays for the next bet
}
