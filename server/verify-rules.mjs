// The independent verifier's decisions (verify-proposals.mjs), kept apart from the script so they can be tested
// without a chain: the script itself connects and acts as soon as it is imported.

/** How long before the dispute window closes the verifier takes its last look at a daily-source market. The verifier
 *  runs every 10 minutes and this host's bundle lands a few minutes after the hour, so half an hour gives at least two
 *  looks, the later one on a bundle taken minutes before the window closes. */
export const LAST_LOOK_SECS = 30 * 60;

/** What to do with a proposal given our own reading of the same hours. */
export function comparisonAction(proposedBucket, ourBucket) {
  if (ourBucket == null) return "unknown";
  return proposedBucket === ourBucket ? "agree" : "void-mismatch";
}

/** The last look at a market that settles on a number its source may still change (DefiLlama's daily figures).
 *  `latest` is what the source says now ({ value, slot } from evaluate.mjs dailyLatest, or null). The rule is "what the
 *  source showed when it was read; later revisions do not count" — but nothing is paid for six more hours, and a number
 *  the source itself has moved into another range inside those hours is not a result to pay out on: void, refund all.
 *  A change that stays inside the proposed range changes nothing. No recent reading is not evidence of a change. */
export function lastLookAction(proposedBucket, proposedValue, latest, thresholds) {
  if (!latest || !(latest.value > 0)) return { action: "no-data" };
  const bucket = thresholds.filter((t) => latest.value >= t).length;   // same rule as on-chain Market::bucket_of
  if (bucket !== proposedBucket) return { action: "void-drift", bucket };
  return { action: latest.value === proposedValue ? "same" : "moved-same-range", bucket };
}

/** One last look at one proposal: decide, act, remember. Everything that touches the outside world is handed in
 *  (`io`), so the whole step runs in a test with fakes.
 *    p  = { id, metric, key, prior (this proposal's record in verified.json), thresholds, proposedValue,
 *           proposedBucket, latest, dry, cluster }
 *    io = { voidMarket(why) → signature|null, notify(title, body, key, minutes), log(line), setState(record) }
 *  The record keeps what was last seen, so an unchanged reading is logged once and not on every 10-minute run; a void
 *  is recorded with its signature and never tried twice. A dry run only logs: no void, no page, nothing recorded. */
export async function lastLook(p, io) {
  const { id, metric, key, prior, thresholds, proposedValue, proposedBucket, latest, dry, cluster } = p;
  const ll = lastLookAction(proposedBucket, proposedValue, latest, thresholds);
  const seen = latest ? `${latest.slot}:${latest.value}` : null;
  if (ll.action === "void-drift") {
    io.log(`market #${id} (${metric}): LAST LOOK — proposed ${proposedValue} → range ${proposedBucket}; the source now reports ${latest.value} for ${latest.day} (bundle ${latest.slot}) → range ${ll.bucket}`);
    const sig = await io.voidMarket("the source changed the day's number into another range before the proposal was final");
    if (!dry) await io.notify("↩️ 來源在定案前改了數字,已作廢退款", `${cluster} #${id} ${metric}\n提案時讀到 ${proposedValue} → 格 ${proposedBucket}\n定案前東京再讀(${latest.slot}):${latest.value} → 格 ${ll.bucket}\n${sig ? `void tx ${sig}` : "(DRY RUN)"}\n來源在 6 小時內把那一天的數字改到別的區間:不派彩,全額退款。常發生就把這個指標的讀取時間(app-metrics.json readAfterHours)往後調。`, `verify-drift:${key}`, 60);
    if (!dry) io.setState({ ...prior, lastLook: { at: new Date().toISOString(), seen, action: ll.action, bucket: ll.bucket }, voidSig: sig });
    return ll;
  }
  if (prior.lastLook?.seen !== seen || prior.lastLook?.action !== ll.action) {
    io.log(`market #${id} (${metric}): last look — ${ll.action === "no-data" ? "no recent bundle carries the day; the proposal stands" : ll.action === "same" ? `the source still reports ${latest.value} (bundle ${latest.slot}); the proposal stands` : `the source now reports ${latest.value} (bundle ${latest.slot}), proposed ${proposedValue}: still range ${proposedBucket}; the proposal stands`}`);
    if (!dry) io.setState({ ...prior, lastLook: { at: new Date().toISOString(), seen, action: ll.action } });
  }
  return ll;
}
