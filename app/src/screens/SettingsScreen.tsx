import React, { useEffect, useState } from "react";
import { ScrollView, Share, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Button, Divider, Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { useNavigation } from "@react-navigation/native";
import { useAuthorization } from "../utils/useAuthorization";
import { useMobileWallet } from "../utils/useMobileWallet";
import { useBalances, useInvalidateAll } from "../hooks/useKubrai";
import { requestFaucet } from "../chain/api";
import { fmtAmt, short } from "../chain/format";
import { APP, IS_TEST, TOKEN_SYMBOL } from "../config";

export function SettingsScreen() {
  const { selectedAccount } = useAuthorization(); const { connect, disconnect } = useMobileWallet(); const bal = useBalances(); const invalidate = useInvalidateAll();
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets(); const nav = useNavigation<any>();
  // Invite link (server/referrals.mjs): unlocked by the wallet's first bet; friends who bet through it earn you a share
  // of the fee on their winnings and get part of it back themselves.
  const [ref, setRef] = useState<any>(null); const [refMsg, setRefMsg] = useState("");
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
  }, [selectedAccount?.publicKey.toBase58()]);
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
