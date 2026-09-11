import React from "react";
import { FlatList, Pressable, StyleSheet, View, RefreshControl } from "react-native";
import { ActivityIndicator, Chip, Text, useTheme } from "react-native-paper";
import { useNavigation } from "@react-navigation/native";
import { useMarkets } from "../hooks/useKubrai";
import { metricInfo, metricLabel, fmtValue } from "../chain/metrics";
import { PoolBar } from "../components/PoolBar";
import { fmtAmt, statusLabel, timeLeft } from "../chain/format";
import { totalPool, type MarketView } from "../chain/kubrai";
import { IS_TEST, TOKEN_SYMBOL } from "../config";
import { recordError } from "../utils/errorLog";

export function MarketsScreen() {
  const nav = useNavigation<any>(); const theme = useTheme();
  const { data, isLoading, refetch, isRefetching, error } = useMarkets();
  React.useEffect(() => { if (error) recordError(error, "markets"); }, [error]);
  const live = (data ?? []).filter((m) => m.status === 0 || m.status === 1);
  const card = ({ item: m }: { item: MarketView }) => {
    const info = metricInfo(m.metric);
    return (
      <Pressable onPress={() => nav.navigate("Market", { id: m.id })} style={({ pressed }) => [styles.card, { backgroundColor: theme.colors.elevation.level1, borderColor: pressed ? theme.colors.primary : theme.colors.outlineVariant }]}>
        <View style={styles.row}><Chip compact mode="outlined">{statusLabel(m)}</Chip><Text variant="labelSmall" style={styles.dim}>#{m.id} · {m.status === 0 ? timeLeft(m.closeTs) : ""}</Text></View>
        <Text variant="titleMedium" style={{ marginVertical: 6 }}>{m.nBuckets === 2 ? `${metricLabel(m.metric)} ≥ ${fmtValue(m.metric, m.thresholds[0])}?` : `${metricLabel(m.metric)}: which range?`}</Text>
        <View style={styles.row}><Chip compact>{{ onchain: "on-chain", store: "store data", thirdparty: "3rd-party data" }[info?.source ?? "thirdparty"]}</Chip>{info?.cumulative ? <Text variant="labelSmall" style={styles.dim}>from {fmtValue(m.metric, m.baseline)} at open</Text> : null}</View>
        <View style={{ marginTop: 8 }}><PoolBar m={m} compact /></View>
        <Text variant="labelSmall" style={[styles.dim, { marginTop: 6 }]}>{m.positions} bettors · {fmtAmt(totalPool(m) + m.seed, 0)} {TOKEN_SYMBOL} in pot</Text>
      </Pressable>
    );
  };
  return (
    <View style={styles.screen}>
      {IS_TEST && <View style={styles.testnet}><Text variant="labelSmall" style={{ color: "#6b5200" }}>TEST NETWORK · devnet · tokens have no value</Text></View>}
      <Text variant="headlineSmall" style={{ marginBottom: 4 }}>This week's markets</Text>
      <Text variant="bodySmall" style={[styles.dim, { marginBottom: 12 }]}>Parimutuel pools on the numbers that describe the Seeker ecosystem. Winners split the losing pools; the fee is 3% of winnings only.</Text>
      {isLoading ? <ActivityIndicator /> : error ? <View><Text>Could not load markets: {String((error as any)?.message ?? error)}</Text><Text variant="labelSmall" style={[styles.dim, { fontFamily: "monospace", marginTop: 6 }]} selectable>{String((error as any)?.stack ?? "").split("\n").slice(0, 6).join("\n")}</Text></View> :
        <FlatList data={live} keyExtractor={(m) => String(m.id)} renderItem={card} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />} ListEmptyComponent={<Text style={styles.dim}>No open markets right now.</Text>} contentContainerStyle={{ gap: 12, paddingBottom: 24 }} />}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  dim: { opacity: 0.7 },
  testnet: { backgroundColor: "#fff3c4", padding: 6, borderRadius: 6, alignItems: "center", marginBottom: 10 },
});
