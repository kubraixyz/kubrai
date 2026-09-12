import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
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
  async function faucet() {
    if (!selectedAccount) return; setBusy(true); setMsg("Requesting…");
    try { const j = await requestFaucet(selectedAccount.publicKey.toBase58()); setMsg(`Received ${j.tokens}${j.sol !== "already funded" ? ` and ${j.sol}` : ""}${j.genesisToken && j.genesisToken !== "failed" ? ` · ${j.genesisToken === "already held" ? "test Genesis Token already held" : "plus a test Genesis Token (−1% fee on devnet; on mainnet only a real Seeker’s token counts)"}` : ""}.`); invalidate(); }
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
      <Text variant="titleMedium">Feedback</Text>
      <Button mode="contained-tonal" icon="message-alert-outline" onPress={() => nav.navigate("Feedback")} style={{ alignSelf: "flex-start" }}>Send feedback with a screenshot</Button>
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">Network</Text>
      <Text>{APP.cluster}{IS_TEST ? " · test network, tokens have no value" : ""}</Text>
      <Text style={styles.dim}>RPC {APP.rpcUrl}</Text>
      <Text style={styles.dim}>Program {APP.programId}</Text>
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">About</Text>
      <Text>Kubrai runs parimutuel pools on Seeker-ecosystem numbers. Every market settles from hourly snapshots whose hash is on-chain, the winning range is derived on-chain from the observed value, and payouts are pushed to your wallet automatically after a 24 h dispute window.</Text>
      <Text style={styles.dim}>kubrai.xyz</Text>
      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium">Diagnostics</Text>
      <Text style={styles.dim}>app {Constants.expoConfig?.version} · insets t{insets.top} b{insets.bottom} · structuredClone {typeof (globalThis as any).structuredClone} · TextDecoder {typeof (globalThis as any).TextDecoder} · hermes {typeof (globalThis as any).HermesInternal === "object" ? "yes" : "no"} · shim errors {((globalThis as any).__polyfillErrors ?? []).length}</Text>
    </ScrollView>
  );
}
const styles = StyleSheet.create({ screen: { padding: 16, gap: 8 }, row: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }, dim: { opacity: 0.7 }, mono: { fontFamily: "monospace" } });
