// Every time the site shows — timestamps and the rules' wording alike — is the viewer's own clock, with its zone named
// ("25 Sept 2026, 14:10 GMT+8"). Nobody should have to convert from UTC in their head.
const at = (ts: number) => new Date(ts * 1000);
// 24-hour clock everywhere (several locales default to a 12-hour one)
const H23 = { hourCycle: "h23" } as const;
import { DATE_LOCALE, t } from "./i18n";
const LOCALE = DATE_LOCALE;
// The zone is always written last, after the time ("14:10 GMT+8"), and is read from the formatter's parts rather than
// cut out of a formatted string: where a locale puts it differs. Simplified Chinese writes it before the time with
// nothing in between, which gave "10月3日 GMT+2 02:00" in titles and "GMT+205:41:05" for the zone on its own;
// Traditional Chinese wraps it in brackets.
const zoneAt = (d: Date) => { try { return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", timeZoneName: "shortOffset", ...H23 }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? ""; } catch { return ""; } };
const withZone = (d: Date, o: Intl.DateTimeFormatOptions) => `${d.toLocaleString(LOCALE, { ...o, ...H23 })} ${zoneAt(d)}`.trim();
/** "25 Sept 2026, 14:10 GMT+8" */
export const fmtTs = (ts: number) => withZone(at(ts), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
/** "25 Sept, 14:10 GMT+8": for tight spots where the year is obvious */
export const fmtTsShort = (ts: number) => withZone(at(ts), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** "27 Sept, 08:00 – 28 Sept, 08:00 GMT+8": a window, zone named once */
export const fmtRange = (from: number, to: number) => `${at(from).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...H23 })} – ${fmtTsShort(to)}`;
/** "Sun 27 Sept, 08:00" without the zone: for places that name the zone once (the market timeline) */
export const fmtStamp = (ts: number) => at(ts).toLocaleString(LOCALE, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...H23 });
/** The viewer's zone as the site writes it: "GMT+8" */
export const zoneShort = () => zoneAt(new Date());
/** fmtRange as HTML whose two ends never wrap inside themselves (a title must not break "26 Sept" apart) */
export const fmtRangeHtml = (from: number, to: number) => { const [a, b] = fmtRange(from, to).split(" – "); return `<span class="nw">${a}</span> – <span class="nw">${b}</span>`; };
/** "14:10 GMT+8" */
export const fmtHm = (ts: number) => withZone(at(ts), { hour: "2-digit", minute: "2-digit" });
/** "Fri 25 Sept", the viewer's calendar day */
export const fmtDay = (ts: number) => at(ts).toLocaleDateString(LOCALE, { weekday: "short", month: "short", day: "numeric" });
/** "14–21 Sept": the first and last day of a window longer than a day */
export const fmtDays = (from: number, to: number) => { const f = new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric" }) as any; return f.formatRange ? f.formatRange(at(from), at(to)) : `${f.format(at(from))} – ${f.format(at(to))}`; };
/** The viewer's zone, e.g. "Asia/Taipei" */
export const zoneName = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? t("time.local"); } catch { return t("time.local"); } };

export function timeLeft(ts: number) {
  const s = ts - Date.now() / 1000; if (s <= 0) return t("time.closed");
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? t("time.dhLeft", { d, h }) : h > 0 ? t("time.hmLeft", { h, m }) : t("time.mLeft", { m });
}
/** "in 2h 10m" / "in 3 d" / "" once passed */
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

/** Static copy writes fixed daily UTC times as <span data-utc="00:00">00:00 UTC</span>; rewrite them in the viewer's zone. */
export function localizeUtc(root: ParentNode = document) {
  const today = Math.floor(Date.now() / 86400000) * 86400;
  root.querySelectorAll<HTMLElement>("[data-utc]").forEach((el) => {
    const v = el.dataset.utc ?? ""; if (!/^\d{1,2}:\d{2}$/.test(v)) return;
    const [h, m] = v.split(":").map(Number);
    el.textContent = fmtHm(today + h * 3600 + m * 60);
  });
}
