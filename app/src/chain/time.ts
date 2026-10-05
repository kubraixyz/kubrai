// Every time the app shows is the phone's own clock with its zone named ("25 Sept 2026, 14:10 GMT+8"), written exactly as
// the website writes it in the same language (web/src/time.ts: Intl with en-GB for English, the language's own locale
// otherwise, 24-hour). The website asks Intl; Hermes' Intl does not name zones reliably and its date words cannot be
// checked here, so each language's pattern is spelled out by hand, character for character as Chrome prints it.
import { getLang, t } from "../i18n";

const NBSP = "\u00a0", THIN = "\u2009", WJ = "\u2060";
const pad = (n: number) => (n < 10 ? "0" : "") + n;
const at = (ts: number) => new Date(ts * 1000);
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
type Words = {
  dm: (d: Date) => string;          // "6 Oct" · "10月6日" · "10월 6일" · "6 oct"
  dmHm: (d: Date) => string;        // "6 Oct, 08:00"
  dmyHm: (d: Date) => string;       // "6 Oct 2026, 08:00"
  wdm: (d: Date) => string;         // "Tue 6 Oct"
  wdmHm: (d: Date) => string;       // "Tue 6 Oct, 08:00"
  days: (a: Date, b: Date) => string;   // "14–21 Sept", "28 Sept – 5 Oct"
};
/** English and Spanish: day before month, "Tue 6 Oct" / "mar, 6 oct". */
function latin(months: string[], weekdays: string[], wsep: string): Words {
  const dm = (d: Date) => `${d.getDate()} ${months[d.getMonth()]}`;
  const wdm = (d: Date) => `${weekdays[d.getDay()]}${wsep}${dm(d)}`;
  return {
    dm, dmHm: (d) => `${dm(d)}, ${hm(d)}`, dmyHm: (d) => `${dm(d)} ${d.getFullYear()}, ${hm(d)}`, wdm, wdmHm: (d) => `${wdm(d)}, ${hm(d)}`,
    days: (a, b) => a.getFullYear() !== b.getFullYear() ? `${dm(a)} ${a.getFullYear()}${THIN}–${THIN}${dm(b)} ${b.getFullYear()}`
      : a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${months[b.getMonth()]}` : `${dm(a)}${THIN}–${THIN}${dm(b)}`,
  };
}
/** Chinese and Japanese: "10月6日", the year as "2026年"; the weekday after the date, written the language's own way. */
function cjk(weekday: (d: Date) => string, range: (a: Date, b: Date) => string): Words {
  const dm = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
  return { dm, dmHm: (d) => `${dm(d)} ${hm(d)}`, dmyHm: (d) => `${d.getFullYear()}年${dm(d)} ${hm(d)}`, wdm: (d) => `${dm(d)}${weekday(d)}`, wdmHm: (d) => `${dm(d)}${weekday(d)} ${hm(d)}`, days: range };
}
const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`, ymd = (d: Date) => `${d.getFullYear()}/${md(d)}`;
const mdJa = (d: Date) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`, ymdJa = (d: Date) => `${d.getFullYear()}/${mdJa(d)}`;
const sameYear = (a: Date, b: Date) => a.getFullYear() === b.getFullYear();
const ZH_TW_W = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"], ZH_CN_W = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"], JA_W = ["日", "月", "火", "水", "木", "金", "土"], KO_W = ["일", "월", "화", "수", "목", "금", "토"];
const koDm = (d: Date) => `${d.getMonth() + 1}월 ${d.getDate()}일`;
const WORDS: Record<string, Words> = {
  en: latin(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"], ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], " "),
  es: latin(["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"], ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"], ", "),
  "zh-TW": cjk((d) => " " + ZH_TW_W[d.getDay()], (a, b) => (sameYear(a, b) ? `${md(a)}至${md(b)}` : `${ymd(a)}至${ymd(b)}`)),
  "zh-CN": cjk((d) => ZH_CN_W[d.getDay()], (a, b) => (sameYear(a, b) ? `${md(a)} – ${md(b)}` : `${ymd(a)} – ${ymd(b)}`)),
  ja: cjk((d) => `(${JA_W[d.getDay()]})`, (a, b) => (sameYear(a, b) ? `${mdJa(a)}～${mdJa(b)}` : `${ymdJa(a)}～${ymdJa(b)}`)),
  ko: {
    dm: koDm, dmHm: (d) => `${koDm(d)} ${hm(d)}`, dmyHm: (d) => `${d.getFullYear()}년 ${koDm(d)} ${hm(d)}`, wdm: (d) => `${koDm(d)} (${KO_W[d.getDay()]})`, wdmHm: (d) => `${koDm(d)} (${KO_W[d.getDay()]}) ${hm(d)}`,
    days: (a, b) => (!sameYear(a, b) ? `${a.getFullYear()}년 ${koDm(a)} ~ ${b.getFullYear()}년 ${koDm(b)}` : a.getMonth() === b.getMonth() ? `${koDm(a)}~${b.getDate()}일` : `${koDm(a)} ~ ${koDm(b)}`),
  },
};
const W = () => WORDS[getLang()] ?? WORDS.en;

/** The zone as the website names it: "GMT+8", "GMT+5:30", "GMT" (the same in every language) */
export function zoneLabel(d = new Date()) {
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? "+" : "-", h = Math.floor(Math.abs(off) / 60), m = Math.abs(off) % 60;
  return `GMT${off === 0 ? "" : sign + h + (m ? ":" + pad(m) : "")}`;
}
/** "25 Sept 2026, 14:10 GMT+8" */
export const fmtTs = (ts: number) => { const d = at(ts); return `${W().dmyHm(d)} ${zoneLabel(d)}`; };
/** "25 Sept, 14:10 GMT+8": for tight spots where the year is obvious */
export const fmtTsShort = (ts: number) => { const d = at(ts); return `${W().dmHm(d)} ${zoneLabel(d)}`; };
/** "27 Sept, 08:00 – 28 Sept, 08:00 GMT+8": a window, zone named once */
export const fmtRange = (from: number, to: number) => `${W().dmHm(at(from))} – ${fmtTsShort(to)}`;
/** One unbreakable piece of text: spaces made non-breaking and a word joiner (zero width) between every two characters,
 *  because Chinese and Japanese may otherwise break between any two of them ("10月7" | "日 08:00"). */
const glue = (s: string) => [...s.replace(/ /g, NBSP)].join(WJ);
/** fmtRange for a title: the only place a line may break is after the dash, so "27 Sept" or "10月7日" never splits and no
 *  line starts with the dash (the website wraps each end in a no-wrap span). Searching strips the joiners again. */
export const fmtRangeNb = (from: number, to: number) => glue(`${W().dmHm(at(from))} –`) + " " + glue(fmtTsShort(to));
/** "Sun 27 Sept, 08:00" without the zone: for places that name the zone once (the market timeline) */
export const fmtStamp = (ts: number) => W().wdmHm(at(ts));
/** "14:10 GMT+8" */
export const fmtHm = (ts: number) => { const d = at(ts); return `${hm(d)} ${zoneLabel(d)}`; };
/** "Fri 25 Sept", the phone's calendar day */
export const fmtDay = (ts: number) => W().wdm(at(ts));
/** "14–21 Sept": the first and last day of a window longer than a day */
export const fmtDays = (from: number, to: number) => W().days(at(from), at(to));
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
