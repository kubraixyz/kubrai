// One market's life, as moments in the phone's clock: bets open → bets close → closing snapshot → result proposed →
// dispute window ends → payout. Past steps are dated, the next one carries a countdown, later ones are estimates.
// Estimates follow the crons on the server: the snapshot lands one minute after the hour, the resolver runs at :20.
// Same rules as web/src/timeline.ts.
import type { MarketView } from "./kubrai";
import { fmtTs, inWords } from "./format";

export type Step = { key: string; label: string; ts: number; note?: string; estimate?: boolean; state: "done" | "next" | "later" };
const SNAPSHOT_LAG = 60, RESOLVER_MINUTE = 20 * 60;
const nextResolverRun = (ts: number) => { const h = Math.floor(ts / 3600) * 3600; return ts <= h + RESOLVER_MINUTE ? h + RESOLVER_MINUTE : h + 3600 + RESOLVER_MINUTE; };

export function timelineSteps(m: MarketView, disputeWindowSecs: number | null): Step[] {
  const win = disputeWindowSecs ?? 6 * 3600;
  const steps: Omit<Step, "state">[] = [
    { key: "open", label: "Betting opens", ts: m.openTs },
    { key: "close", label: "Betting closes", ts: m.closeTs },
    { key: "snapshot", label: "Closing snapshot", ts: m.closeTs + SNAPSHOT_LAG, note: "the hourly snapshot taken right after close; its hash goes on-chain" },
  ];
  if (m.status === 3) {
    const at = m.proposedAt || m.resolveAfterTs;
    steps.push({ key: "void", label: "Voided", ts: at, note: "no result; every stake is refunded in full, no fee" });
    steps.push({ key: "payout", label: "Refunds", ts: nextResolverRun(at + 1), note: "pushed to each wallet by the crank; nothing to claim", estimate: true });
  } else {
    const proposedAt = m.proposedAt || null;
    const estProposal = nextResolverRun(Math.max(m.resolveAfterTs, m.closeTs + SNAPSHOT_LAG));
    steps.push(proposedAt
      ? { key: "propose", label: "Result proposed", ts: proposedAt, note: "the observed value and the evidence hash are on-chain; the winning range follows from the value" }
      : { key: "propose", label: "Result proposed", ts: estProposal, note: "the resolver runs hourly; proposes once the closing snapshot is verified against its on-chain hash", estimate: true });
    const finalAt = (proposedAt ?? estProposal) + win;
    steps.push({ key: "final", label: "Dispute window ends", ts: finalAt, note: `${win / 3600} h in which anyone can dispute the proposed result; then it is final`, estimate: !proposedAt });
    steps.push({ key: "payout", label: m.status === 4 ? "Paid out" : "Payout", ts: nextResolverRun(finalAt + 1), note: "winners are paid, losers' rent refunded, pushed by the crank; nothing to claim", estimate: m.status < 4 });
  }
  const now = Date.now() / 1000;
  const done = m.status === 4 ? steps.length : steps.filter((s) => s.ts <= now).length;
  return steps.map((s, i) => ({ ...s, state: i < done ? "done" : i === done ? "next" : "later" }));
}
export function nextStep(m: MarketView, disputeWindowSecs: number | null): Step | null {
  return timelineSteps(m, disputeWindowSecs).find((s) => s.state === "next") ?? null;
}
/** "Next: result proposed ~ 26 Sept, 02:20 GMT+2 (in 2h 10m)" */
export function nextStepText(m: MarketView, disputeWindowSecs: number | null) {
  const s = nextStep(m, disputeWindowSecs); if (!s) return "Settled";
  return `Next: ${s.label.toLowerCase()} ${s.estimate ? "~ " : ""}${fmtTs(s.ts)}${inWords(s.ts) ? ` (${inWords(s.ts)})` : ""}`;
}
