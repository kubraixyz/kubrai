import React, { useEffect, useMemo, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text, useTheme } from "react-native-paper";
import { useMarkets } from "../hooks/useKubrai";
import { bucketColor } from "../chain/format";
import { dayChips, seriesOf } from "../chain/series";

/** The same question on its other days (chain/series.ts): one chip per day, oldest to newest, named by its day with how
 *  it ended. The day on screen is highlighted and kept in the middle of the row, so the day before it is always there to
 *  tap. Nothing is drawn for a question asked only once, or before the market list has loaded. `disabled` (a bet is on
 *  its way) keeps the row from switching days. */
export function DayStrip({ id, onPick, disabled = false }: { id: number; onPick: (id: number) => void; disabled?: boolean }) {
  const theme = useTheme(); const { data } = useMarkets();
  const list = useMemo(() => { const cur = data?.find((x) => x.id === id); return cur && data ? seriesOf(data, cur) : []; }, [data, id]);
  const chips = useMemo(() => dayChips(list), [list]);
  const row = useRef<ScrollView>(null), at = useRef(new Map<number, { x: number; w: number }>()), width = useRef(0), touched = useRef(false);
  const centre = (animated: boolean) => { const c = at.current.get(id); if (!c || !width.current) return; row.current?.scrollTo({ x: Math.max(0, c.x - (width.current - c.w) / 2), animated }); };
  // sizes arrive (or change) after the first draw: put the day back in the middle, unless the row is being scrolled by hand
  const settle = () => { if (!touched.current) centre(false); };
  useEffect(() => { touched.current = false; centre(true); }, [id]);   // another day was picked: glide to it
  if (list.length < 2) return null;
  const pending = theme.dark ? "#e8d48b" : "#6b5200";
  return (
    <ScrollView ref={row} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={[styles.row, disabled && { opacity: 0.5 }]} contentContainerStyle={styles.chips}
      onLayout={(e) => { width.current = e.nativeEvent.layout.width; settle(); }} onContentSizeChange={settle} onScrollBeginDrag={() => { touched.current = true; }}>
      {chips.map((c, i) => {
        const on = c.id === id;
        return (
          <Pressable key={c.id} disabled={on || disabled} onPress={() => onPick(c.id)} onLayout={(e) => { at.current.set(c.id, { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width }); if (on) settle(); }}
            accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${c.name}: ${[c.result, c.word].filter(Boolean).join(", ")}`}
            style={({ pressed }) => [styles.chip, on ? styles.chipOn : null, { backgroundColor: on ? theme.colors.primaryContainer : theme.colors.elevation.level1, borderColor: on || pressed ? theme.colors.primary : theme.colors.outlineVariant }]}>
            <View style={styles.line}>
              <Text style={[styles.name, { color: theme.colors.onSurface }]}>{c.name}</Text>
              {c.twin ? <Text style={[styles.small, { color: theme.colors.onSurfaceVariant }]}>#{c.id}</Text> : null}
            </View>
            <View style={styles.line}>
              {c.result != null ? (<>
                <View style={[styles.dot, { backgroundColor: bucketColor(list[i], c.outcome) }]} />
                <Text style={[styles.res, { color: theme.colors.onSurface }]}>{c.result}</Text>
                {c.word ? <Text style={[styles.small, { color: theme.colors.onSurfaceVariant }]}>· {c.word}</Text> : null}
              </>) : <Text style={[styles.res, c.state === "open" ? { color: theme.colors.primary, fontWeight: "700" } : { color: c.state === "voided" ? theme.colors.error : c.state === "awaiting" ? pending : theme.colors.onSurfaceVariant }]}>{c.word}</Text>}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
// Every text carries its own line height and no font padding: mixed sizes on one line otherwise get clipped on Android.
const styles = StyleSheet.create({
  row: { flexGrow: 0, marginBottom: 12 },
  chips: { gap: 6, paddingRight: 2 },
  chip: { minWidth: 84, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, gap: 1 },
  chipOn: { borderWidth: 2, paddingHorizontal: 11, paddingVertical: 5 },
  line: { flexDirection: "row", alignItems: "center", gap: 5 },
  name: { fontSize: 13, lineHeight: 18, fontWeight: "700", includeFontPadding: false },
  res: { fontSize: 12.5, lineHeight: 17, includeFontPadding: false },
  small: { fontSize: 11.5, lineHeight: 17, includeFontPadding: false },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
