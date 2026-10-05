// Pieces of the website's market list and market page (web/src/main.ts, market.ts, ui.ts, timeline.ts and styles.css),
// drawn the same way here: the option rows of a card, the pools, the status pill and the timeline grid.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { totalPool, type MarketView } from "../chain/kubrai";
import { bucketColor, bucketLabel, fmtAmt, statusKind, statusLabel } from "../chain/format";
import { fmtStamp, inWords } from "../chain/time";
import { timelineSteps } from "../chain/timeline";
import { t } from "../i18n";
import { TOKEN_SYMBOL } from "../config";
import { MONO, usePalette } from "./palette";

/** A card's ranges, one row each: the label, a fill as wide as the range's share of the pool, the share. The range that
 *  won (or was proposed) is outlined. (.orows) */
export function OptionRows({ m, highlight = -1 }: { m: MarketView; highlight?: number }) {
  const p = usePalette(); const tot = totalPool(m);
  return (
    <View style={{ gap: 5 }}>
      {m.pools.map((pool, i) => {
        const pct = tot ? Math.round((pool / tot) * 100) : 0, c = bucketColor(m, i, p.dark);
        return (
          <View key={i} style={[s.orow, { backgroundColor: p.surface2, borderColor: highlight === i ? c : "transparent" }]}>
            <View style={[s.fill, { width: `${pct}%`, backgroundColor: c }]} />
            <Text style={[s.orowLabel, { color: p.fg }]}>{bucketLabel(m, i)}</Text>
            <Text style={[s.orowPct, MONO, { color: p.fg }]}>{tot ? pct + "%" : "–"}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** The market page's pools: one cell per range (label, amount, share), two to a row on a phone, then the bar. (.pools) */
export function Pools({ m, highlight = -1 }: { m: MarketView; highlight?: number }) {
  const p = usePalette(); const tot = totalPool(m);
  const cells = m.pools.map((pool, i) => {
    const c = bucketColor(m, i, p.dark);
    return (
      <View key={i} style={[s.pool, { backgroundColor: p.surface2, borderLeftColor: c }, highlight === i && { borderColor: c, borderWidth: 2, borderLeftWidth: 4 }]}>
        <Text style={[s.poolLabel, { color: p.dim }]}>{bucketLabel(m, i)}</Text>
        <Text style={[s.poolAmt, MONO, { color: p.fg }]}>{fmtAmt(pool, 0)} {TOKEN_SYMBOL}</Text>
        <Text style={[s.small, { color: p.dim }]}>{tot ? t("pool.pct", { pct: Math.round((pool / tot) * 100) }) : t("pool.none")}</Text>
      </View>
    );
  });
  const rows: React.ReactNode[] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(<View key={i} style={s.poolRow}>{cells[i]}{cells[i + 1] ?? <View style={{ flex: 1 }} />}</View>);
  return (
    <View style={{ gap: 8 }}>
      {rows}
      <View style={[s.bar, { backgroundColor: p.surface2 }]}>{m.pools.map((pool, i) => <View key={i} style={{ width: `${tot ? (pool / tot) * 100 : 100 / m.nBuckets}%`, backgroundColor: bucketColor(m, i, p.dark) }} />)}</View>
      {m.seed > 0 && <Text style={[s.note, { color: p.dim }]}>{t("pool.seed", { amt: fmtAmt(m.seed, 0), tok: TOKEN_SYMBOL })}</Text>}
    </View>
  );
}

/** Where the market stands, as the website's pill at the top of a market page says it. (.mtop .pill) */
export function StatusPill({ m }: { m: MarketView }) {
  const p = usePalette(); const k = statusKind(m);
  const [bg, fg] = k === "open" ? [p.accentBg, p.accent] : k === "awaiting" || k === "proposed" ? [p.warnBg, p.warnFg] : k === "voided" ? [p.noBg, p.no] : [p.surface2, p.dim];
  return <View style={[s.pill, { backgroundColor: bg }]}><Text style={[s.pillText, { color: fg }]}>{statusLabel(m)}</Text></View>;
}

/** The market's life at the top of its page, two steps to a row: each step with its time, the next one with its
 *  countdown; past steps dimmed, the next one marked in the accent colour. (.tgrid) */
export function TimelineGrid({ m, disputeWindowSecs }: { m: MarketView; disputeWindowSecs: number | null }) {
  const p = usePalette(); const steps = timelineSteps(m, disputeWindowSecs);
  const cells = steps.map((st) => {
    const left = st.state === "next" ? inWords(st.ts) : "";
    return (
      <View key={st.key} style={[s.step, { borderTopColor: st.state === "done" ? p.dim : st.state === "next" ? p.accent : p.line }]}>
        <Text style={[s.stepLabel, { color: st.state === "done" ? p.dim : p.fg, fontWeight: st.state === "next" ? "700" : "600" }]}>{st.label}</Text>
        <Text style={[s.stepWhen, { color: p.dim }]}>{st.estimate && st.state !== "done" ? "~ " : ""}{fmtStamp(st.ts)}</Text>
        {left ? <Text style={[s.stepLeft, { color: p.accent }]}>{left}</Text> : null}
      </View>
    );
  });
  const rows: React.ReactNode[] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(<View key={i} style={s.stepRow}>{cells[i]}{cells[i + 1] ?? <View style={{ flex: 1 }} />}</View>);
  return <View style={{ gap: 12, marginBottom: 18 }}>{rows}</View>;
}

const s = StyleSheet.create({
  orow: { position: "relative", flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6, borderWidth: 2, overflow: "hidden" },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.22 },
  orowLabel: { fontSize: 13, lineHeight: 19, flexShrink: 1 },
  orowPct: { fontSize: 13, lineHeight: 19, fontWeight: "600", marginLeft: 8 },
  poolRow: { flexDirection: "row", gap: 8 },
  pool: { flex: 1, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, borderLeftWidth: 4, gap: 2 },
  poolLabel: { fontSize: 12, lineHeight: 17, letterSpacing: 0.7, textTransform: "uppercase", fontWeight: "700" },
  poolAmt: { fontSize: 18, lineHeight: 25 },
  small: { fontSize: 12, lineHeight: 17 },
  bar: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden" },
  note: { fontSize: 12.5, lineHeight: 18 },
  pill: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12 },
  pillText: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  stepRow: { flexDirection: "row", gap: 12 },
  step: { flex: 1, minWidth: 0, borderTopWidth: 3, paddingTop: 8, gap: 2 },
  stepLabel: { fontSize: 14, lineHeight: 18 },
  stepWhen: { fontSize: 13, lineHeight: 19 },
  stepLeft: { fontSize: 13.5, lineHeight: 19, fontWeight: "700" },
});
