// One market's life, as moments in the viewer's clock: bets open → bets close → closing snapshot → result proposed →
// dispute window ends → payout. Past steps are dated, the next one carries a countdown, later ones are estimates.
// Estimates follow the crons on the server: the snapshot lands one minute after the hour, the resolver runs at :20.
import type { MarketView } from "./kubrai";
import { fmtTs, inWords } from "./time";
import { esc } from "./ui";
import { t } from "./i18n";

export type Step = { key: string; label: string; ts: number; note?: string; estimate?: boolean };
const SNAPSHOT_LAG = 60, RESOLVER_MINUTE = 20 * 60;
/** First resolver run at or after `ts` (cron :20 every hour). */
const nextResolverRun = (ts: number) => { const h = Math.floor(ts / 3600) * 3600; return ts <= h + RESOLVER_MINUTE ? h + RESOLVER_MINUTE : h + 3600 + RESOLVER_MINUTE; };

export function timelineSteps(m: MarketView, cfg: { disputeWindowSecs: { toNumber(): number } } | null): Step[] {
  const win = cfg ? cfg.disputeWindowSecs.toNumber() : 6 * 3600;
  const steps: Step[] = [
    { key: "open", label: t("tl.open"), ts: m.openTs },
    { key: "close", label: t("tl.close"), ts: m.closeTs },
    { key: "snapshot", label: t("tl.snapshot"), ts: m.closeTs + SNAPSHOT_LAG, note: t("tl.snapshotNote") },
  ];
  if (m.status === 3) {
    steps.push({ key: "void", label: t("tl.void"), ts: m.proposedAt || m.resolveAfterTs, note: t("tl.voidNote") });
    steps.push({ key: "payout", label: t("tl.refunds"), ts: nextResolverRun((m.proposedAt || m.resolveAfterTs) + 1), note: t("tl.refundsNote"), estimate: true });
    return steps;
  }
  const proposedAt = m.proposedAt || null;
  const estProposal = nextResolverRun(Math.max(m.resolveAfterTs, m.closeTs + SNAPSHOT_LAG));
  steps.push(proposedAt
    ? { key: "propose", label: t("tl.propose"), ts: proposedAt, note: t("tl.proposeNote") }
    : { key: "propose", label: t("tl.propose"), ts: estProposal, note: t("tl.proposeEst"), estimate: true });
  const finalAt = (proposedAt ?? estProposal) + win;
  steps.push({ key: "final", label: t("tl.final"), ts: finalAt, note: t("tl.finalNote", { h: win / 3600 }), estimate: !proposedAt });
  steps.push({ key: "payout", label: m.status === 4 ? t("tl.paid") : t("tl.payout"), ts: nextResolverRun(finalAt + 1), note: t("tl.payoutNote"), estimate: m.status < 4 });
  return steps;
}

/** The step the market is waiting on right now, or null once it has paid out. */
export function nextStep(m: MarketView, cfg: Parameters<typeof timelineSteps>[1]): Step | null {
  if (m.status === 4) return null;
  const now = Date.now() / 1000;
  return timelineSteps(m, cfg).find((s) => s.ts > now) ?? null;
}

export function timelineHtml(m: MarketView, cfg: Parameters<typeof timelineSteps>[1]) {
  const now = Date.now() / 1000; const steps = timelineSteps(m, cfg);
  const done = m.status === 4 ? steps.length : steps.filter((s) => s.ts <= now).length;
  return `<ol class="tline">${steps.map((s, i) => {
    const state = i < done ? "done" : i === done ? "next" : "later";
    const when = `${s.estimate && state !== "done" ? "~ " : ""}${fmtTs(s.ts)}`;
    const left = state === "next" ? inWords(s.ts) : "";
    return `<li class="${state}"><i></i><div><b>${esc(s.label)}</b><span class="when mono">${esc(when)}${left ? ` · <em>${esc(left)}</em>` : ""}</span>${s.note ? `<span class="note">${esc(s.note)}</span>` : ""}</div></li>`;
  }).join("")}</ol>`;
}

/** One line for lists: "Next: result proposed ~ 25 Sept, 01:20 GMT+8 (in 2h 10m)". */
export function nextStepText(m: MarketView, cfg: Parameters<typeof timelineSteps>[1]) {
  const s = nextStep(m, cfg); if (!s) return t("tl.settled");
  return t("tl.next", { step: s.label, ts: `${s.estimate ? "~ " : ""}${fmtTs(s.ts)}`, left: inWords(s.ts) ? ` (${inWords(s.ts)})` : "" });
}
