import React, { useState } from "react";
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { ActivityIndicator, Chip, SegmentedButtons, Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { useAuthorization } from "../utils/useAuthorization";
import { fmtTsShort, short } from "../chain/format";
import { APP, TOKEN_SYMBOL } from "../config";

type Entry = { rank: number; wallet: string; points: number; markets: number; won: number; lastAt: string; test?: boolean };
const fmtPoints = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e4 ? (v / 1e3).toFixed(1) + "k" : v.toLocaleString("en-US", { maximumFractionDigits: 0 }));
async function fetchBoard(win: string) {
  const r = await fetch(`${APP.apiBase}/leaderboard?window=${win}&limit=100`); if (!r.ok) throw new Error("leaderboard " + r.status);
  return (await r.json()) as { totals: { players: number; markets: number; points: number }; entries: Entry[] };
}

/** Points = SKR staked in markets that paid out, every range counted, won or lost (server/points.mjs). */
export function LeaderboardScreen() {
  const theme = useTheme(); const { selectedAccount } = useAuthorization();
  const [win, setWin] = useState("all");
  const q = useQuery({ queryKey: ["leaderboard", win], queryFn: () => fetchBoard(win), refetchInterval: 60_000 });
  const me = selectedAccount?.publicKey.toBase58() ?? null;
  const rows = q.data?.entries ?? [], mine = me ? rows.find((e) => e.wallet === me) : null;
  const explorer = (w: string) => Linking.openURL(`https://explorer.solana.com/address/${w}?cluster=${APP.cluster === "mainnet" ? "mainnet-beta" : "devnet"}`);
  return (
    <ScrollView contentContainerStyle={styles.screen} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}>
      <Text variant="headlineSmall">Leaderboard</Text>
      <Text variant="bodySmall" style={[styles.dim, { marginBottom: 10 }]}>One point per {TOKEN_SYMBOL} staked in a market that paid out. Every range you bet counts, won or lost; voided markets score nothing.</Text>
      <SegmentedButtons value={win} onValueChange={setWin} density="small" buttons={[{ value: "all", label: "All time" }, { value: "30d", label: "30 days" }, { value: "7d", label: "7 days" }]} style={{ marginBottom: 12 }} />
      {q.data && (
        <View style={styles.stats}>
          {[["Players", String(q.data.totals.players)], ["Settled", String(q.data.totals.markets)], ["Points", fmtPoints(q.data.totals.points)]].map(([k, v]) => (
            <View key={k} style={[styles.stat, { backgroundColor: theme.colors.elevation.level2 }]}><Text style={styles.statNum}>{v}</Text><Text variant="labelSmall" style={styles.dim}>{k}</Text></View>
          ))}
        </View>
      )}
      <View style={[styles.me, { backgroundColor: theme.colors.elevation.level1, borderColor: theme.colors.outlineVariant }]}>
        <Text variant="bodySmall">{!me ? "Connect a wallet to see your own rank." : mine ? `You are #${mine.rank} with ${fmtPoints(mine.points)} points · ${mine.won} of ${mine.markets} markets won.` : "Your wallet has no settled market in this window yet. Points arrive when a market you bet on pays out."}</Text>
      </View>
      {q.isLoading ? <ActivityIndicator /> : q.error ? <Text style={styles.dim}>The leaderboard is unavailable right now.</Text> : rows.length === 0 ? <Text style={styles.dim}>No market has settled in this window yet.</Text> : rows.map((e) => (
        <View key={e.wallet} style={[styles.row, { borderColor: theme.colors.outlineVariant, backgroundColor: e.wallet === me ? theme.colors.primaryContainer : "transparent" }]}>
          <Text style={[styles.rank, styles.dim]}>{e.rank}</Text>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Text style={styles.mono} onPress={() => explorer(e.wallet)}>{short(e.wallet)}</Text>
              {e.wallet === me && <Text variant="labelSmall" style={{ fontWeight: "700" }}>you</Text>}
              {e.test && <Chip compact mode="outlined" textStyle={{ fontSize: 10, lineHeight: 12 }} style={{ height: 22 }}>Kubrai test bot</Chip>}
            </View>
            <Text variant="labelSmall" style={styles.dim}>{e.won} / {e.markets} won · last {fmtTsShort(Date.parse(e.lastAt) / 1000)}</Text>
          </View>
          <Text style={styles.points}>{fmtPoints(e.points)}</Text>
        </View>
      ))}
      <Text variant="labelSmall" style={[styles.dim, { marginTop: 10 }]}>Wallets marked “Kubrai test bot” are ours: they keep the devnet pools moving and are not players.</Text>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 48 }, dim: { opacity: 0.7 }, mono: { fontFamily: "monospace", fontSize: 13 },
  stats: { flexDirection: "row", gap: 8, marginBottom: 10 }, stat: { flex: 1, borderRadius: 8, padding: 10 }, statNum: { fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"], includeFontPadding: false, lineHeight: 26 },
  me: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 6, borderBottomWidth: 1, borderRadius: 6 },
  rank: { width: 26, textAlign: "right", fontVariant: ["tabular-nums"] }, points: { fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
