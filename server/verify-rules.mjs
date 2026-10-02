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
