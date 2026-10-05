// Every time the app shows is the phone's own clock with its zone named ("25 Sept 2026, 14:10 GMT+8"), written exactly as
// the website writes it (web/src/time.ts, English: en-GB, 24-hour). The website asks Intl; Hermes' Intl does not name
// zones reliably, so here the words are spelled out by hand: same output, character for character.
import { t } from "../i18n";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const NBSP = " ";
const at = (ts: number) => new Date(ts * 1000);
const pad = (n: number) => (n < 10 ? "0" : "") + n;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayMonth = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
/** The zone as the website names it: "GMT+8", "GMT+5:30", "GMT" */
export function zoneLabel(d = new Date()) {
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? "+" : "-", h = Math.floor(Math.abs(off) / 60), m = Math.abs(off) % 60;
  return `GMT${off === 0 ? "" : sign + h + (m ? ":" + pad(m) : "")}`;
}
/** "25 Sept 2026, 14:10 GMT+8" */
export const fmtTs = (ts: number) => { const d = at(ts); return `${dayMonth(d)} ${d.getFullYear()}, ${hm(d)} ${zoneLabel(d)}`; };
/** "25 Sept, 14:10 GMT+8": for tight spots where the year is obvious */
export const fmtTsShort = (ts: number) => { const d = at(ts); return `${dayMonth(d)}, ${hm(d)} ${zoneLabel(d)}`; };
/** "27 Sept, 08:00 – 28 Sept, 08:00 GMT+8": a window, zone named once */
export const fmtRange = (from: number, to: number) => { const d = at(from); return `${dayMonth(d)}, ${hm(d)} – ${fmtTsShort(to)}`; };
/** fmtRange for a title: the only place a line may break is after the dash, so "27 Sept" never splits and no line
 *  starts with the dash (the website wraps each end in a no-wrap span). */
export const fmtRangeNb = (from: number, to: number) => { const d = at(from); return `${dayMonth(d)}, ${hm(d)} –`.replace(/ /g, NBSP) + " " + fmtTsShort(to).replace(/ /g, NBSP); };
/** "Sun 27 Sept, 08:00" without the zone: for places that name the zone once (the market timeline) */
export const fmtStamp = (ts: number) => { const d = at(ts); return `${WEEKDAYS[d.getDay()]} ${dayMonth(d)}, ${hm(d)}`; };
/** "14:10 GMT+8" */
export const fmtHm = (ts: number) => { const d = at(ts); return `${hm(d)} ${zoneLabel(d)}`; };
/** "Fri 25 Sept", the phone's calendar day */
export const fmtDay = (ts: number) => { const d = at(ts); return `${WEEKDAYS[d.getDay()]} ${dayMonth(d)}`; };
/** "14–21 Sept": the first and last day of a window longer than a day */
export const fmtDays = (from: number, to: number) => { const a = at(from), b = at(to); return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}` : `${dayMonth(a)} – ${dayMonth(b)}`; };
/** The phone's zone as the app writes it: "GMT+8" */
export const zoneShort = () => zoneLabel(new Date());

export function timeLeft(ts: number) {
  const s = ts - Date.now() / 1000; if (s <= 0) return t("time.closed");
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? t("time.dhLeft", { d, h }) : h > 0 ? t("time.hmLeft", { h, m }) : t("time.mLeft", { m });
}
/** "in 2h 10m" / "in 3d 4h" / "" once passed */
export function inWords(ts: number) {
  const s = ts - Date.now() / 1000; if (s <= 0) return "";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? t("time.inDh", { d, h }) : h > 0 ? t("time.inHm", { h, m }) : t("time.inM", { m: Math.max(1, m) });
}
/** A wait written out: "6 hours", "1 day", "2 days": whole days when it is whole days, hours otherwise. */
export function fmtWait(secs: number) {
  const h = Math.max(1, Math.round(secs / 3600));
  if (h % 24 === 0) return h === 24 ? t("dur.day1") : t("dur.days", { n: h / 24 });
  return h === 1 ? t("dur.hour1") : t("dur.hours", { n: h });
}
