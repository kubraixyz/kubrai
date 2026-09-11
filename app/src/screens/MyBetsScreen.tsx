import React from "react";
import { ScrollView, StyleSheet, View, Linking } from "react-native";
import { ActivityIndicator, Button, Card, Text } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { useMarkets, usePositions } from "../hooks/useKubrai";
import { useAuthorization } from "../utils/useAuthorization";
import { useMobileWallet } from "../utils/useMobileWallet";
import { fetchSettled } from "../chain/api";
import { metricLabel } from "../chain/metrics";
import { bucketLabel, fmtAmt, fmtTs, statusLabel } from "../chain/format";
import { NO_OUTCOME, payoutIfBucket } from "../chain/kubrai";
import { APP, TOKEN_SYMBOL } from "../config";

export function MyBetsScreen() {
  const nav = useNavigation<any>(); const { selectedAccount } = useAuthorization(); const { connect } = useMobileWallet();
  const markets = useMarkets(); const positions = usePositions();
  const settled = useQuery({ queryKey: ["settled", selectedAccount?.publicKey.toBase58()], queryFn: () => fetchSettled(selectedAccount!.publicKey.toBase58()), enabled: !!selectedAccount, refetchInterval: 60_000 });
  if (!selectedAccount) return <View style={styles.center}><Text style={{ marginBottom: 12 }}>Connect a wallet to see your bets.</Text><Button mode="contained" onPress={() => connect()}>Connect wallet</Button></View>;
  const byKey = new Map((markets.data ?? []).map((m) => [m.pubkey.toBase58(), m]));
  const rows = (positions.data ?? []).map((p) => ({ p, m: byKey.get(p.market.toBase58()) })).filter((x) => x.m) as { p: any; m: any }[];
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text variant="headlineSmall" style={{ marginBottom: 8 }}>My bets</Text>
      {positions.isLoading ? <ActivityIndicator /> : rows.length === 0 ? <Text style={styles.dim}>No open bets yet.</Text> : rows.map(({ p, m }) => {
        const feeBps = p.amounts.map((a: number, i: number) => (a ? Number(BigInt(p.feeW[i].toString()) / BigInt(a)) : 0));
        const w = m.status === 2 ? m.outcome : m.status === 1 ? m.proposedOutcome : NO_OUTCOME;
        let value: string;
        if (m.status === 3) value = `refund ${fmtAmt(p.amounts.reduce((x: number, y: number) => x + y, 0))}`;
        else if (w !== NO_OUTCOME) { const r = payoutIfBucket(m, p.amounts, feeBps, w); value = r.kind === "lost" ? "0 (lost)" : `${fmtAmt(r.payout)} (${r.kind})`; }
        else value = p.amounts.map((a: number, i: number) => (a ? `${fmtAmt(payoutIfBucket(m, p.amounts, feeBps, i).payout)} if ${bucketLabel(m, i)}` : "")).filter(Boolean).join("\n");
        return (
          <Card key={p.pubkey.toBase58()} style={{ marginBottom: 10 }} onPress={() => nav.navigate("Market", { id: m.id })}>
            <Card.Title title={metricLabel(m.metric)} subtitle={`#${m.id} · ${statusLabel(m)} · closes ${fmtTs(m.closeTs)}`} />
            <Card.Content>
              <Text variant="bodyMedium">Your bets: {p.amounts.map((a: number, i: number) => (a ? `${bucketLabel(m, i)}: ${fmtAmt(a)}` : "")).filter(Boolean).join(" · ")} {TOKEN_SYMBOL}</Text>
              <Text variant="bodyMedium" style={{ marginTop: 4 }}>Now worth: {value} {TOKEN_SYMBOL}</Text>
            </Card.Content>
          </Card>
        );
      })}
      <Text variant="bodySmall" style={[styles.dim, { marginBottom: 16 }]}>Payouts are settled automatically after the dispute window; nothing to claim.</Text>
      <Text variant="titleMedium" style={{ marginBottom: 8 }}>Settled</Text>
      {settled.isLoading ? <ActivityIndicator /> : !settled.data?.length ? <Text style={styles.dim}>Nothing settled yet.</Text> : settled.data.map((s: any) => {
        const m = byKey.get(s.market);
        return (
          <Card key={s.signature} style={{ marginBottom: 10 }}>
            <Card.Title title={m ? metricLabel(m.metric) : s.metric} subtitle={`#${s.id} · ${fmtTs(Date.parse(s.at) / 1000)}`} />
            <Card.Content>
              <Text>Outcome: {s.status === 3 ? "Voided" : m ? bucketLabel(m, s.outcome) : `bucket ${s.outcome}`}</Text>
              <Text style={{ fontWeight: "600", color: s.kind === "won" ? "#0f8f7c" : s.kind === "lost" ? "#c4553f" : undefined }}>{s.kind === "lost" ? "Lost" : s.kind === "refund" ? "Refunded" : "Won"} · {s.kind === "lost" ? "0" : fmtAmt(Number(s.payout))} {TOKEN_SYMBOL}</Text>
              <Button compact onPress={() => Linking.openURL(`https://explorer.solana.com/tx/${s.signature}?cluster=${APP.cluster === "mainnet" ? "mainnet-beta" : "devnet"}`)}>View transaction</Button>
            </Card.Content>
          </Card>
        );
      })}
    </ScrollView>
  );
}
const styles = StyleSheet.create({ screen: { padding: 16, paddingBottom: 48 }, center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, dim: { opacity: 0.7 } });
