import { getRandomValues as expoCryptoGetRandomValues } from "expo-crypto";
import { Buffer } from "buffer";

const g: any = globalThis as any;
g.Buffer = Buffer;

// --- structuredClone: Hermes does not ship it; Anchor calls it. Three layers so we never end up with undefined.
(() => {
  if (typeof g.structuredClone === "function") return;
  let impl: any;
  try { const m = require("@ungap/structured-clone"); impl = typeof m === "function" ? m : typeof m?.default === "function" ? m.default : undefined; } catch {}
  if (typeof impl !== "function") {
    impl = function deepClone(v: any, seen = new Map()): any {
      if (v === null || typeof v !== "object") return v;
      if (seen.has(v)) return seen.get(v);
      if (v instanceof Date) return new Date(v.getTime());
      if (v instanceof Map) { const m = new Map(); seen.set(v, m); v.forEach((val, k) => m.set(deepClone(k, seen), deepClone(val, seen))); return m; }
      if (v instanceof Set) { const s = new Set(); seen.set(v, s); v.forEach((val) => s.add(deepClone(val, seen))); return s; }
      if (ArrayBuffer.isView(v)) return (v as any).slice();
      if (Array.isArray(v)) { const a: any[] = []; seen.set(v, a); v.forEach((x) => a.push(deepClone(x, seen))); return a; }
      const o: any = {}; seen.set(v, o); for (const k of Object.keys(v)) o[k] = deepClone(v[k], seen); return o;
    };
  }
  g.structuredClone = impl;
})();

// --- small ES2022/2023 gaps seen on older Hermes builds
if (typeof Object.hasOwn !== "function") (Object as any).hasOwn = (o: any, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k);
if (typeof (Array.prototype as any).at !== "function") (Array.prototype as any).at = function (i: number) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return i < 0 || i >= this.length ? undefined : this[i]; };
if (typeof (String.prototype as any).at !== "function") (String.prototype as any).at = function (i: number) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return i < 0 || i >= this.length ? undefined : this[i]; };
if (typeof (Array.prototype as any).findLast !== "function") (Array.prototype as any).findLast = function (fn: any) { for (let i = this.length - 1; i >= 0; i--) if (fn(this[i], i, this)) return this[i]; };
if (typeof g.TextEncoder === "undefined" || typeof g.TextDecoder === "undefined") {
  try { const te = require("text-encoding"); g.TextEncoder ??= te.TextEncoder; g.TextDecoder ??= te.TextDecoder; } catch {}
}

// --- crypto.getRandomValues
class Crypto { getRandomValues = expoCryptoGetRandomValues; }
const webCrypto = typeof crypto !== "undefined" ? crypto : new Crypto();
(() => { if (typeof crypto === "undefined") Object.defineProperty(g, "crypto", { configurable: true, enumerable: true, get: () => webCrypto }); })();
