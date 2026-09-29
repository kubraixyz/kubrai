import React, { useEffect, useState } from "react";
import { ScrollView, Share, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Button, Divider, Text, TextInput, useTheme } from "react-native-paper";
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

const OK_GREEN = "#0f8f7c";
export function SettingsScreen() {
  const { selectedAccount } = useAuthorization(); const { connect, disconnect } = useMobileWallet(); const bal = useBalances(); const invalidate = useInvalidateAll();
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets(); const nav = useNavigation<any>(); const theme = useTheme();
  // Invite link (server/referrals.mjs): unlocked by the wallet's first bet; friends who bet through it earn you a share
  // of the fee on their winnings and get part of it back themselves. `refTick` re-reads it after a binding.
  const [ref, setRef] = useState<any>(null); const [refMsg, setRefMsg] = useState(""); const [refTick, setRefTick] = useState(0);
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
    if (!isCode(code)) { setCodeMsg({ kind: "err", text: "A code is 4–12 letters or digits." }); return; }
    setCodeBusy(true); setCodeMsg(null);
    try {
      const j = await lookupReferralCode(code);
      if (!j.valid) { setCodeMsg({ kind: "err", text: "Unknown code — check the spelling, or ask your friend for a fresh link." }); return; }
      await savePending(code, j); setCodeInput("");
    } catch { await savePending(code); setCodeInput(""); setCodeMsg({ kind: "info", text: "Saved. The code could not be verified right now; it is checked again when it is applied." }); }
    finally { setCodeBusy(false); }
  }
  async function applyNow() {
    if (!selectedAccount) return; setCodeBusy(true);
    try { await applyInvite(selectedAccount.publicKey.toBase58(), setCodeMsg); } finally { setCodeBusy(false); setRefTick((t) => t + 1); }
  }
  async function faucet() {
    if (!selectedAccount) return; setBusy(true); setMsg("Requesting…");
    try { const j = await requestFaucet(selectedAccount.publicKey.toBase58()); setMsg(`Received ${j.tokens}${j.sol !== "already funded" ? ` and ${j.sol}` : ""}${j.genesisToken && j.genesisToken !== "failed" ? ` · ${j.genesisToken === "already held" ? "test Genesis Token already held" : "plus a test Genesis Token (−1% fee on devnet; on mainnet only a real Seeker’s token counts)"}` : ""}${j.oreMiner === "registered" ? " · registered as a test ORE miner (−1% fee on devnet; on mainnet only a real ORE Miner account counts)" : j.oreMiner === "already registered" ? " · test ORE miner already registered" : ""}.`); invalidate(); }
    catch (e: any) { setMsg(e?.message ?? String(e)); } finally { setBusy(false); }
  }
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text variant="titleMedium">Wallet</Text>
      {selectedAccount ? (<>
        <Text style={styles.mono}>{short(selectedAccount.publicKey.toBase58())}{selectedAccount.label ? ` · ${selectedAccount.label}` : ""}</Text>
        {bal.data && <Text>{fmtAmt(bal.data.token)} {TOKEN_SYMBOL} · {bal.data.sol.toFixed(4)} SOL</Text>}
        <View style={styles.row}>
          {IS_TEST && <Button mode="contained" loading={busy} disabled={busy} onPress={faucet}>Get test tokens</Button>}
          <Button mode="outlined" onPress={() => disconnect()}>Disconnect</Button>
        </View>
        {!!msg && <Text style={styles.dim}>{msg}</Text>}
      </>) : <Button mode="contained" onPress={() => connect()}>Connect wallet</Button>}
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">Invite code</Text>
      {ref?.bound ? (
        <Text style={styles.dim}>You joined through {ref.bound.code} · invited by {ref.bound.referrer} · {pct(ref.refereeBps)}% of the fee on every win comes back to you.</Text>
      ) : pending.data ? (<>
        <Text style={styles.mono} selectable>{pending.data}</Text>
        <Text style={styles.dim}>{lookup.data ? (lookup.data.valid ? `Invited by ${lookup.data.referrer} · you get ${pct(lookup.data.refereeBps)}% of every fee back` : "Unknown code — check the spelling, or ask your friend for a fresh link.") : lookup.isError ? "Could not verify the code right now." : "Checking the code…"}</Text>
        <Text style={styles.dim}>It applies with this wallet's first bet: right after the bet lands the app asks for one extra signature — it costs nothing and moves no funds.</Text>
        {ref && ref.eligible && !ref.firstBet && <Text style={styles.dim}>This wallet already has settled bets, so an invite can no longer apply to it; the code is kept for a fresh wallet.</Text>}
        <View style={styles.row}>
          {selectedAccount && ref?.firstBet && lookup.data?.valid !== false && <Button mode="contained" loading={codeBusy} disabled={codeBusy} onPress={applyNow}>Apply invite now</Button>}
          <Button mode="outlined" icon="close" disabled={codeBusy} onPress={async () => { await removePending(); setCodeMsg(null); }}>Remove</Button>
        </View>
        {codeMsg && <Text style={{ color: noteColor(codeMsg) }}>{codeMsg.text}</Text>}
      </>) : (<>
        <Text style={styles.dim}>Have an invite code? Enter it before your first bet and {pct(ref?.refereeBps)}% of the fee on every win comes back to you.</Text>
        <View style={[styles.row, { alignItems: "center", marginTop: 0 }]}>
          <TextInput mode="outlined" dense autoCapitalize="characters" autoCorrect={false} value={codeInput} onChangeText={setCodeInput} placeholder="Invite code" style={{ flex: 1 }} onSubmitEditing={saveCode} />
          <Button mode="contained" loading={codeBusy} disabled={codeBusy || !codeInput.trim()} onPress={saveCode}>Save</Button>
        </View>
        {codeMsg && <Text style={{ color: noteColor(codeMsg) }}>{codeMsg.text}</Text>}
      </>)}
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">Invite friends</Text>
      {!selectedAccount ? <Text style={styles.dim}>Connect a wallet to get your invite link.</Text> : !ref ? <Text style={styles.dim}>Loading…</Text> : ref.error ? <Text style={styles.dim}>{ref.error}</Text> : !ref.link ? <Text style={styles.dim}>Place one bet to unlock your invite link.</Text> : (<>
        <Text style={styles.mono} selectable>{ref.link}</Text>
        <Text style={styles.dim}>Invited {ref.referred} · your share {(ref.tierBps / 100).toFixed(0)}% of invitees' fees · earned {Number(ref.earned).toLocaleString("en-US", { maximumFractionDigits: 2 })} {TOKEN_SYMBOL} (paid {Number(ref.paid).toLocaleString("en-US", { maximumFractionDigits: 2 })}){ref.bound ? ` · you joined through ${ref.bound.code}` : ""}</Text>
        <View style={styles.row}>
          <Button mode="contained" icon="share-variant" onPress={() => Share.share({ message: `Bet on Seeker's dApps with me on Kubrai — join through my link and get 10% of the fee on your winnings back: ${ref.link}` }).catch(() => {})}>Share link</Button>
          <Button mode="outlined" icon="content-copy" onPress={async () => { try { await Clipboard.setStringAsync(ref.link); setRefMsg("Copied"); } catch { setRefMsg(ref.link); } setTimeout(() => setRefMsg(""), 2000); }}>Copy</Button>
        </View>
        {!!refMsg && <Text style={styles.dim}>{refMsg}</Text>}
        <Text style={styles.dim}>Friends who bet through your link get 10% of the fee on every win back; you earn 20% of it, rising to 30% as your points grow. Paid every Monday in {TOKEN_SYMBOL}.</Text>
      </>)}
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">Feedback</Text>
      <Button mode="contained-tonal" icon="message-alert-outline" onPress={() => nav.navigate("Feedback")} style={{ alignSelf: "flex-start" }}>Send feedback with a screenshot</Button>
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">Network</Text>
      <Text>{APP.cluster}{IS_TEST ? " · test network, tokens have no value" : ""}</Text>
      <Text style={styles.dim}>RPC {APP.rpcUrl}</Text>
      <Text style={styles.dim}>Program {APP.programId}</Text>
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">About</Text>
      <Text>Kubrai runs parimutuel pools on the numbers of the apps in the Solana dApp Store (fees, revenue, volume, staking) and the Seeker itself. Every market settles from hourly snapshots whose hash is on-chain, the winning range is derived on-chain from the observed value, and payouts are pushed to your wallet automatically after a 6 h dispute window. Every time in the app is shown in your own time zone.</Text>
      <Text style={styles.dim}>kubrai.xyz</Text>
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">Diagnostics</Text>
      <Text style={styles.dim}>app {Constants.expoConfig?.version} · insets t{insets.top} b{insets.bottom} · structuredClone {typeof (globalThis as any).structuredClone} · TextDecoder {typeof (globalThis as any).TextDecoder} · hermes {typeof (globalThis as any).HermesInternal === "object" ? "yes" : "no"} · shim errors {((globalThis as any).__polyfillErrors ?? []).length}</Text>
    </ScrollView>
  );
}
const styles = StyleSheet.create({ screen: { padding: 16, gap: 8 }, row: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }, dim: { opacity: 0.7 }, mono: { fontFamily: "monospace" } });
