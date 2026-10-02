// A daily market is one day of a question that is asked again every day. The row of days at the top of a market page
// lists every day of that question, oldest to newest, each named by the day it counts (a market's number says nothing
// about which day it is) with how that day ended, so the days before are one click away.
import type { MarketView } from "./kubrai";
import { countedWindow, fmtValue, metricInfo } from "./metrics";
import { bucketColor, bucketLabel, esc } from "./ui";
import { fmtDay, fmtDays, fmtRange } from "./time";
import { t } from "./i18n";

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
/** A number short enough for a chip: three significant digits, thousands as K / M / B ("18", "10.5K", "478M"). */
export function shortNumber(x: number) {
  const units = ["", "K", "M", "B", "T"]; let v = Math.abs(x), i = 0;
  while (i < units.length - 1 && Number(v.toPrecision(3)) >= 1000) { v /= 1000; i++; }
  return (x < 0 ? "-" : "") + Number(v.toPrecision(3)) + units[i];
}
/** What a market is called among its siblings: the day it counts ("Fri 2 Oct"); a weekly one, its first and last day. */
export const dayName = (m: MarketView) => { const [from, to] = countedWindow(m); return to - from > 36 * 3600 ? fmtDays(from, to) : fmtDay(from); };

/** The row: one chip per day. Under the day, what happened: the status while there is no result, then the result itself
 *  (Yes / No, or on a range market the number that came in, with a dot in the colour of the range it landed in) — marked
 *  as proposed until it is final. Two markets counting the same day (reopened ones) also show their numbers. */
export function daysHtml(list: MarketView[], cur: MarketView) {
  const now = Date.now() / 1000;
  const sameDay = new Map<string, number>(); for (const x of list) sameDay.set(dayName(x), (sameDay.get(dayName(x)) ?? 0) + 1);
  const chips = list.map((x) => {
    const st = dayState(x, now), o = st === "settled" ? x.outcome : st === "proposed" ? x.proposedOutcome : -1;
    const word = st === "settled" ? "" : t("status." + st);
    const res = o < 0 ? `<span class="res ${st}">${word}</span>`
      : `<span class="res has"><i style="background:${bucketColor(x, o)}"></i>${x.nBuckets === 2 ? t(o === 1 ? "bucket.yes" : "bucket.no") : shortNumber(x.proposedValue / (metricInfo(x.metric)?.scale ?? 1))}${word ? `<small>· ${word}</small>` : ""}</span>`;
    const tip = [fmtRange(...countedWindow(x)), word, o < 0 ? "" : `${fmtValue(x.metric, x.proposedValue, x.thresholds)} → ${bucketLabel(x, o)}`, t("mkt.n", { id: x.id })].filter(Boolean).join(" · ");
    const body = `<b>${esc(dayName(x))}${sameDay.get(dayName(x))! > 1 ? ` <small>#${x.id}</small>` : ""}</b>${res}`;
    return x.id === cur.id ? `<span class="day on" aria-current="page" title="${esc(tip)}">${body}</span>` : `<a class="day" href="/market.html?id=${x.id}" title="${esc(tip)}">${body}</a>`;
  }).join("");
  return `<nav class="days" aria-label="${esc(t("days.aria"))}">${chips}</nav>`;
}
/** Puts the day on screen in the middle of the row (the browser stops at either end, so the latest day sits at the right
 *  edge): after a step back, the day before is already in view. Done again when the web fonts land or the window
 *  changes width (both move every chip), until the viewer takes hold of the row. */
export function placeDays(nav: HTMLElement) {
  let held = false;
  const centre = () => { const on = nav.querySelector<HTMLElement>(".on"); if (on && !held) nav.scrollLeft = on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2; };
  for (const ev of ["pointerdown", "touchstart", "wheel", "keydown"]) nav.addEventListener(ev, () => { held = true; }, { passive: true });
  centre(); document.fonts?.addEventListener("loadingdone", centre); addEventListener("resize", centre);
}
