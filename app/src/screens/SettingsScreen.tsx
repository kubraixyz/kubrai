import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Button, Divider, RadioButton, Text, TextInput, useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { useNavigation } from "@react-navigation/native";
import { useAuthorization } from "../utils/useAuthorization";
import { useMobileWallet } from "../utils/useMobileWallet";
import { useBalances, useInvalidateAll } from "../hooks/useKubrai";
import { useApplyInvite, usePendingReferral, usePendingReferralActions, useReferralLookup, type InviteNote } from "../hooks/useReferral";
import { requestFaucet } from "../chain/api";
import { isCode, lookupReferralCode, normalizeCode } from "../chain/referral";
import { fmtAmt, short } from "../chain/format";
import { APP, IS_TEST, TOKEN_SYMBOL } from "../config";
import { LANGS, PHONE_LANG, chooseLang, savedLang, t } from "../i18n";
import { InviteCard } from "../components/InviteCard";

const OK_GREEN = "#0f8f7c";
export function SettingsScreen() {
  const { selectedAccount } = useAuthorization(); const { connect, disconnect } = useMobileWallet(); const bal = useBalances(); const invalidate = useInvalidateAll();
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets(); const nav = useNavigation<any>(); const theme = useTheme();
  // Language: "auto" follows the phone. Picking one redraws the whole app in it (App.tsx) and keeps it on this phone.
  const [langPick, setLangPick] = useState<string | null>(null);
  useEffect(() => { savedLang().then((l) => setLangPick(l ?? "auto")); }, []);
  const phoneLangName = LANGS.find(([k]) => k === PHONE_LANG)?.[1] ?? "English";
  // Invite link (server/referrals.mjs): unlocked by the wallet's first bet; friends who bet through it earn you a share
  // of the fee on their winnings and get part of it back themselves. `refTick` re-reads it after a binding.
  const [ref, setRef] = useState<any>(null); const [refTick, setRefTick] = useState(0);
  useEffect(() => {
    if (!selectedAccount) { setRef(null); return; }
    const wallet = selectedAccount.publicKey.toBase58(); let live = true;
    (async () => {
      try {
        let r = await fetch(`${APP.apiBase}/referral/${wallet}`); let j = await r.json();
        if (r.ok && j.eligible && !j.code) { r = await fetch(`${APP.apiBase}/referral/code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet }) }); j = await r.json(); }
        if (live) setRef(r.ok ? j : { error: j.error ?? "unavailable" });
      } catch { if (live) setRef({ error: "unavailable" }); }
    })();
    return () => { live = false; };
  }, [selectedAccount?.publicKey.toBase58(), refTick]);
  // Invite code this phone arrived with (?ref= link) or typed below. It waits here and binds the wallet on its first bet
  // (hooks/useReferral); the market screen does that right after the bet lands.
  const pending = usePendingReferral(); const { save: savePending, remove: removePending } = usePendingReferralActions();
  const lookup = useReferralLookup(pending.data); const applyInvite = useApplyInvite();
  const [codeInput, setCodeInput] = useState(""); const [codeMsg, setCodeMsg] = useState<InviteNote | null>(null); const [codeBusy, setCodeBusy] = useState(false);
  // A wallet that is already bound has no use for a pending code: drop it, so the next bet does not ask for a signature.
  useEffect(() => { if (ref?.bound && pending.data) void removePending(); }, [ref?.bound?.code, pending.data]);
  const noteColor = (n: InviteNote) => (n.kind === "err" ? theme.colors.error : n.kind === "ok" ? OK_GREEN : undefined);
  const pct = (bps: unknown) => ((typeof bps === "number" ? bps : 1000) / 100).toFixed(0);
  async function saveCode() {
    const code = normalizeCode(codeInput);
    if (!isCode(code)) { setCodeMsg({ kind: "err", text: t("app.set.codeShape") }); return; }
    setCodeBusy(true); setCodeMsg(null);
    try {
      const j = await lookupReferralCode(code);
      if (!j.valid) { setCodeMsg({ kind: "err", text: t("app.set.unknownCode") }); return; }
      await savePending(code, j); setCodeInput("");
    } catch { await savePending(code); setCodeInput(""); setCodeMsg({ kind: "info", text: t("app.set.savedUnverified") }); }
    finally { setCodeBusy(false); }
  }
  async function applyNow() {
    if (!selectedAccount) return; setCodeBusy(true);
    try { await applyInvite(selectedAccount.publicKey.toBase58(), setCodeMsg); } finally { setCodeBusy(false); setRefTick((t) => t + 1); }
  }
  async function faucet() {
    if (!selectedAccount) return; setBusy(true); setMsg(t("app.set.requesting"));
    try {
      const j = await requestFaucet(selectedAccount.publicKey.toBase58());
      setMsg([t("app.set.received", { what: [j.tokens, j.sol !== "already funded" ? j.sol : ""].filter(Boolean).join(" + ") }),
        j.genesisToken && j.genesisToken !== "failed" ? t(j.genesisToken === "already held" ? "app.set.sgtHeld" : "app.set.sgtGot") : "",
        j.oreMiner === "registered" ? t("app.set.oreGot") : j.oreMiner === "already registered" ? t("app.set.oreHeld") : ""].filter(Boolean).join(" "));
      invalidate();
    }
    catch (e: any) { setMsg(e?.message ?? String(e)); } finally { setBusy(false); }
  }
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text variant="titleMedium">{t("lang.label")}</Text>
      {langPick && <RadioButton.Group value={langPick} onValueChange={(v) => { setLangPick(v); void chooseLang(v); }}>
        <RadioButton.Item label={t("app.set.langAuto", { lang: phoneLangName })} value="auto" mode="android" style={styles.radio} />
        {LANGS.map(([k, name]) => <RadioButton.Item key={k} label={name} value={k} mode="android" style={styles.radio} />)}
      </RadioButton.Group>}
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">{t("app.set.wallet")}</Text>
      {selectedAccount ? (<>
        <Text style={styles.mono}>{short(selectedAccount.publicKey.toBase58())}{selectedAccount.label ? ` · ${selectedAccount.label}` : ""}</Text>
        {bal.data && <Text>{fmtAmt(bal.data.token)} {TOKEN_SYMBOL} · {bal.data.sol.toFixed(4)} SOL</Text>}
        <View style={styles.row}>
          {IS_TEST && <Button mode="contained" loading={busy} disabled={busy} onPress={faucet}>{t("wallet.faucet")}</Button>}
          <Button mode="outlined" onPress={() => disconnect()}>{t("wallet.disconnect")}</Button>
        </View>
        {!!msg && <Text style={styles.dim}>{msg}</Text>}
      </>) : <Button mode="contained" onPress={() => connect()}>{t("wallet.connect")}</Button>}
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">{t("app.set.inviteCode")}</Text>
      {ref?.bound ? (
        <Text style={styles.dim}>{t("inv.joined", { code: ref.bound.code, who: ref.bound.referrer, pct: pct(ref.refereeBps) + "%" })}</Text>
      ) : pending.data ? (<>
        <Text style={styles.mono} selectable>{pending.data}</Text>
        <Text style={styles.dim}>{lookup.data ? (lookup.data.valid ? t("app.set.invitedBy", { who: lookup.data.referrer, pct: pct(lookup.data.refereeBps) }) : t("app.set.unknownCode")) : lookup.isError ? t("app.set.cantVerify") : t("app.set.checking")}</Text>
        <Text style={styles.dim}>{t("app.set.appliesFirst")}</Text>
        {ref && ref.eligible && !ref.firstBet && <Text style={styles.dim}>{t("app.set.tooLate")}</Text>}
        <View style={styles.row}>
          {selectedAccount && ref?.firstBet && lookup.data?.valid !== false && <Button mode="contained" loading={codeBusy} disabled={codeBusy} onPress={applyNow}>{t("app.set.applyNow")}</Button>}
          <Button mode="outlined" icon="close" disabled={codeBusy} onPress={async () => { await removePending(); setCodeMsg(null); }}>{t("app.common.remove")}</Button>
        </View>
        {codeMsg && <Text style={{ color: noteColor(codeMsg) }}>{codeMsg.text}</Text>}
      </>) : (<>
        <Text style={styles.dim}>{t("app.set.haveCode", { pct: pct(ref?.refereeBps) })}</Text>
        <View style={[styles.row, { alignItems: "center", marginTop: 0 }]}>
          <TextInput mode="outlined" dense autoCapitalize="characters" autoCorrect={false} value={codeInput} onChangeText={setCodeInput} placeholder={t("app.set.inviteCode")} style={{ flex: 1 }} onSubmitEditing={saveCode} />
          <Button mode="contained" loading={codeBusy} disabled={codeBusy || !codeInput.trim()} onPress={saveCode}>{t("app.common.save")}</Button>
        </View>
        {codeMsg && <Text style={{ color: noteColor(codeMsg) }}>{codeMsg.text}</Text>}
      </>)}
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">{t("inv.h1")}</Text>
      {/* the website's invite page: link, the four numbers, the next share, earnings, payouts, how it works and the shares by points */}
      <InviteCard data={ref} wallet={!!selectedAccount} loading={!!selectedAccount && !ref} />
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">{t("fb.button")}</Text>
      <Button mode="contained-tonal" icon="message-alert-outline" onPress={() => nav.navigate("Feedback")} style={{ alignSelf: "flex-start" }}>{t("app.set.feedbackBtn")}</Button>
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">{t("app.set.network")}</Text>
      <Text>{APP.cluster}{IS_TEST ? " · " + t("app.set.testnet") : ""}</Text>
      <Text style={styles.dim}>RPC {APP.rpcUrl}</Text>
      <Text style={styles.dim}>Program {APP.programId}</Text>
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">{t("app.set.about")}</Text>
      <Text>{t("app.set.aboutText")}</Text>
      <Text style={styles.dim}>kubrai.xyz</Text>
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">{t("app.set.diag")}</Text>
      <Text style={styles.dim}>app {Constants.expoConfig?.version} · insets t{insets.top} b{insets.bottom} · structuredClone {typeof (globalThis as any).structuredClone} · TextDecoder {typeof (globalThis as any).TextDecoder} · hermes {typeof (globalThis as any).HermesInternal === "object" ? "yes" : "no"} · shim errors {((globalThis as any).__polyfillErrors ?? []).length}</Text>
    </ScrollView>
  );
}
const styles = StyleSheet.create({ screen: { padding: 16, gap: 8 }, radio: { paddingVertical: 2, paddingHorizontal: 0 }, row: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }, dim: { opacity: 0.7 }, mono: { fontFamily: "monospace" } });
