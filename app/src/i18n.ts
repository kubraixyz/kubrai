// Words. The app says what the website says, from the website's own dictionaries (web/src/i18n/<lang>.json, copied
// into src/i18n/ by scripts/sync-i18n.mjs), so a market reads the same in both and a change of wording is made once.
// Words only the app says (the wallet hand-off on a phone, the Settings screen) are in src/i18n/app.<lang>.json, keys
// "app.*". English is the fallback for any key a language lacks, as on the website.
// The language: the one picked in Settings (kept on the phone), else the phone's own, by the website's rule for a
// browser's (server/i18n.mjs); English when the phone speaks none of ours.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { I18nManager } from "react-native";
import en from "./i18n/en.json";
import zhTW from "./i18n/zh-TW.json";
import zhCN from "./i18n/zh-CN.json";
import ja from "./i18n/ja.json";
import ko from "./i18n/ko.json";
import es from "./i18n/es.json";
import appEn from "./i18n/app.en.json";
import appZhTW from "./i18n/app.zh-TW.json";
import appZhCN from "./i18n/app.zh-CN.json";
import appJa from "./i18n/app.ja.json";
import appKo from "./i18n/app.ko.json";
import appEs from "./i18n/app.es.json";

export const LANGS: [string, string][] = [["en", "English"], ["zh-TW", "繁體中文"], ["zh-CN", "简体中文"], ["ja", "日本語"], ["ko", "한국어"], ["es", "Español"]];
type Dict = Record<string, string>;
const PACKS: Record<string, Dict[]> = { en: [en, appEn], "zh-TW": [zhTW, appZhTW], "zh-CN": [zhCN, appZhCN], ja: [ja, appJa], ko: [ko, appKo], es: [es, appEs] };
const KEY = "kb_lang";

/** A locale tag ("zh_TW_#Hant", "zh-Hant-HK", "ja-JP", "es_419") → one of ours, or null. Chinese goes by script/region:
 *  Taiwan, Hong Kong, Macau and "Hant" read Traditional (the website's rule). */
export function pickLang(tag: string): string | null {
  const s = String(tag ?? "").trim().toLowerCase().replace(/_/g, "-");
  const exact = LANGS.find(([l]) => l.toLowerCase() === s); if (exact) return exact[0];
  if (s === "zh" || s.startsWith("zh-")) return /-(tw|hk|mo|#?hant)\b/.test(s) ? "zh-TW" : "zh-CN";
  return LANGS.find(([l]) => l.toLowerCase() === s.split("-")[0])?.[0] ?? null;
}
function phoneLocale(): string {
  try { const c: any = (I18nManager as any).getConstants?.() ?? I18nManager; if (c?.localeIdentifier) return String(c.localeIdentifier); } catch {}
  try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch {}
  return "en";
}
export const PHONE_LANG = pickLang(phoneLocale()) ?? "en";

let lang = PHONE_LANG;
const build = (l: string): Dict => Object.assign({}, en, appEn, ...(l === "en" ? [] : PACKS[l]));
let dict = build(lang);
const listeners = new Set<(l: string) => void>();
export const getLang = () => lang;
/** Switch the words now; whoever listens (App.tsx) redraws everything. */
export function setLang(l: string) {
  if (!PACKS[l] || l === lang) return;
  lang = l; dict = build(l); listeners.forEach((f) => f(l));
}
export function onLang(f: (l: string) => void) { listeners.add(f); return () => { listeners.delete(f); }; }
/** The language picked in Settings, if any, before the first screen is drawn. */
export async function loadSavedLang() { try { const s = await AsyncStorage.getItem(KEY); if (s && PACKS[s]) setLang(s); } catch {} }
/** Picked in Settings: kept on the phone. "auto" goes back to the phone's own language. */
export async function chooseLang(l: string) {
  try { if (l === "auto") await AsyncStorage.removeItem(KEY); else await AsyncStorage.setItem(KEY, l); } catch {}
  setLang(l === "auto" ? PHONE_LANG : l);
}
export async function savedLang(): Promise<string | null> { try { return await AsyncStorage.getItem(KEY); } catch { return null; } }

const pad = (n: number) => (n < 10 ? "0" : "") + n;
const zone = (d: Date) => { const off = -d.getTimezoneOffset(), h = Math.floor(Math.abs(off) / 60), m = Math.abs(off) % 60; return `GMT${off === 0 ? "" : (off > 0 ? "+" : "-") + h + (m ? ":" + pad(m) : "")}`; };
/** A fixed daily UTC hour ("11:00") as the phone's clock shows it today: "19:00 GMT+8" (the website's localizeUtc). */
function utcHourLocal(hm: string) {
  const [h, m] = hm.split(":").map(Number), d = new Date((Math.floor(Date.now() / 86400000) * 86400 + h * 3600 + m * 60) * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${zone(d)}`;
}
const ENTITIES: Record<string, string> = { "&nbsp;": "\u00a0", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
/** The few strings written for a web page carry markup: a non-breaking space, a UTC hour to show in local time, a link.
 *  Text needs none of it: the hour is written out, every other tag is dropped and its text kept. */
const plain = (s: string) => (s.includes("<") || s.includes("&")
  ? s.replace(/<span data-utc="(\d{1,2}:\d{2})">[^<]*<\/span>/g, (_, hm) => utcHourLocal(hm)).replace(/<[^>]+>/g, "").replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e])
  : s);

/** The string for `key` with {name} slots filled; a key no dictionary has comes back as itself. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const s = plain(dict[key] ?? key);
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
