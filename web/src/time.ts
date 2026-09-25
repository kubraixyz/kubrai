// Every time the site shows — timestamps and the rules' wording alike — is the viewer's own clock, with its zone named
// ("25 Sept 2026, 14:10 GMT+8"). Nobody should have to convert from UTC in their head.
const at = (ts: number) => new Date(ts * 1000);
const tidy = (s: string) => s.replace(/\[(GMT[^\]]*)\]/, "$1");
// 24-hour clock everywhere (several locales default to a 12-hour one)
const H23 = { hourCycle: "h23" } as const;
import { DATE_LOCALE, t } from "./i18n";
const LOCALE = DATE_LOCALE;
/** "25 Sept 2026, 14:10 GMT+8" */
export const fmtTs = (ts: number) => tidy(at(ts).toLocaleString(LOCALE, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset", ...H23 }));
/** "25 Sept, 14:10 GMT+8": for tight spots where the year is obvious */
export const fmtTsShort = (ts: number) => tidy(at(ts).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset", ...H23 }));
/** "14:10 GMT+8" */
export const fmtHm = (ts: number) => tidy(at(ts).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset", ...H23 }));
/** "Fri 25 Sept", the viewer's calendar day */
export const fmtDay = (ts: number) => at(ts).toLocaleDateString(LOCALE, { weekday: "short", month: "short", day: "numeric" });
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

/** Static copy writes fixed daily UTC times as <span data-utc="00:00">00:00 UTC</span>; rewrite them in the viewer's zone. */
export function localizeUtc(root: ParentNode = document) {
  const today = Math.floor(Date.now() / 86400000) * 86400;
  root.querySelectorAll<HTMLElement>("[data-utc]").forEach((el) => {
    const v = el.dataset.utc ?? ""; if (!/^\d{1,2}:\d{2}$/.test(v)) return;
    const [h, m] = v.split(":").map(Number);
    el.textContent = fmtHm(today + h * 3600 + m * 60);
  });
}
