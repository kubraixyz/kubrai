// Pieces of the website's market list and market page (web/src/main.ts, market.ts, ui.ts, timeline.ts and styles.css),
// drawn the same way here: the option rows of a card, the pools, the status pill and the timeline grid.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { NO_OUTCOME, payoutIfBucket, totalPool, type MarketView } from "../chain/kubrai";
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

/** A wallet's stake on a market in numbers: the ranges held, the total, and what it stands to get (decided or proposed:
 *  what this stake is paid; still open: the best it can be paid). The same reading as web/src/market.ts drawPosition. */
export function positionSummary(m: MarketView, all: number[], feeW: (bigint | number | string)[]) {
  const amounts = all.slice(0, m.nBuckets), staked = amounts.reduce((x, y) => x + y, 0);
  const feeBps = amounts.map((x, i) => (x ? Number(BigInt(feeW[i] ?? 0) / BigInt(x)) : 0));
  const mine = amounts.map((_, i) => i).filter((i) => amounts[i] > 0);
  const w = m.status === 2 || m.status === 4 ? m.outcome : m.status === 1 ? m.proposedOutcome : NO_OUTCOME;
  let label = "", value = 0, tone: "" | "won" | "lost" = "", sub = "";
  if (!staked) return { amounts, staked, mine, label, value, tone, sub };
  if (m.status === 3) { label = t("pos.refund"); value = staked; sub = t("pos.voided"); }
  else if (w !== NO_OUTCOME) { const r = payoutIfBucket(m, amounts, feeBps, w); label = t(m.status === 1 ? "pos.ifConfirmed" : "pos.payingOut"); value = r.payout; tone = r.kind === "refund" ? "" : r.kind; sub = t(m.status === 1 ? "pos.proposed" : "pos.result", { b: bucketLabel(m, w) }); }
  else { const outs = mine.map((i) => payoutIfBucket(m, amounts, feeBps, i).payout); value = Math.max(...outs); label = t(mine.length > 1 ? "pos.bestCase" : "pos.ifWins"); if (mine.length > 1) sub = mine.map((i, k) => t("pf.ifRange", { amt: fmtAmt(outs[k]), b: bucketLabel(m, i) })).join(" · "); }
  return { amounts, staked, mine, label, value, tone, sub };
}

/** The connected wallet's stake on this market, between the pools and the bet box: one chip per range held, what was
 *  staked, what it stands to get. It was one grey line under the bet box, off the screen right after a bet. (.mypos) */
export function PositionCard({ m, amounts, feeW }: { m: MarketView; amounts: number[]; feeW: (bigint | number | string)[] }) {
  const p = usePalette(); const v = positionSummary(m, amounts, feeW);
  if (!v.staked) return null;
  const big = (label: string, n: number, color: string, right = false) => (
    <View style={right ? { alignItems: "flex-end" } : null}>
      <Text style={[s.small, { color: p.dim }]}>{label}</Text>
      <View style={s.numRow}><Text style={[s.num, MONO, { color }]}>{fmtAmt(n)}</Text><Text style={[s.small, { color: p.dim }]}>{TOKEN_SYMBOL}</Text></View>
    </View>
  );
  return (
    <View style={[s.mypos, { backgroundColor: p.accentBg, borderColor: p.accent }]}>
      <Text style={[s.myposHead, { color: p.accent }]}>{t("bet.position")}</Text>
      <View style={s.chips}>{v.mine.map((i) => { const c = bucketColor(m, i, p.dark); return (
        <View key={i} style={[s.chip, { borderColor: c, backgroundColor: p.surface }]}><View style={[s.dot, { backgroundColor: c }]} /><Text style={[s.chipText, { color: p.fg }]}>{bucketLabel(m, i)} · <Text style={MONO}>{fmtAmt(v.amounts[i])}</Text></Text></View>); })}</View>
      <View style={s.nums}>{big(t("pos.staked"), v.staked, p.fg)}{big(v.label, v.value, v.tone === "won" ? p.accent : v.tone === "lost" ? p.no : p.fg, true)}</View>
      {v.sub ? <Text style={[s.note, { color: p.dim }]}>{v.sub}</Text> : null}
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
  mypos: { borderWidth: 1, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, gap: 10, marginTop: 16 },
  myposHead: { fontSize: 12, lineHeight: 16, letterSpacing: 0.7, textTransform: "uppercase", fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 13, lineHeight: 19 },
  nums: { flexDirection: "row", justifyContent: "space-between", gap: 16 },
  numRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  num: { fontSize: 22, lineHeight: 30, fontWeight: "600", includeFontPadding: false },
  pill: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12 },
  pillText: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  stepRow: { flexDirection: "row", gap: 12 },
  step: { flex: 1, minWidth: 0, borderTopWidth: 3, paddingTop: 8, gap: 2 },
  stepLabel: { fontSize: 14, lineHeight: 18 },
  stepWhen: { fontSize: 13, lineHeight: 19 },
  stepLeft: { fontSize: 13.5, lineHeight: 19, fontWeight: "700" },
});
