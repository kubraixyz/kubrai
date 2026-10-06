import React, { useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ActivityIndicator } from "react-native-paper";
import MaterialCommunityIcon from "@expo/vector-icons/MaterialCommunityIcons";
import { useNavigation } from "@react-navigation/native";
import { useMarkets } from "../hooks/useKubrai";
import { metricCategory, CATEGORY_ORDER, catalogEntry, metricLabel } from "../chain/metrics";
import { fmtAmt, fmtTsShort, inWords, question, timeLeft } from "../chain/format";
import { timelineSteps } from "../chain/timeline";
import { totalPool, type MarketView } from "../chain/kubrai";
import { APP, IS_TEST, TOKEN_SYMBOL } from "../config";
import { recordError } from "../utils/errorLog";
import { t } from "../i18n";
import { OptionRows } from "../components/MarketParts";
import { usePalette } from "../components/palette";

// The website's home page (web/src/main.ts) on a phone: heading, lead, search, the four stages as two rows of two, the
// categories, then one card per market: when it closes, the question, a row per range with its share of the pool, the
// pot and the bettors. Same words, same order, same rules.
type Stage = "open" | "awaiting" | "proposed" | "settled";
const STAGES: Stage[] = ["open", "awaiting", "proposed", "settled"];
const stageOf = (m: MarketView, now: number): Stage => (m.status === 0 ? (now < m.closeTs ? "open" : "awaiting") : m.status === 1 ? "proposed" : "settled");
const catLabel = (c: string) => (t("cat." + c) === "cat." + c ? c : t("cat." + c));
// Search: every word typed has to begin a word ("ore" finds ORE, not "Store") in what a card says (its question, the app,
// the category), the market's number ("#139") or its metric id; case, accents and full-width forms aside. A word in a
// script written without spaces is found anywhere.
const fold = (s: string) => { try { return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").normalize("NFKC").toLowerCase(); } catch { return s.toLowerCase(); } };
function hay(m: MarketView) {
  const base = m.metric.replace(/_(next|today|day|week|dmed|wmed|med7)$/, ""), c = metricCategory(m.metric);
  return fold([`#${m.id}`, question(m).replace(/\u00a0/g, " ").replace(/\u2060/g, ""), metricLabel(m.metric), catalogEntry(base)?.app ?? "", c, catLabel(c), base].join(" "));
}
const finder = (w: string) => { if (!/^[a-z0-9]/.test(w)) return (h: string) => h.includes(w); const re = new RegExp("(?:^|[^a-z0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); return (h: string) => re.test(h); };

export function MarketsScreen() {
  const nav = useNavigation<any>(); const p = usePalette();
  const { data, isLoading, refetch, isRefetching, error } = useMarkets();
  React.useEffect(() => { if (error) recordError(error, "markets"); }, [error]);
  const [stage, setStage] = useState<Stage>("open");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState(""); const [focused, setFocused] = useState(false);
  const list = useRef<FlatList<MarketView>>(null), searchY = useRef(0);
  const now = Date.now() / 1000;
  const all = data ?? [];
  const hays = useMemo(() => new Map(all.map((m) => [m.id, hay(m)])), [data]);
  const words = fold(q).split(/\s+/).filter(Boolean), searching = words.length > 0, finders = words.map(finder);
  const found = (l: MarketView[]) => (searching ? l.filter((m) => { const h = hays.get(m.id) ?? ""; return finders.every((f) => f(h)); }) : l);
  const hits = found(all); const count = (k: Stage) => hits.filter((m) => stageOf(m, now) === k).length;   // with a search running the tabs count its matches
  // open / awaiting / proposed: soonest close first; settled: most recent first
  const inStage = all.filter((m) => stageOf(m, now) === stage).sort((a, b) => (stage === "settled" ? b.closeTs - a.closeTs || b.id - a.id : a.closeTs - b.closeTs || a.id - b.id));
  const cats = CATEGORY_ORDER.filter((c) => inStage.some((m) => metricCategory(m.metric) === c)).concat([...new Set(inStage.map((m) => metricCategory(m.metric)))].filter((c) => !CATEGORY_ORDER.includes(c)));
  const curCat = cats.includes(cat) ? cat : cats[0] ?? "";
  const items = searching ? found(inStage) : inStage.filter((m) => metricCategory(m.metric) === curCat);
  const elsewhere = searching && items.length === 0 ? STAGES.filter((k) => k !== stage && count(k) > 0) : [];

  // past its betting window a card says when the result is due (the timeline's estimate); "soon" only once it is due
  const closedWhen = (m: MarketView) => { const ps = timelineSteps(m, null).find((s) => s.key === "propose"); return ps && ps.ts > now ? t("card.closedResult", { ts: fmtTsShort(m.closeTs), in: `${ps.estimate ? "~ " : ""}${inWords(ps.ts)}` }) : t("card.closedSoon", { ts: fmtTsShort(m.closeTs) }); };
  const when = (m: MarketView) => (m.status === 0 && now < m.closeTs ? timeLeft(m.closeTs) : m.status === 0 ? closedWhen(m) : m.status === 1 ? t("card.proposed", { ts: fmtTsShort(m.proposedAt) }) : t("card.closed", { ts: fmtTsShort(m.closeTs) }));
  const card = ({ item: m }: { item: MarketView }) => (
    <Pressable onPress={() => nav.navigate("Market", { id: m.id })} style={({ pressed }) => [s.card, { backgroundColor: p.surface, borderColor: pressed ? p.accent : p.line }]}>
      <Text style={[s.meta, { color: p.dim }]}>{when(m)}</Text>
      <Text style={[s.title, { color: p.fg }]}>{question(m)}</Text>
      <OptionRows m={m} highlight={m.status === 2 || m.status === 4 ? m.outcome : m.status === 1 ? m.proposedOutcome : -1} />
      <View style={s.metaRow}><Text style={[s.meta, { color: p.dim }]}>{t("card.inPot", { amt: fmtAmt(totalPool(m), 0), tok: TOKEN_SYMBOL })}</Text><Text style={[s.meta, { color: p.dim }]}>{t("card.bettors", { n: m.positions })}</Text></View>
    </Pressable>
  );

  const tab = (k: Stage) => {
    const on = k === stage;
    return (
      <Pressable key={k} onPress={() => setStage(k)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[s.tab, { borderBottomColor: on ? p.accent : p.line }]}>
        <Text style={[s.tabText, { color: on ? p.fg : p.dim }]}>{t("stage." + k)}<Text style={[s.tabCount, { color: p.dim }]}>{"  " + count(k)}</Text></Text>
      </Pressable>
    );
  };
  // An element, not a component: the list keeps the same search box (and its keyboard) across every redraw.
  const header = (
    <View>
      {IS_TEST && <View style={[s.testnet, { backgroundColor: p.warnBg }]}><Text style={[s.testnetText, { color: p.warnFg }]}>{t("net.test", { net: APP.cluster })}</Text></View>}
      <Text style={[s.h1, { color: p.fg }]}>{t("home.h1")}</Text>
      <Text style={[s.lead, { color: p.dim }]}>{t("home.lead")}</Text>
      {/* on a phone the keyboard takes half the screen: the box goes to the top so the matches show under it while typing */}
      <View onLayout={(e) => { searchY.current = e.nativeEvent.layout.y; }} style={[s.search, { backgroundColor: p.surface, borderColor: focused ? p.accent : p.line }]}>
        <MaterialCommunityIcon name="magnify" size={18} color={p.dim} />
        <TextInput value={q} onChangeText={(v) => setQ(v.slice(0, 60))} onFocus={() => { setFocused(true); setTimeout(() => list.current?.scrollToOffset({ offset: Math.max(0, searchY.current - 8), animated: true }), 250); }} onBlur={() => setFocused(false)}
          placeholder={t("search.ph")} placeholderTextColor={p.dim} selectionColor={p.accent} style={[s.searchInput, { color: p.fg }]} autoCapitalize="none" autoCorrect={false} returnKeyType="search" accessibilityLabel={t("search.aria")} />
        {q.length > 0 && <Pressable onPress={() => setQ("")} hitSlop={10} accessibilityLabel={t("search.clear")}><MaterialCommunityIcon name="close-circle" size={18} color={p.dim} /></Pressable>}
      </View>
      <View style={s.tabs}><View style={s.tabRow}>{tab("open")}{tab("awaiting")}</View><View style={s.tabRow}>{tab("proposed")}{tab("settled")}</View></View>
      {/* a search with nothing to show says where the matches are (or that every market was checked), never a bare empty list */}
      {searching ? (!isLoading && !error && (
        <View style={s.found}>
          <Text style={[s.foundText, { color: p.dim }]}>{items.length ? t("search.count", { n: items.length, total: inStage.length, q: q.trim() }) : elsewhere.length ? `${t("search.noneHere", { stage: t("stage." + stage), q: q.trim() })} ${t("search.elsewhere")}` : t("search.none", { q: q.trim(), total: all.length })}</Text>
          {elsewhere.map((k) => (
            <Pressable key={k} onPress={() => setStage(k)} style={[s.chip, s.foundBtn, { backgroundColor: p.surface, borderColor: p.line }]}>
              <Text style={[s.chipText, { color: p.fg, fontSize: 13 }]}>{t("stage." + k)}<Text style={[s.chipCount, { color: p.dim }]}>{"  " + count(k)}</Text></Text>
            </Pressable>))}
        </View>))
      : cats.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.chipsRow} contentContainerStyle={s.chips}>
          {cats.map((c) => { const on = c === curCat; return (
            <Pressable key={c} onPress={() => setCat(c)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[s.chip, { backgroundColor: on ? p.accent : p.surface, borderColor: on ? p.accent : p.line }]}>
              <Text style={[s.chipText, { color: on ? "#fff" : p.fg }]}>{catLabel(c)}<Text style={[s.chipCount, { color: on ? "rgba(255,255,255,.8)" : p.dim }]}>{"  " + inStage.filter((m) => metricCategory(m.metric) === c).length}</Text></Text>
            </Pressable>); })}
        </ScrollView>)}
      {!searching && stage === "open" && items.length > 0 && <Text style={[s.note, { color: p.dim, marginBottom: 12 }]}>{t("group.dayBlurb")}</Text>}
      {isLoading && <ActivityIndicator style={{ marginVertical: 24 }} />}
      {!!error && !data && <View style={[s.msg, { backgroundColor: p.noBg }]}><Text style={{ color: p.fg }}>{t("err.markets", { err: String((error as any)?.message ?? error) })}</Text></View>}
    </View>
  );
  const footer = (
    <Text style={[s.note, { color: p.dim, marginTop: 20 }]}>{t("home.footer")} {t("footer.times")} · <Text style={{ color: p.accent }} onPress={() => nav.navigate("Feedback")}>{t("fb.button")}</Text></Text>
  );
  return (
    <FlatList ref={list} data={isLoading ? [] : items} keyExtractor={(m) => String(m.id)} renderItem={card} ListHeaderComponent={header} ListFooterComponent={footer}
      ListEmptyComponent={isLoading || searching || (!!error && !data) ? null : <Text style={[s.note, { color: p.dim, fontSize: 14 }]}>{t("empty." + stage)}</Text>}
      keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      style={{ backgroundColor: p.bg }} contentContainerStyle={s.screen} ItemSeparatorComponent={Gap} />
  );
}
const Gap = () => <View style={{ height: 12 }} />;
const s = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 32 },
  testnet: { alignSelf: "flex-start", borderRadius: 4, paddingVertical: 5, paddingHorizontal: 10, marginBottom: 14 },
  testnetText: { fontSize: 12, lineHeight: 16, letterSpacing: 0.36 },
  h1: { fontSize: 22, lineHeight: 28, fontWeight: "700", marginBottom: 6 },
  lead: { fontSize: 15, lineHeight: 22, marginBottom: 20 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, height: 42, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, marginBottom: 6 },
  searchInput: { flex: 1, minWidth: 0, alignSelf: "stretch", fontSize: 16, paddingVertical: 0, textAlignVertical: "center" },
  tabs: { marginBottom: 14 },
  tabRow: { flexDirection: "row", gap: 12 },
  tab: { flex: 1, paddingVertical: 9, paddingHorizontal: 2, borderBottomWidth: 2 },
  tabText: { fontSize: 15, lineHeight: 21, fontWeight: "500" },
  tabCount: { fontSize: 12.5, fontWeight: "400" },
  chipsRow: { flexGrow: 0, marginBottom: 16 },
  chips: { gap: 8, paddingRight: 8 },
  chip: { borderRadius: 999, borderWidth: 1, paddingVertical: 7, paddingHorizontal: 14 },
  chipText: { fontSize: 14, lineHeight: 20 },
  chipCount: { fontSize: 12 },
  found: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, minHeight: 39, marginBottom: 16 },
  foundText: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
  foundBtn: { paddingVertical: 5, paddingHorizontal: 12 },
  note: { fontSize: 12.5, lineHeight: 18 },
  msg: { borderRadius: 6, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12 },
  card: { borderWidth: 1, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, gap: 8 },
  title: { fontSize: 15.5, lineHeight: 20, fontWeight: "600" },
  meta: { fontSize: 12.5, lineHeight: 17 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
});
