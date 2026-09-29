// Invite codes (server/referrals.mjs; the web's counterpart is web/src/referral.ts). A code reaches the phone through a
// link (https://kubrai.xyz/?ref=CODE, kubrai://…?ref=CODE) or is typed in Settings, waits in AsyncStorage, and binds
// the wallet right after its first bet: the wallet signs a short dated message naming the site, the API checks the
// signature and the bet, and 10 % of the fee on every win flows back to the invitee.
import AsyncStorage from "@react-native-async-storage/async-storage";
import bs58 from "bs58";
import { APP, SITE_HOST } from "../config";

/** Codes are 4–12 upper-case letters or digits after normalisation (the range the API accepts for lookups). */
export const CODE_RE = /^[A-Z0-9]{4,12}$/;
/** Same rule as the API: trim, upper-case, O→0, I/L→1 — the code alphabet has no O, I or L. */
export const normalizeCode = (c: unknown) => String(c ?? "").trim().toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
export const isCode = (c: string) => CODE_RE.test(c);

// Only our own hosts and scheme hand the app a code (any other app can fire an explicit intent at us).
const LINK_RE = /^(?:kubrai:\/\/|https?:\/\/(?:[a-z0-9-]+\.)*kubrai\.xyz(?:[/?#]|$))/i;
/** The invite code in a link the app was opened with, or null. React Native's URL has no working searchParams, so the
 *  query is read by hand: `?ref=CODE` anywhere in the query of a kubrai.xyz or kubrai:// link. */
export function refFromUrl(url: string | null | undefined): string | null {
  if (!url || !LINK_RE.test(url)) return null;
  const m = /[?&]ref=([^&#]*)/i.exec(url); if (!m) return null;
  let raw = m[1]; try { raw = decodeURIComponent(raw); } catch {}
  const code = normalizeCode(raw); return isCode(code) ? code : null;
}

const KEY = "kubrai.ref";   // same name as the web's localStorage key
export async function loadPendingReferral(): Promise<string | null> {
  try { const code = normalizeCode(await AsyncStorage.getItem(KEY)); return isCode(code) ? code : null; } catch { return null; }
}
export async function savePendingReferral(code: string) { await AsyncStorage.setItem(KEY, normalizeCode(code)); }
export async function clearPendingReferral() { try { await AsyncStorage.removeItem(KEY); } catch {} }

export type Lookup = { valid: true; code: string; referrer: string; refereeBps: number } | { valid: false; code: string };
/** GET /referral/lookup/:code → who the code belongs to (referrer shortened by the API) and the invitee's share. */
export async function lookupReferralCode(code: string): Promise<Lookup> {
  const r = await fetch(`${APP.apiBase}/referral/lookup/${encodeURIComponent(normalizeCode(code))}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`lookup failed (${r.status})`);
  return (await r.json()) as Lookup;
}

/** What the wallet signs (plain text, so the wallet shows it). Byte-for-byte the API's referrals.bindMessage: the host
 *  is the site of this cluster (devnet.kubrai.xyz / kubrai.xyz) and `ts` unix seconds, accepted for ±10 minutes. */
export const bindMessage = (wallet: string, code: string, ts: number, host = SITE_HOST) => `kubrai-referral v1\ndomain=${host}\nwallet=${wallet}\ncode=${code}\nts=${ts}`;
export type BindResult = { ok: true; already: boolean } | { ok: false; error: string; permanent: boolean; status: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** One wallet signature, then POST /referral/bind. `permanent` answers (bound elsewhere, unknown code, not the wallet's
 *  first bet) mean the code is useless for this wallet; anything else is worth another try later. Throws when the
 *  wallet declines or the network is unreachable. */
export async function bindReferral(wallet: string, code: string, signMessage: (message: Uint8Array) => Promise<Uint8Array>): Promise<BindResult> {
  code = normalizeCode(code);
  const ts = Math.floor(Date.now() / 1000);
  const signature = bs58.encode(await signMessage(new TextEncoder().encode(bindMessage(wallet, code, ts))));
  const body = JSON.stringify({ wallet, code, ts, signature });
  // The API looks the wallet's first position up on the chain, and its RPC's account index can lag a few seconds behind
  // the confirmation the phone just saw ("place your first bet, then the link binds"). That answer is retried on the
  // same signature (valid ten minutes) — no second wallet prompt.
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${APP.apiBase}/referral/bind`, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(20_000) });
    const j: any = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, already: !!j.already };
    const error = String(j.error ?? `bind failed (${r.status})`);
    if (r.status === 409 && !j.permanent && attempt < 3) { await sleep(4000); continue; }
    return { ok: false, error, permanent: !!j.permanent, status: r.status };
  }
}
