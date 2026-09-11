import React from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ActivityIndicator, Button, Chip, Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { useMarkets, usePositions } from "../hooks/useKubrai";
import { useAuthorization } from "../utils/useAuthorization";
import { useMobileWallet } from "../utils/useMobileWallet";
import { fetchSettled } from "../chain/api";
import { metricLabel, fmtValue } from "../chain/metrics";
import { bucketColor, bucketLabel, fmtAmt, fmtTs, statusLabel, timeLeft } from "../chain/format";
import { NO_OUTCOME, payoutIfBucket, totalPool, type MarketView } from "../chain/kubrai";
import { PoolBar } from "../components/PoolBar";
import { APP, TOKEN_SYMBOL } from "../config";

const GREEN = "#0f8f7c", RED = "#c4553f";

export function MyBetsScreen() {
  const nav = useNavigation<any>(); const theme = useTheme();
  const { selectedAccount } = useAuthorization(); const { connect } = useMobileWallet();
  const markets = useMarkets(); const positions = usePositions();
  const settled = useQuery({ queryKey: ["settled", selectedAccount?.publicKey.toBase58()], queryFn: () => fetchSettled(selectedAccount!.publicKey.toBase58()), enabled: !!selectedAccount, refetchInterval: 60_000 });

  if (!selectedAccount) return <View style={styles.center}><Text style={{ marginBottom: 12 }}>Connect a wallet to see your bets.</Text><Button mode="contained" onPress={() => connect()}>Connect wallet</Button></View>;

  const byKey = new Map((markets.data ?? []).map((m) => [m.pubkey.toBase58(), m]));
  const rows = (positions.data ?? []).map((p: any) => ({ p, m: byKey.get(p.market.toBase58()) })).filter((x: any) => x.m) as { p: any; m: MarketView }[];
  const card = (children: React.ReactNode, onPress?: () => void, key?: string) => (
    <Pressable key={key} onPress={onPress} style={({ pressed }) => [styles.card, { backgroundColor: theme.colors.elevation.level1, borderColor: pressed ? theme.colors.primary : theme.colors.outlineVariant }]}>{children}</Pressable>
  );
  const title = (m: MarketView) => (m.nBuckets === 2 ? `${metricLabel(m.metric)} ≥ ${fmtValue(m.metric, m.thresholds[0])}?` : `${metricLabel(m.metric)}: which range?`);

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text variant="headlineSmall">My bets</Text>
      <Text variant="bodySmall" style={[styles.dim, { marginBottom: 12 }]}>Open positions update live. Payouts arrive in your wallet automatically after the dispute window; nothing to claim.</Text>

      {positions.isLoading ? <ActivityIndicator /> : rows.length === 0 ? card(<Text style={styles.dim}>No open bets yet. Pick a market and place one.</Text>, () => nav.navigate("Markets"), "empty") : rows.map(({ p, m }) => {
        const feeBps = p.amounts.map((a: number, i: number) => (a ? Number(BigInt(p.feeW[i]) / BigInt(a)) : 0));
        const staked = p.amounts.reduce((x: number, y: number) => x + y, 0);
        const myBuckets = p.amounts.map((a: number, i: number) => ({ a, i })).filter((x: any) => x.a > 0);
        const w = m.status === 2 ? m.outcome : m.status === 1 ? m.proposedOutcome : NO_OUTCOME;
        // headline value: settled/proposed → the real payout; open → best case across the user's buckets
        let value = 0, valueLabel = "Now worth", tone = theme.colors.onSurface, sub = "";
        if (m.status === 3) { value = staked; valueLabel = "Refund"; sub = "Market voided"; }
        else if (w !== NO_OUTCOME) { const r = payoutIfBucket(m, p.amounts, feeBps, w); value = r.payout; valueLabel = m.status === 2 ? "Paying out" : "If confirmed"; tone = r.kind === "lost" ? RED : GREEN; sub = `${m.status === 2 ? "Result" : "Proposed"}: ${bucketLabel(m, w)}`; }
        else { const best = Math.max(...myBuckets.map((b: any) => payoutIfBucket(m, p.amounts, feeBps, b.i).payout)); value = best; valueLabel = myBuckets.length > 1 ? "Best case" : "If it wins"; sub = `${timeLeft(m.closeTs)} · ${fmtAmt(totalPool(m) + m.seed, 0)} ${TOKEN_SYMBOL} in pot`; }
        return card(<>
          <View style={styles.row}><Chip compact mode="outlined">{statusLabel(m)}</Chip><Text variant="labelSmall" style={styles.dim}>#{m.id}</Text></View>
          <Text variant="titleMedium" style={{ marginTop: 6 }}>{title(m)}</Text>
          <View style={{ marginTop: 10 }}><PoolBar m={m} compact highlight={w !== NO_OUTCOME ? w : myBuckets.length === 1 ? myBuckets[0].i : -1} /></View>
          <View style={styles.chips}>{myBuckets.map((b: any) => <View key={b.i} style={[styles.chip, { borderColor: bucketColor(m, b.i) }]}><View style={[styles.dot, { backgroundColor: bucketColor(m, b.i) }]} /><Text variant="labelMedium">{bucketLabel(m, b.i)} · {fmtAmt(b.a)}</Text></View>)}</View>
          <View style={styles.nums}>
            <View style={{ flex: 1 }}><Text variant="labelSmall" style={styles.dim}>You staked</Text><Text variant="headlineSmall" style={styles.mono}>{fmtAmt(staked)} <Text variant="labelMedium" style={styles.dim}>{TOKEN_SYMBOL}</Text></Text></View>
            <View style={{ flex: 1, alignItems: "flex-end" }}><Text variant="labelSmall" style={styles.dim}>{valueLabel}</Text><Text variant="headlineSmall" style={[styles.mono, { color: tone }]}>{fmtAmt(value)} <Text variant="labelMedium" style={styles.dim}>{TOKEN_SYMBOL}</Text></Text></View>
          </View>
          <Text variant="labelSmall" style={styles.dim}>{sub}</Text>
        </>, () => nav.navigate("Market", { id: m.id }), p.pubkey.toBase58());
      })}

      <Text variant="titleMedium" style={{ marginTop: 20, marginBottom: 8 }}>Settled</Text>
      {settled.isLoading ? <ActivityIndicator /> : !settled.data?.length ? <Text style={styles.dim}>Nothing settled yet.</Text> : settled.data.map((s: any) => {
        const m = byKey.get(s.market); const won = s.kind === "won", lost = s.kind === "lost";
        const staked = s.amounts.reduce((x: number, y: string) => x + Number(y), 0);
        return card(<>
          <View style={styles.row}>
            <View style={[styles.badge, { backgroundColor: won ? GREEN : lost ? RED : theme.colors.elevation.level3 }]}><Text variant="labelMedium" style={{ color: won || lost ? "#fff" : theme.colors.onSurface }}>{won ? "WON" : lost ? "LOST" : "REFUNDED"}</Text></View>
            <Text variant="labelSmall" style={styles.dim}>#{s.id} · {fmtTs(Date.parse(s.at) / 1000)}</Text>
          </View>
          <Text variant="titleMedium" style={{ marginTop: 6 }}>{m ? title(m) : s.metric}</Text>
          <Text variant="bodySmall" style={[styles.dim, { marginTop: 2 }]}>{s.status === 3 ? "Market voided" : `Result: ${m ? bucketLabel(m, s.outcome) : "bucket " + s.outcome} · observed ${m ? fmtValue(m.metric, Number(s.observed)) : s.observed}`}</Text>
          <View style={styles.nums}>
            <View style={{ flex: 1 }}><Text variant="labelSmall" style={styles.dim}>You staked</Text><Text variant="headlineSmall" style={styles.mono}>{fmtAmt(staked)} <Text variant="labelMedium" style={styles.dim}>{TOKEN_SYMBOL}</Text></Text></View>
            <View style={{ flex: 1, alignItems: "flex-end" }}><Text variant="labelSmall" style={styles.dim}>Paid to you</Text><Text variant="headlineSmall" style={[styles.mono, { color: won ? GREEN : lost ? RED : theme.colors.onSurface }]}>{lost ? "0" : fmtAmt(Number(s.payout))} <Text variant="labelMedium" style={styles.dim}>{TOKEN_SYMBOL}</Text></Text></View>
          </View>
          <Button compact style={{ alignSelf: "flex-start", marginTop: 4 }} onPress={() => Linking.openURL(`https://explorer.solana.com/tx/${s.signature}?cluster=${APP.cluster === "mainnet" ? "mainnet-beta" : "devnet"}`)}>View transaction</Button>
        </>, undefined, s.signature);
      })}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 48 }, center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, dim: { opacity: 0.7 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 }, row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }, chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }, dot: { width: 8, height: 8, borderRadius: 4 },
  nums: { flexDirection: "row", marginTop: 12, gap: 12 }, mono: { fontVariant: ["tabular-nums"], fontWeight: "600" }, badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
});
