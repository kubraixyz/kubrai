// Ring buffer of recent errors, attached to feedback reports. Installed once from polyfills.
const buf: { at: string; msg: string; stack?: string }[] = [];
export function recordError(e: any, where = "") {
  try { buf.push({ at: new Date().toISOString(), msg: (where ? where + ": " : "") + String(e?.message ?? e), stack: String(e?.stack ?? "").split("\n").slice(0, 8).join("\n") }); if (buf.length > 10) buf.shift(); } catch {}
}
export const lastErrors = () => [...buf];
export function installGlobalErrorLog() {
  const g: any = globalThis as any;
  const prev = g.ErrorUtils?.getGlobalHandler?.();
  g.ErrorUtils?.setGlobalHandler?.((e: any, fatal?: boolean) => { recordError(e, fatal ? "fatal" : "error"); prev?.(e, fatal); });
}
