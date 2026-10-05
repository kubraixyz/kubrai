// One market's life, as moments in the phone's clock: bets open → bets close → closing snapshot → result proposed →
// dispute window ends → payout. Past steps are dated, the next one carries a countdown, later ones are estimates.
// Estimates follow the crons on the server: the snapshot lands one minute after the hour, the resolver runs at :20.
// Same rules and words as web/src/timeline.ts.
import type { MarketView } from "./kubrai";
import { fmtTs, inWords } from "./time";
import { catalogEntry, countedWindow } from "./metrics";
import { t } from "../i18n";

export type Step = { key: string; label: string; ts: number; note?: string; estimate?: boolean; state: "done" | "next" | "later" };
const SNAPSHOT_LAG = 60, RESOLVER_MINUTE = 20 * 60;
/** A market on a number its source publishes once a day (DefiLlama): <id>_today, or the retired <id>_next. */
const isDailySource = (metric: string) => { const x = metric.match(/^(.+)_(today|next)$/); return !!x && !!catalogEntry(x[1]); };
/** Resolved, and nobody bet on the winning range: the program then refunds every stake in full, no fee (compute_payout). */
export const noWinner = (m: MarketView) => (m.status === 2 || m.status === 4) && m.outcome < m.nBuckets && !(m.pools[m.outcome] > 0);
/** First resolver run at or after `ts` (cron :20 every hour). */
const nextResolverRun = (ts: number) => { const h = Math.floor(ts / 3600) * 3600; return ts <= h + RESOLVER_MINUTE ? h + RESOLVER_MINUTE : h + 3600 + RESOLVER_MINUTE; };

export function timelineSteps(m: MarketView, disputeWindowSecs: number | null): Step[] {
  const win = disputeWindowSecs ?? 6 * 3600;
  const steps: Omit<Step, "state">[] = [
    { key: "open", label: t("tl.open"), ts: m.openTs },
    { key: "close", label: t("tl.close"), ts: m.closeTs },
  ];
  // the counted period: on the current schedule it starts after betting opens and ends after betting closes
  const [countStart, countEnd] = countedWindow(m);
  if (countStart > m.openTs && countStart < m.closeTs) steps.splice(1, 0, { key: "start", label: t("tl.start"), ts: countStart, note: t("tl.startNote") });
  steps.push({ key: "snapshot", label: t("tl.snapshot"), ts: countEnd + SNAPSHOT_LAG, note: t("tl.snapshotNote") });
  if (m.status === 3) {
    steps.push({ key: "void", label: t("tl.void"), ts: m.proposedAt || m.resolveAfterTs, note: t("tl.voidNote") });
    steps.push({ key: "payout", label: t("tl.refunds"), ts: nextResolverRun((m.proposedAt || m.resolveAfterTs) + 1), note: t("tl.refundsNote"), estimate: true });
  } else {
    const proposedAt = m.proposedAt || null;
    const estProposal = nextResolverRun(Math.max(m.resolveAfterTs, countEnd + SNAPSHOT_LAG));
    steps.push(proposedAt
      ? { key: "propose", label: t("tl.propose"), ts: proposedAt, note: t("tl.proposeNote") }
      // a daily-source market is proposed at the hour its number is read from the source, not when its day ends
      : { key: "propose", label: t("tl.propose"), ts: estProposal, note: t(isDailySource(m.metric) ? "tl.proposeEstDaily" : "tl.proposeEst"), estimate: true });
    const finalAt = (proposedAt ?? estProposal) + win;
    steps.push({ key: "final", label: t("tl.final"), ts: finalAt, note: t("tl.finalNote", { h: win / 3600 }), estimate: !proposedAt });
    const refund = noWinner(m);
    steps.push({ key: "payout", label: refund ? t("tl.refunds") : m.status === 4 ? t("tl.paid") : t("tl.payout"), ts: nextResolverRun(finalAt + 1), note: t(refund ? "tl.noWinnerNote" : "tl.payoutNote"), estimate: m.status < 4 });
  }
  const now = Date.now() / 1000;
  const done = m.status === 4 ? steps.length : steps.filter((s) => s.ts <= now).length;
  return steps.map((s, i) => ({ ...s, state: i < done ? "done" : i === done ? "next" : "later" }));
}
/** The step the market is waiting on right now, or null once it has paid out. */
export function nextStep(m: MarketView, disputeWindowSecs: number | null): Step | null {
  if (m.status === 4) return null;
  const now = Date.now() / 1000;
  return timelineSteps(m, disputeWindowSecs).find((s) => s.ts > now) ?? null;
}
/** The market screen's headline once betting is over: "Dispute window ends in 1h 31m"; "Settled" once paid. */
export function nextStepHead(m: MarketView, disputeWindowSecs: number | null) {
  const s = nextStep(m, disputeWindowSecs); if (!s) return t(noWinner(m) ? "tl.settledRefund" : "tl.settled");
  return t("mkt.headNext", { step: s.label, in: `${s.estimate ? "~ " : ""}${inWords(s.ts)}` });
}
/** One line for lists: "Next: Result proposed ~ 25 Sept 2026, 01:20 GMT+8 (in 2h 10m)". */
export function nextStepText(m: MarketView, disputeWindowSecs: number | null) {
  const s = nextStep(m, disputeWindowSecs); if (!s) return t("tl.settled");
  return t("tl.next", { step: s.label, ts: `${s.estimate ? "~ " : ""}${fmtTs(s.ts)}`, left: inWords(s.ts) ? ` (${inWords(s.ts)})` : "" });
}
