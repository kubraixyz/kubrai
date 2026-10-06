import React, { useState } from "react";
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { ActivityIndicator, SegmentedButtons, Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { useAuthorization } from "../utils/useAuthorization";
import { fmtTsShort, short } from "../chain/format";
import { explorerAddressUrl } from "../chain/explorer";
import { APP, TOKEN_SYMBOL } from "../config";
import { t } from "../i18n";

type Entry = { rank: number; wallet: string; points: number; markets: number; won: number; lastAt: string; test?: boolean };
const fmtPoints = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e4 ? (v / 1e3).toFixed(1) + "k" : v.toLocaleString("en-US", { maximumFractionDigits: 0 }));
async function fetchBoard(win: string) {
  const r = await fetch(`${APP.apiBase}/leaderboard?window=${win}&limit=100`); if (!r.ok) throw new Error("leaderboard " + r.status);
  return (await r.json()) as { totals: { players: number; markets: number; points: number; testWallets?: number }; entries: Entry[] };
}

/** Points = SKR staked in markets that paid out, every range counted, won or lost (server/points.mjs). */
export function LeaderboardScreen() {
  const theme = useTheme(); const { selectedAccount } = useAuthorization();
  const [win, setWin] = useState("all");
  const q = useQuery({ queryKey: ["leaderboard", win], queryFn: () => fetchBoard(win), refetchInterval: 60_000 });
  const me = selectedAccount?.publicKey.toBase58() ?? null;
  const rows = q.data?.entries ?? [], mine = me ? rows.find((e) => e.wallet === me) : null;
  const explorer = (w: string) => Linking.openURL(explorerAddressUrl(w));
  return (
    <ScrollView contentContainerStyle={styles.screen} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}>
      <Text variant="headlineSmall">{t("nav.leaderboard")}</Text>
      <Text variant="bodySmall" style={[styles.dim, { marginBottom: 10 }]}>{t("lb.lead")}</Text>
      <SegmentedButtons value={win} onValueChange={setWin} density="small" buttons={[{ value: "all", label: t("app.lb.all") }, { value: "30d", label: t("app.lb.30d") }, { value: "7d", label: t("app.lb.7d") }]} style={{ marginBottom: 12 }} />
      {q.data && (
        <View style={styles.stats}>
          {[[t("lb.players"), String(q.data.totals.players)], [t("lb.settled"), String(q.data.totals.markets)], [t("lb.awarded"), fmtPoints(q.data.totals.points)]].map(([k, v]) => (
            <View key={k} style={[styles.stat, { backgroundColor: theme.colors.elevation.level2 }]}><Text style={styles.statNum}>{v}</Text><Text variant="labelSmall" style={styles.dim}>{k}</Text>
              {/* players are people: the test bots are listed below but not counted, as the website says beside the count */}
              {k === t("lb.players") && Number(q.data!.totals.testWallets) > 0 ? <Text variant="labelSmall" style={styles.dim}>{t("lb.plusBots", { n: Number(q.data!.totals.testWallets) })}</Text> : null}
            </View>
          ))}
        </View>
      )}
      <View style={[styles.me, { backgroundColor: theme.colors.elevation.level1, borderColor: theme.colors.outlineVariant }]}>
        <Text variant="bodySmall">{!me ? t("lb.connect") : mine ? t("lb.me", { rank: "#" + mine.rank, pts: fmtPoints(mine.points), won: mine.won, n: mine.markets }) : t("lb.meNone")}</Text>
      </View>
      {q.isLoading ? <ActivityIndicator /> : q.error ? <Text style={styles.dim}>{t("lb.err")}</Text> : rows.length === 0 ? <Text style={styles.dim}>{t("lb.empty")}</Text> : rows.map((e) => (
        <View key={e.wallet} style={[styles.row, { borderColor: theme.colors.outlineVariant, backgroundColor: e.wallet === me ? theme.colors.primaryContainer : "transparent" }]}>
          <Text style={[styles.rank, styles.dim]}>{e.rank}</Text>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Text style={styles.mono} onPress={() => explorer(e.wallet)}>{short(e.wallet)}</Text>
              {e.wallet === me && <Text variant="labelSmall" style={{ fontWeight: "700" }}>{t("lb.you")}</Text>}
              {e.test && <View style={[styles.tag, { borderColor: theme.colors.outline }]}><Text style={[styles.tagText, styles.dim]}>{t("lb.test")}</Text></View>}
            </View>
            <Text variant="labelSmall" style={styles.dim}>{t("app.lb.row", { won: e.won, n: e.markets, ts: fmtTsShort(Date.parse(e.lastAt) / 1000) })}</Text>
          </View>
          <Text style={styles.points}>{fmtPoints(e.points)}</Text>
        </View>
      ))}
      <Text variant="labelSmall" style={[styles.dim, { marginTop: 10 }]}>{t("lb.how", { tok: TOKEN_SYMBOL })}</Text>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 48 }, dim: { opacity: 0.7 }, mono: { fontFamily: "monospace", fontSize: 13 },
  stats: { flexDirection: "row", gap: 8, marginBottom: 10 }, stat: { flex: 1, borderRadius: 8, padding: 10 }, statNum: { fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"], includeFontPadding: false, lineHeight: 26 },
  me: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 10 },
  tag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }, tagText: { fontSize: 11, lineHeight: 15, includeFontPadding: false },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 6, borderBottomWidth: 1, borderRadius: 6 },
  rank: { width: 26, textAlign: "right", fontVariant: ["tabular-nums"] }, points: { fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
