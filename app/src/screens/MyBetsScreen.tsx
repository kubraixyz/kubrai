import React from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ActivityIndicator, Button, Chip, Text, useTheme } from "react-native-paper";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { useMarkets, usePositions } from "../hooks/useKubrai";
import { useAuthorization } from "../utils/useAuthorization";
import { useMobileWallet } from "../utils/useMobileWallet";
import { fetchSettled } from "../chain/api";
import { fmtValue } from "../chain/metrics";
import { bucketColor, bucketLabel, fmtAmt, fmtTs, question, statusLabel, timeLeft } from "../chain/format";
import { NO_OUTCOME, payoutIfBucket, totalPool, type MarketView } from "../chain/kubrai";
import { PoolBar } from "../components/PoolBar";
import { nextStepText } from "../chain/timeline";
import { explorerTxUrl } from "../chain/explorer";
import { useConfig } from "../hooks/useKubrai";
import { TOKEN_SYMBOL } from "../config";
import { t } from "../i18n";

const GREEN = "#0f8f7c", RED = "#c4553f";
function Big({ label, value, color, right }: { label: string; value: string; color?: string; right?: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: right ? "flex-end" : "flex-start" }}>
      <Text variant="labelSmall" style={styles.dim}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 5 }}>
        <Text style={[styles.bigNum, color ? { color } : null]}>{value}</Text>
        <Text variant="labelMedium" style={styles.dim}>{TOKEN_SYMBOL}</Text>
      </View>
    </View>
  );
}

export function MyBetsScreen() {
  const nav = useNavigation<any>(); const theme = useTheme();
  const { selectedAccount } = useAuthorization(); const { connect } = useMobileWallet();
  const markets = useMarkets(); const positions = usePositions(); const cfg = useConfig();
  const settled = useQuery({ queryKey: ["settled", selectedAccount?.publicKey.toBase58()], queryFn: () => fetchSettled(selectedAccount!.publicKey.toBase58()), enabled: !!selectedAccount, refetchInterval: 60_000 });

  if (!selectedAccount) return <View style={styles.center}><Text style={{ marginBottom: 12 }}>{t("pf.connect")}</Text><Button mode="contained" onPress={() => connect()}>{t("wallet.connect")}</Button></View>;

  const byKey = new Map((markets.data ?? []).map((m) => [m.pubkey.toBase58(), m]));
  const rows = (positions.data ?? []).map((p: any) => ({ p, m: byKey.get(p.market.toBase58()) })).filter((x: any) => x.m) as { p: any; m: MarketView }[];
  const card = (children: React.ReactNode, onPress?: () => void, key?: string) => (
    <Pressable key={key} onPress={onPress} style={({ pressed }) => [styles.card, { backgroundColor: theme.colors.elevation.level1, borderColor: pressed ? theme.colors.primary : theme.colors.outlineVariant }]}>{children}</Pressable>
  );

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text variant="headlineSmall">{t("nav.mybets")}</Text>
      <Text variant="bodySmall" style={[styles.dim, { marginBottom: 12 }]}>{t("app.mb.lead")}</Text>

      {positions.isLoading ? <ActivityIndicator /> : rows.length === 0 ? card(<Text style={styles.dim}>{t("pf.noOpen")}</Text>, () => nav.navigate("Markets"), "empty") : rows.map(({ p, m }) => {
        const feeBps = p.amounts.map((a: number, i: number) => (a ? Number(BigInt(p.feeW[i]) / BigInt(a)) : 0));
        const staked = p.amounts.reduce((x: number, y: number) => x + y, 0);
        const myBuckets = p.amounts.map((a: number, i: number) => ({ a, i })).filter((x: any) => x.a > 0);
        const w = m.status === 2 ? m.outcome : m.status === 1 ? m.proposedOutcome : NO_OUTCOME;
        // headline value: settled/proposed → the real payout; open → best case across the user's buckets
        let value = 0, valueLabel = t("pf.colWorth"), tone = theme.colors.onSurface, sub = "";
        if (m.status === 3) { value = staked; valueLabel = t("app.mb.refund"); sub = t("app.mb.voided"); }
        else if (w !== NO_OUTCOME) { const r = payoutIfBucket(m, p.amounts, feeBps, w); value = r.payout; valueLabel = m.status === 2 ? t("app.mb.payingOut") : t("app.mb.ifConfirmed"); tone = r.kind === "lost" ? RED : GREEN; sub = t(m.status === 2 ? "app.mb.result" : "app.mb.proposed", { b: bucketLabel(m, w) }); }
        else { const best = Math.max(...myBuckets.map((b: any) => payoutIfBucket(m, p.amounts, feeBps, b.i).payout)); value = best; valueLabel = myBuckets.length > 1 ? t("app.mb.bestCase") : t("app.mb.ifWins"); sub = `${timeLeft(m.closeTs)} · ${t("card.inPot", { amt: fmtAmt(totalPool(m) + m.seed, 0), tok: TOKEN_SYMBOL })}`; }
        return card(<>
          <View style={styles.row}><Chip compact mode="outlined">{statusLabel(m)}</Chip><Text variant="labelSmall" style={styles.dim}>#{m.id}</Text></View>
          <Text variant="titleMedium" style={{ marginTop: 6 }}>{question(m)}</Text>
          <View style={{ marginTop: 10 }}><PoolBar m={m} compact highlight={w !== NO_OUTCOME ? w : myBuckets.length === 1 ? myBuckets[0].i : -1} /></View>
          <View style={styles.chips}>{myBuckets.map((b: any) => <View key={b.i} style={[styles.chip, { borderColor: bucketColor(m, b.i) }]}><View style={[styles.dot, { backgroundColor: bucketColor(m, b.i) }]} /><Text variant="labelMedium">{bucketLabel(m, b.i)} · {fmtAmt(b.a)}</Text></View>)}</View>
          <View style={styles.nums}>
            <Big label={t("app.mb.staked")} value={fmtAmt(staked)} />
            <Big label={valueLabel} value={fmtAmt(value)} color={tone} right />
          </View>
          <Text variant="labelSmall" style={styles.dim}>{sub}</Text>
          <Text variant="labelSmall" style={styles.dim}>{nextStepText(m, cfg.data ? cfg.data.disputeWindowSecs.toNumber() : null)}</Text>
        </>, () => nav.navigate("Market", { id: m.id }), p.pubkey.toBase58());
      })}

      <Text variant="titleMedium" style={{ marginTop: 20, marginBottom: 8 }}>{t("pf.settled")}</Text>
      {settled.isLoading ? <ActivityIndicator /> : !settled.data?.length ? <Text style={styles.dim}>{t("pf.noSettled")}</Text> : settled.data.map((s: any) => {
        const m = byKey.get(s.market); const won = s.kind === "won", lost = s.kind === "lost";
        const staked = s.amounts.reduce((x: number, y: string) => x + Number(y), 0);
        return card(<>
          <View style={styles.row}>
            <View style={[styles.badge, { backgroundColor: won ? GREEN : lost ? RED : theme.colors.elevation.level3 }]}><Text variant="labelMedium" style={{ color: won || lost ? "#fff" : theme.colors.onSurface }}>{won ? t("app.mb.won") : lost ? t("app.mb.lost") : t("app.mb.refunded")}</Text></View>
            <Text variant="labelSmall" style={styles.dim}>#{s.id} · {fmtTs(Date.parse(s.at) / 1000)}</Text>
          </View>
          <Text variant="titleMedium" style={{ marginTop: 6 }}>{m ? question(m) : s.metric}</Text>
          <Text variant="bodySmall" style={[styles.dim, { marginTop: 2 }]}>{s.status === 3 ? t("app.mb.voided") : t("app.mb.resultObserved", { b: m ? bucketLabel(m, s.outcome) : t("app.mb.bucket", { n: s.outcome }), v: m ? fmtValue(m.metric, Number(s.observed), m.thresholds) : s.observed })}</Text>
          {/* resolved, and nobody was on the winning range: a refund needs its reason, as on the website */}
          {s.kind === "refund" && s.status !== 3 ? <Text variant="bodySmall" style={[styles.dim, { marginTop: 2 }]}>{t("pf.noWinner")}</Text> : null}
          <View style={styles.nums}>
            <Big label={t("app.mb.staked")} value={fmtAmt(staked)} />
            <Big label={t("app.mb.paid")} value={lost ? "0" : fmtAmt(Number(s.payout))} color={won ? GREEN : lost ? RED : undefined} right />
          </View>
          <Button compact style={{ alignSelf: "flex-start", marginTop: 4 }} onPress={() => Linking.openURL(explorerTxUrl(s.signature))}>{t("app.mb.viewTx")}</Button>
        </>, undefined, s.signature);
      })}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 48 }, center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, dim: { opacity: 0.7 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 }, row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }, chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }, dot: { width: 8, height: 8, borderRadius: 4 },
  nums: { flexDirection: "row", marginTop: 12, gap: 12 }, mono: { fontVariant: ["tabular-nums"], fontWeight: "600" },
  bigNum: { fontSize: 26, lineHeight: 32, fontWeight: "700", fontVariant: ["tabular-nums"], includeFontPadding: false }, badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
});
