import React from "react";
import { View, StyleSheet } from "react-native";
import { totalPool, type MarketView } from "../chain/kubrai";
import { bucketColor } from "../chain/format";
import { usePalette } from "./palette";

/** One thin bar of the pools, each range as wide as its share (My bets cards). The range that won, or the one bet on,
 *  stays bright. The market list and the market screen draw the website's rows and cells instead (MarketParts). */
export function PoolBar({ m, highlight = -1 }: { m: MarketView; compact?: boolean; highlight?: number }) {
  const p = usePalette(); const tot = totalPool(m);
  return (
    <View style={[styles.bar, { backgroundColor: p.surface2 }]}>{m.pools.map((pool, i) => <View key={i} style={{ flex: tot ? Math.max(pool, 1e-9) : 1, backgroundColor: bucketColor(m, i, p.dark), opacity: highlight >= 0 && highlight !== i ? 0.35 : 1 }} />)}</View>
  );
}
const styles = StyleSheet.create({ bar: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden" } });
