import { Buffer } from "buffer";

// Every shim is isolated: a failing polyfill must never take the app down at startup.
const g: any = globalThis as any;
const safe = (name: string, fn: () => void) => { try { fn(); } catch (e) { try { (g.__polyfillErrors ??= []).push(name + ": " + String((e as any)?.message ?? e)); } catch {} } };

safe("Buffer", () => { if (!g.Buffer) g.Buffer = Buffer; });

safe("structuredClone", () => {
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
});

safe("es-shims", () => {
  if (typeof Object.hasOwn !== "function") (Object as any).hasOwn = (o: any, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k);
  if (typeof (Array.prototype as any).at !== "function") Object.defineProperty(Array.prototype, "at", { configurable: true, writable: true, value: function (i: number) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return i < 0 || i >= this.length ? undefined : this[i]; } });
  if (typeof (String.prototype as any).at !== "function") Object.defineProperty(String.prototype, "at", { configurable: true, writable: true, value: function (i: number) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return i < 0 || i >= this.length ? undefined : this[i]; } });
  if (typeof (Array.prototype as any).findLast !== "function") Object.defineProperty(Array.prototype, "findLast", { configurable: true, writable: true, value: function (fn: any) { for (let i = this.length - 1; i >= 0; i--) if (fn(this[i], i, this)) return this[i]; } });
});

safe("TextDecoder", () => {
  if (typeof g.TextDecoder !== "undefined" && typeof g.TextEncoder !== "undefined") return;
  const te = require("text-encoding");
  if (typeof g.TextEncoder === "undefined") g.TextEncoder = te.TextEncoder;
  if (typeof g.TextDecoder === "undefined") g.TextDecoder = te.TextDecoder;
});

safe("AbortSignal.timeout", () => {
  if (typeof g.AbortSignal === "undefined" || typeof g.AbortSignal.timeout === "function") return;
  Object.defineProperty(g.AbortSignal, "timeout", { configurable: true, writable: true, value: (ms: number) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; } });
});

safe("crypto.getRandomValues", () => {
  const { getRandomValues } = require("expo-crypto");
  if (typeof g.crypto === "undefined") Object.defineProperty(g, "crypto", { configurable: true, enumerable: true, get: () => ({ getRandomValues }) });
  else if (typeof g.crypto.getRandomValues !== "function") g.crypto.getRandomValues = getRandomValues;
});

safe("errorLog", () => { require("./utils/errorLog").installGlobalErrorLog(); });
