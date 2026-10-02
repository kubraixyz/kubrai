// A daily market is one day of a question that is asked again every day. The row of days at the top of the market
// screen lists every day of that question, oldest to newest, each named by the day it counts (a market's number says
// nothing about which day it is) with how that day ended. Same rules as web/src/series.ts.
import type { MarketView } from "./kubrai";
import { countedWindow, metricInfo } from "./metrics";

/** Markets that ask the same thing on different days carry the same metric tag ("_next" is how "_today" was spelled
 *  before 2026-09-26). */
export const seriesKey = (metric: string) => metric.replace(/_next$/, "_today");
/** Every market of m's question by the day it counts, oldest first. */
export const seriesOf = (all: MarketView[], m: MarketView) => all.filter((x) => seriesKey(x.metric) === seriesKey(m.metric)).sort((a, b) => countedWindow(a)[0] - countedWindow(b)[0] || a.id - b.id);

/** Where a day stands. A voided market keeps no outcome, also after it is swept (status 4). */
export type DayState = "upcoming" | "open" | "awaiting" | "proposed" | "settled" | "voided";
export function dayState(m: MarketView, now = Date.now() / 1000): DayState {
  if (m.status === 0) return now < m.openTs ? "upcoming" : now < m.closeTs ? "open" : "awaiting";
  if (m.status === 1) return "proposed";
  return m.status === 3 || m.outcome >= m.nBuckets ? "voided" : "settled";
}
const STATE_WORD: Record<DayState, string> = { upcoming: "Upcoming", open: "Open", awaiting: "Awaiting result", proposed: "Proposed", settled: "", voided: "Voided" };
/** A number short enough for a chip: three significant digits, thousands as K / M / B ("18", "10.5K", "478M"). */
export function shortNumber(x: number) {
  const units = ["", "K", "M", "B", "T"]; let v = Math.abs(x), i = 0;
  while (i < units.length - 1 && Number(v.toPrecision(3)) >= 1000) { v /= 1000; i++; }
  return (x < 0 ? "-" : "") + Number(v.toPrecision(3)) + units[i];
}
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
/** What a market is called among its siblings, on the phone's clock: the day it counts ("Fri 2 Oct"); a weekly one, its
 *  first and last day ("14–21 Sept"). */
export function dayName(m: MarketView) {
  const [from, to] = countedWindow(m), a = new Date(from * 1000), b = new Date(to * 1000);
  if (to - from <= 36 * 3600) return `${WEEKDAYS[a.getDay()]} ${a.getDate()} ${MONTHS[a.getMonth()]}`;
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}` : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}

/** One chip of the row. `word` is the status while it still says something ("" once settled); `result` is there as soon
 *  as a result is in, proposed or final: "Yes" / "No", or on a range market the number that came in, with `outcome` the
 *  range it landed in (-1 before). `twin`: another market counts the same day (a reopened one), so both show their numbers. */
export type DayChip = { id: number; name: string; state: DayState; word: string; result: string | null; outcome: number; twin: boolean };
export function dayChips(list: MarketView[], now = Date.now() / 1000): DayChip[] {
  const sameDay = new Map<string, number>(); for (const x of list) sameDay.set(dayName(x), (sameDay.get(dayName(x)) ?? 0) + 1);
  return list.map((x) => {
    const state = dayState(x, now), outcome = state === "settled" ? x.outcome : state === "proposed" ? x.proposedOutcome : -1;
    const result = outcome < 0 ? null : x.nBuckets === 2 ? (outcome === 1 ? "Yes" : "No") : shortNumber(x.proposedValue / (metricInfo(x.metric)?.scale ?? 1));
    return { id: x.id, name: dayName(x), state, word: STATE_WORD[state], result, outcome, twin: sameDay.get(dayName(x))! > 1 };
  });
}
