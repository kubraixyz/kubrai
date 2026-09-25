import React from "react";
import { StyleSheet, View } from "react-native";
import { Text, useTheme } from "react-native-paper";
import type { MarketView } from "../chain/kubrai";
import { fmtTs, inWords, zoneLabel } from "../chain/format";
import { timelineSteps } from "../chain/timeline";

const GREEN = "#0f8f7c";
/** The market's life as a vertical timeline in the phone's own clock (see chain/timeline.ts for the rules). */
export function Timeline({ m, disputeWindowSecs }: { m: MarketView; disputeWindowSecs: number | null }) {
  const theme = useTheme();
  const steps = timelineSteps(m, disputeWindowSecs);
  return (
    <View>
      <Text variant="labelSmall" style={[styles.dim, { marginBottom: 6 }]}>Times in your zone ({zoneLabel()})</Text>
      {steps.map((s, i) => {
        const done = s.state === "done", next = s.state === "next", last = i === steps.length - 1;
        return (
          <View key={s.key} style={styles.row}>
            <View style={styles.rail}>
              <View style={[styles.dot, { borderColor: done || next ? GREEN : theme.colors.outlineVariant, backgroundColor: done ? GREEN : theme.colors.surface }]} />
              {!last && <View style={[styles.line, { backgroundColor: done ? GREEN : theme.colors.outlineVariant }]} />}
            </View>
            <View style={[styles.body, { opacity: s.state === "later" ? 0.65 : 1 }]}>
              <Text variant="titleSmall" style={{ fontWeight: s.state === "later" ? "500" : "700" }}>{s.label}</Text>
              <Text variant="bodySmall" style={[styles.mono, styles.dim]}>{s.estimate && !done ? "~ " : ""}{fmtTs(s.ts)}{next && inWords(s.ts) ? <Text style={{ color: GREEN, fontWeight: "700" }}>{"  " + inWords(s.ts)}</Text> : null}</Text>
              {s.note ? <Text variant="bodySmall" style={styles.dim}>{s.note}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  rail: { width: 14, alignItems: "center" },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, marginTop: 4 },
  line: { width: 2, flex: 1, marginVertical: 2 },
  body: { flex: 1, paddingBottom: 14, gap: 1 },
  dim: { opacity: 0.7 }, mono: { fontVariant: ["tabular-nums"] },
});
