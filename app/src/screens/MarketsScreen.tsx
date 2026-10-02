import React, { useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View, RefreshControl } from "react-native";
import { ActivityIndicator, Chip, Text, useTheme } from "react-native-paper";
import MaterialCommunityIcon from "@expo/vector-icons/MaterialCommunityIcons";
import { useNavigation } from "@react-navigation/native";
import { useMarkets } from "../hooks/useKubrai";
import { metricCategory, CATEGORY_ORDER, catalogEntry, metricInfo, metricLabel, fmtExact } from "../chain/metrics";
import { PoolBar } from "../components/PoolBar";
import { fmtAmt, fmtTsShort, statusLabel, timeLeft } from "../chain/format";
import { totalPool, type MarketView } from "../chain/kubrai";
import { IS_TEST, TOKEN_SYMBOL } from "../config";
import { recordError } from "../utils/errorLog";

// Search, as on the web home: every word typed has to begin a word ("ore" finds ORE, not "Store") in what a card says
// (its title, the app, the category), the market's number ("#139") or its metric id.
const catName = (c: string) => (c === "Chain" ? "Solana" : c);
function searchText(m: MarketView) {
  const base = m.metric.replace(/_(next|today|day|week|dmed|wmed|med7)$/, ""), c = metricCategory(m.metric);
  return [`#${m.id}`, metricLabel(m.metric), catalogEntry(base)?.app ?? "", c, catName(c), base].join(" ").toLowerCase();
}

const finder = (w: string) => { if (!/^[a-z0-9]/.test(w)) return (h: string) => h.includes(w); const re = new RegExp("(?:^|[^a-z0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); return (h: string) => re.test(h); };

export function MarketsScreen() {
  const nav = useNavigation<any>(); const theme = useTheme();
  const { data, isLoading, refetch, isRefetching, error } = useMarkets();
  React.useEffect(() => { if (error) recordError(error, "markets"); }, [error]);
  // Same split as the web home: open for bets / closed and waiting / result proposed / settled.
  type Stage = "open" | "awaiting" | "proposed" | "settled";
  const [stage, setStage] = useState<Stage>("open");
  const now = Date.now() / 1000;
  const stageOf = (m: MarketView): Stage => (m.status === 0 ? (now < m.closeTs ? "open" : "awaiting") : m.status === 1 ? "proposed" : "settled");
  const all = data ?? [];
  // A query looks across every category of the selected stage: the stage counts become match counts and the category
  // row makes way for a result line. The blurb steps aside too, so the matches have room above the keyboard.
  const [q, setQ] = useState(""); const [focused, setFocused] = useState(false); const input = useRef<TextInput>(null);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean), searching = words.length > 0;
  const texts = useMemo(() => new Map((data ?? []).map((m) => [m.id, searchText(m)])), [data]);
  const finders = words.map(finder);
  const found = (list: MarketView[]) => (searching ? list.filter((m) => { const h = texts.get(m.id) ?? ""; return finders.every((f) => f(h)); }) : list);
  const hits = found(all); const count = (k: Stage) => hits.filter((m) => stageOf(m) === k).length;
  const [cat, setCat] = useState("");
  const inStage = all.filter((m) => stageOf(m) === stage);
  const cats = CATEGORY_ORDER.filter((c) => inStage.some((m) => metricCategory(m.metric) === c)).concat([...new Set(inStage.map((m) => metricCategory(m.metric)))].filter((c) => !CATEGORY_ORDER.includes(c)));
  const curCat = cats.includes(cat) ? cat : cats[0] ?? "";
  const live = (searching ? found(inStage) : inStage.filter((m) => metricCategory(m.metric) === curCat)).sort((a, b) => (stage === "settled" ? b.closeTs - a.closeTs || b.id - a.id : a.closeTs - b.closeTs || a.id - b.id));
  const STAGES: [Stage, string][] = [["open", "Open"], ["awaiting", "Awaiting result"], ["proposed", "Proposed"], ["settled", "Settled"]];
  const elsewhere = searching && live.length === 0 ? STAGES.filter(([k]) => k !== stage && count(k) > 0) : [];
  const EMPTY: Record<Stage, string> = { open: "No market is open for bets right now; new ones open daily at 11:00 UTC (" + fmtTsShort(Math.floor(now / 86400) * 86400 + (now % 86400 < 39600 ? 39600 : 126000)).replace(/^\S+ \S+, /, "") + " your time).", awaiting: "No market is waiting for its result.", proposed: "No result is under dispute review right now.", settled: "Nothing has settled yet." };
  const when = (m: MarketView) => (stage === "open" ? timeLeft(m.closeTs) : stage === "awaiting" ? `closed ${fmtTsShort(m.closeTs)} · result soon` : stage === "proposed" ? `proposed ${fmtTsShort(m.proposedAt)}` : `closed ${fmtTsShort(m.closeTs)}`);
  const highlight = (m: MarketView) => (m.status === 2 || m.status === 4 ? m.outcome : m.status === 1 ? m.proposedOutcome : -1);
  const card = ({ item: m }: { item: MarketView }) => {
    const info = metricInfo(m.metric);
    return (
      <Pressable onPress={() => nav.navigate("Market", { id: m.id })} style={({ pressed }) => [styles.card, { backgroundColor: theme.colors.elevation.level1, borderColor: pressed ? theme.colors.primary : theme.colors.outlineVariant }]}>
        <Text variant="labelSmall" style={styles.dim}>{/_next$/.test(m.metric) ? "tomorrow" : /_(week|wmed)$/.test(m.metric) ? "weekly" : "daily"} · {when(m)}</Text>
        <Text variant="titleMedium" style={{ marginVertical: 6 }}>{m.nBuckets === 2 ? `${metricLabel(m.metric)} ≥ ${fmtExact(m.metric, m.thresholds[0])}?` : `${metricLabel(m.metric)}: which range?`}</Text>
        <View style={{ marginTop: 8 }}><PoolBar m={m} compact highlight={highlight(m)} /></View>
        <Text variant="labelSmall" style={[styles.dim, { marginTop: 6 }]}>{m.positions} bettors · {fmtAmt(totalPool(m) + m.seed, 0)} {TOKEN_SYMBOL} in pot</Text>
      </Pressable>
    );
  };
  return (
    <View style={styles.screen}>
      {IS_TEST && <View style={styles.testnet}><Text variant="labelSmall" style={{ color: "#6b5200" }}>TEST NETWORK · devnet · tokens have no value</Text></View>}
      <View style={styles.head}>
        <Text variant="headlineSmall">Markets</Text>
        <Pressable accessible={false} onPress={() => input.current?.focus()} style={[styles.search, { backgroundColor: theme.colors.elevation.level1, borderColor: focused ? theme.colors.primary : theme.colors.outlineVariant }]}>
          <MaterialCommunityIcon name="magnify" size={18} color={theme.colors.onSurfaceVariant} />
          <TextInput ref={input} value={q} onChangeText={setQ} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholder="Search Jupiter, ORE…" placeholderTextColor={theme.colors.onSurfaceVariant} selectionColor={theme.colors.primary} style={[styles.searchInput, { color: theme.colors.onSurface }]} autoCapitalize="none" autoCorrect={false} returnKeyType="search" maxLength={60} accessibilityLabel="Search markets" />
          {q.length > 0 && <Pressable onPress={() => setQ("")} hitSlop={10} accessibilityLabel="Clear search"><MaterialCommunityIcon name="close-circle" size={18} color={theme.colors.onSurfaceVariant} /></Pressable>}
        </Pressable>
      </View>
      {!searching && <Text variant="bodySmall" style={[styles.dim, { marginBottom: 10 }]}>Prediction pools on the apps in the Solana dApp Store. Pick a range and stake SKR; winners split the losing pools. The fee is 3% of winnings only.</Text>}
      <View style={{ height: 44, marginBottom: 12 }}><ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, alignItems: "center", paddingRight: 8 }}>
        {STAGES.map(([k, label]) => {
          const on = k === stage;
          return (
            <Pressable key={k} onPress={() => setStage(k)} style={[styles.stageBtn, { backgroundColor: on ? theme.colors.primary : theme.colors.elevation.level2, borderColor: on ? theme.colors.primary : theme.colors.outlineVariant }]}>
              <Text variant="labelLarge" style={{ color: on ? theme.colors.onPrimary : theme.colors.onSurface }}>{label}</Text>
              <View style={[styles.stageCount, { backgroundColor: on ? "rgba(255,255,255,.25)" : theme.colors.elevation.level4 }]}><Text variant="labelSmall" style={{ color: on ? theme.colors.onPrimary : theme.colors.onSurface, includeFontPadding: false }}>{count(k)}</Text></View>
            </Pressable>
          );
        })}
      </ScrollView></View>
      {/* a search with nothing to show says where the matches are (or that every market was checked), never a bare empty list */}
      {searching && !isLoading && !error && <View style={styles.found}>
        <Text variant="bodyMedium" style={[styles.dim, { flexShrink: 1 }]}>{live.length > 0 ? `${live.length} of ${inStage.length} match “${q.trim()}”` : elsewhere.length > 0 ? `Nothing under “${STAGES.find(([k]) => k === stage)![1]}” matches “${q.trim()}”. Found under:` : `No market matches “${q.trim()}”; all ${all.length} were checked.`}</Text>
        {elsewhere.map(([k, label]) => (
          <Pressable key={k} onPress={() => setStage(k)} style={[styles.catBtn, { borderColor: theme.colors.outlineVariant }]}>
            <Text variant="labelLarge" style={{ color: theme.colors.onSurface }}>{label}</Text><Text variant="labelSmall" style={styles.dim}>{count(k)}</Text>
          </Pressable>))}
      </View>}
      {!searching && cats.length > 0 && <View style={{ height: 40, marginBottom: 10 }}><ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, alignItems: "center", paddingRight: 8 }}>
        {cats.map((c) => { const on = c === curCat; return (
          <Pressable key={c} onPress={() => setCat(c)} style={[styles.catBtn, { backgroundColor: on ? theme.colors.secondaryContainer : "transparent", borderColor: on ? theme.colors.secondary : theme.colors.outlineVariant }]}>
            <Text variant="labelLarge" style={{ color: theme.colors.onSurface }}>{catName(c)}</Text><Text variant="labelSmall" style={styles.dim}>{inStage.filter((m) => metricCategory(m.metric) === c).length}</Text>
          </Pressable>); })}
      </ScrollView></View>}
      {isLoading ? <ActivityIndicator /> : error ? <View><Text>Could not load markets: {String((error as any)?.message ?? error)}</Text><Text variant="labelSmall" style={[styles.dim, { fontFamily: "monospace", marginTop: 6 }]} selectable>{String((error as any)?.stack ?? "").split("\n").slice(0, 6).join("\n")}</Text></View> :
        <FlatList data={live} keyExtractor={(m) => String(m.id)} renderItem={card} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />} ListEmptyComponent={searching ? null : <Text style={styles.dim}>{EMPTY[stage]}</Text>} contentContainerStyle={{ gap: 12, paddingBottom: 24 }} />}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  dim: { opacity: 0.7 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 6 },
  search: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, height: 40, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12 },
  searchInput: { flex: 1, minWidth: 0, alignSelf: "stretch", fontSize: 15, paddingVertical: 0, textAlignVertical: "center" },
  found: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, minHeight: 40, marginBottom: 10 },
  testnet: { backgroundColor: "#fff3c4", padding: 6, borderRadius: 6, alignItems: "center", marginBottom: 10 },
  stageBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, height: 38, paddingHorizontal: 14 },
  catBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, height: 34, paddingHorizontal: 12 },
  stageCount: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, minWidth: 22, alignItems: "center" },
});
