import React from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import { totalPool, type MarketView } from "../chain/kubrai";
import { bucketColor, bucketLabel, fmtAmt } from "../chain/format";
import { TOKEN_SYMBOL } from "../config";

export function PoolBar({ m, compact = false, highlight = -1 }: { m: MarketView; compact?: boolean; highlight?: number }) {
  const tot = totalPool(m);
  return (
    <View>
      <View style={styles.bar}>{m.pools.map((p, i) => <View key={i} style={{ flex: tot ? Math.max(p, 1e-9) : 1, backgroundColor: bucketColor(m, i), opacity: highlight >= 0 && highlight !== i ? 0.35 : 1 }} />)}</View>
      {!compact && (
        <View style={styles.cells}>
          {m.pools.map((p, i) => (
            <View key={i} style={[styles.cell, { borderLeftColor: bucketColor(m, i) }, highlight === i && { borderWidth: 1.5, borderColor: bucketColor(m, i) }]}>
              <Text variant="labelSmall" style={styles.dim}>{bucketLabel(m, i)}</Text>
              <Text variant="titleMedium" style={styles.mono}>{fmtAmt(p, 0)} {TOKEN_SYMBOL}</Text>
              <Text variant="labelSmall" style={styles.dim}>{tot ? Math.round((p / tot) * 100) + "% of pool" : "no bets yet"}</Text>
            </View>
          ))}
        </View>
      )}
      {m.seed > 0 && !compact && <Text variant="bodySmall" style={[styles.dim, { marginTop: 6 }]}>+ {fmtAmt(m.seed, 0)} {TOKEN_SYMBOL} house prize added to the winning bucket, fee-free.</Text>}
    </View>
  );
}
const styles = StyleSheet.create({
  bar: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: "#8884" },
  cells: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  cell: { flexGrow: 1, flexBasis: "45%", borderLeftWidth: 4, borderRadius: 8, padding: 10, backgroundColor: "#8881" },
  dim: { opacity: 0.7 },
  mono: { fontVariant: ["tabular-nums"] },
});
