// Words. The app says what the website says, from the website's own dictionary (web/src/i18n/<lang>.json, copied into
// src/i18n/ by scripts/sync-i18n.mjs), so a market reads the same in both and a change of wording is made once.
// Words only the app says (the wallet hand-off on a phone, for one) are in src/i18n/app.<lang>.json, keys "app.*".
// The app ships English; LANGS lists what is bundled.
import en from "./i18n/en.json";
import appEn from "./i18n/app.en.json";

export const LANGS: [string, string][] = [["en", "English"]];
export const LANG = "en";
const dict: Record<string, string> = { ...(en as Record<string, string>), ...(appEn as Record<string, string>) };

const pad = (n: number) => (n < 10 ? "0" : "") + n;
const zone = (d: Date) => { const off = -d.getTimezoneOffset(), h = Math.floor(Math.abs(off) / 60), m = Math.abs(off) % 60; return `GMT${off === 0 ? "" : (off > 0 ? "+" : "-") + h + (m ? ":" + pad(m) : "")}`; };
/** A fixed daily UTC hour ("11:00") as the phone's clock shows it today: "19:00 GMT+8" (the website's localizeUtc). */
function utcHourLocal(hm: string) {
  const [h, m] = hm.split(":").map(Number), d = new Date((Math.floor(Date.now() / 86400000) * 86400 + h * 3600 + m * 60) * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${zone(d)}`;
}
const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
/** The few strings written for a web page carry markup: a non-breaking space, a UTC hour to show in local time, a link.
 *  Text needs none of it: the hour is written out, every other tag is dropped and its text kept. */
const plain = (s: string) => (s.includes("<") || s.includes("&")
  ? s.replace(/<span data-utc="(\d{1,2}:\d{2})">[^<]*<\/span>/g, (_, hm) => utcHourLocal(hm)).replace(/<[^>]+>/g, "").replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e])
  : s);

/** The string for `key` with {name} slots filled; a key the dictionary lacks comes back as itself. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const s = plain(dict[key] ?? key);
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
