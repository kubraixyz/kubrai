// Invite-code state shared by the screens (chain/referral.ts does the storage and API calls). The pending code lives in
// AsyncStorage and is mirrored through react-query, so Settings, the market screen and the link listener agree.
import { t } from "../i18n";
import { useCallback, useEffect, useRef } from "react";
import { Linking } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMobileWallet } from "../utils/useMobileWallet";
import { recordError } from "../utils/errorLog";
import { bindReferral, clearPendingReferral, loadPendingReferral, lookupReferralCode, normalizeCode, refFromUrl, savePendingReferral, type Lookup } from "../chain/referral";

export const PENDING_KEY = ["referral-pending"] as const;
export const lookupKey = (code: string) => ["referral-lookup", code] as const;
export type InviteNote = { kind: "ok" | "err" | "info"; text: string };

/** The code waiting on this phone, or null. */
export function usePendingReferral() { return useQuery({ queryKey: PENDING_KEY, queryFn: loadPendingReferral, staleTime: Infinity }); }
export function usePendingReferralActions() {
  const qc = useQueryClient();
  const save = useCallback(async (code: string, lookup?: Lookup) => { const c = normalizeCode(code); await savePendingReferral(c); if (lookup) qc.setQueryData(lookupKey(c), lookup); await qc.invalidateQueries({ queryKey: PENDING_KEY }); }, [qc]);
  const remove = useCallback(async () => { await clearPendingReferral(); await qc.invalidateQueries({ queryKey: PENDING_KEY }); }, [qc]);
  return { save, remove };
}
/** Who a code belongs to (GET /referral/lookup/:code); cached a minute, like the API's own cache header. */
export function useReferralLookup(code: string | null | undefined) {
  return useQuery({ queryKey: lookupKey(code ?? ""), queryFn: () => lookupReferralCode(code!), enabled: !!code, staleTime: 60_000, retry: 1 });
}

/** At startup (Linking.getInitialURL) and while running (the "url" event): remember ?ref=CODE from a kubrai.xyz link or
 *  a kubrai:// intent. The newest link wins; `onCaptured` fires only when the stored code actually changed. */
export function useReferralLinkCapture(onCaptured?: (code: string) => void) {
  const { save } = usePendingReferralActions();
  const cb = useRef(onCaptured); cb.current = onCaptured;
  useEffect(() => {
    let live = true;
    const take = async (url: string | null) => {
      const code = refFromUrl(url); if (!code || !live) return;
      try { if ((await loadPendingReferral()) === code) return; await save(code); if (live) cb.current?.(code); } catch (e) { recordError(e, "referral:capture"); }
    };
    Linking.getInitialURL().then(take).catch(() => {});
    const sub = Linking.addEventListener("url", (e) => { void take(e.url); });
    return () => { live = false; sub.remove(); };
  }, [save]);
}

/** Bind the wallet to the pending code: one signature in the wallet, then POST /referral/bind. Progress and the outcome
 *  go to `note` (one line each). Returns what happened to the stored code: "applied" / "dropped" (the API said the code
 *  can never apply to this wallet) / "kept" (declined, offline, or the API is not ready yet — retried after the next
 *  bet) / "none" (nothing pending). Never throws. */
export function useApplyInvite() {
  const { signMessage } = useMobileWallet(); const qc = useQueryClient();
  return useCallback(async (wallet: string, note: (n: InviteNote) => void): Promise<"applied" | "dropped" | "kept" | "none"> => {
    const code = await loadPendingReferral(); if (!code) return "none";
    note({ kind: "info", text: t("ref.signNote") });
    const lk = qc.getQueryData<Lookup>(lookupKey(code)); const pct = lk && lk.valid ? (lk.refereeBps / 100).toFixed(0) : "10";
    const drop = async () => { await clearPendingReferral(); await qc.invalidateQueries({ queryKey: PENDING_KEY }); };
    try {
      const r = await bindReferral(wallet, code, signMessage);
      if (r.ok) { await drop(); note({ kind: "ok", text: r.already ? t("app.ref.already") : t("ref.applied", { pct }) }); return "applied"; }
      if (r.permanent) { await drop(); note({ kind: "err", text: t("app.ref.failed", { err: r.error }) }); return "dropped"; }
      note({ kind: "err", text: t("app.ref.notYet", { err: r.error }) }); return "kept";
    } catch (e: any) {
      recordError(e, "referral:bind");
      const raw = String(e?.message ?? e), why = /Cancellation|declined|rejected/i.test(raw) ? t("app.ref.notSigned") : raw;
      note({ kind: "err", text: t("app.ref.notYet", { err: why }) }); return "kept";
    }
  }, [signMessage, qc]);
}
