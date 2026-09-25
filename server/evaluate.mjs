// Metric evaluation from snapshot bundles, shared by the resolver (app host) and the independent verifier (Tokyo).
// Both read the same tag grammar (see resolve.mjs header) from a directory of hourly bundles; only the directory and
// the RPC used to check memo transactions differ.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { APP_SLUGS } from "./metrics.mjs";
import { BASE } from "./history.mjs";

export function makeEvaluator({ snapDir, conn }) {
  const SNAP = snapDir;
  // ---------- metric evaluation from snapshot bundles ----------
  // metric base → snapshot field. One source per metric — never fall back between counting bases inside a market.
  // One metric table for the whole system (history.mjs): the API, the market opener and the resolver must agree on
  // what a tag means, or a market opens that can never resolve (the ORE markets of 2026-09-24 did exactly that).
  const LEGACY = { skr_staked_med7: { kind: "med7", src: "skr_staked" }, das_med7: { kind: "med7", src: "das" }, skr_price_close: { kind: "close", src: "skr_price_usd_e8" } };
  function parseMetric(metric) {
    if (LEGACY[metric]) return LEGACY[metric];
    let m = metric.match(/^rev_(week|day):(.+)$/); if (m) return APP_SLUGS[m[2]] ? { kind: "cum", src: "rev:" + m[2] } : null;
    m = metric.match(/^(.+)_(day|week|dmed|wmed)$/); if (!m || !BASE[m[1]]) return null;
    return { kind: m[2] === "day" || m[2] === "week" ? "cum" : "med", src: BASE[m[1]] };
  }
  const slotOf = (ts) => new Date(ts * 1000).toISOString().slice(0, 13);          // hour containing ts (UTC)
  const slotFile = (slot) => { const h = path.join(SNAP, slot + ".json"); if (fs.existsSync(h)) return h; if (slot.endsWith("T00")) { const d = path.join(SNAP, slot.slice(0, 10) + ".json"); if (fs.existsSync(d)) return d; } return null; };
  // A slot's bundle is only trusted if its bytes hash to the sidecar AND to the hash published on-chain.
  const memoOk = new Map();
  async function verifySlot(slot) {
    const f = slotFile(slot); if (!f) return { ok: false, reason: `no snapshot ${slot}` };
    const raw = fs.readFileSync(f); const sha = createHash("sha256").update(raw).digest("hex");
    const side = fs.existsSync(f + ".sha256") ? fs.readFileSync(f + ".sha256", "utf8").trim() : null;
    if (side !== sha) return { ok: false, reason: `snapshot ${slot} was modified after it was recorded (sha256 mismatch)` };
    if (!fs.existsSync(f + ".memo")) return { ok: false, reason: `snapshot ${slot} has no on-chain memo` };
    if (!memoOk.has(slot)) {
      const memo = JSON.parse(fs.readFileSync(f + ".memo", "utf8"));
      const tx = await conn.getTransaction(memo.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const logs = (tx?.meta?.logMessages ?? []).join("\n");
      memoOk.set(slot, !!tx && logs.includes(`sha256=${sha}`));
    }
    if (!memoOk.get(slot)) return { ok: false, reason: `on-chain memo for ${slot} does not match the file` };
    return { ok: true, sha };
  }
  const bundleCache = new Map();
  const readSlot = (slot) => { if (!bundleCache.has(slot)) { const f = slotFile(slot); bundleCache.set(slot, f ? JSON.parse(fs.readFileSync(f, "utf8")) : null); } return bundleCache.get(slot); };
  const valueAt = (slot, src) => {
    const b = readSlot(slot); if (!b) return null;
    if (src.startsWith("rev:")) { const v = b?.metrics?.dapp_reviews?.raw?.[src.slice(4)]?.reviews; return typeof v === "number" ? v : null; }
    const v = b?.metrics?.[src]?.value; return typeof v === "number" ? v : null;
  };
  const median = (vals) => { const s = [...vals].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : Math.floor((s[s.length / 2 - 1] + s[s.length / 2]) / 2); };
  const addHours = (slot, n) => new Date(Date.parse(slot + ":00:00Z") + n * 3600e3).toISOString().slice(0, 13);

  function evaluate(metric, openTs, closeTs, baseline) {
    const spec = parseMetric(metric); if (!spec) return { ok: false, reason: `unknown metric ${metric}` };
    const { kind, src } = spec; const sClose = slotOf(closeTs), sOpen = slotOf(openTs); const used = [];
    if (kind === "cum") {
      const b = valueAt(sClose, src); if (b == null) return { ok: false, reason: `missing snapshot ${sClose}` };
      let base = baseline, baseSlot = null;
      if (baseline === 0) { base = valueAt(sOpen, src); baseSlot = sOpen; if (base == null) return { ok: false, reason: `missing opening snapshot ${sOpen}` }; used.push(sOpen); }
      used.push(sClose);
      return { ok: true, value: b - base, used, detail: { baseline: base, baselineSlot: baseSlot ?? "on-chain", close: b, closeSlot: sClose } };
    }
    if (kind === "med") {
      const expected = Math.max(1, Math.round((closeTs - openTs) / 3600)); const vals = [];
      const series = [];
      for (let i = 1; i <= expected; i++) { const sl = addHours(sOpen, i); if (sl > sClose) break; const v = valueAt(sl, src); if (v != null) { vals.push(v); used.push(sl); series.push({ slot: sl, value: v }); } }
      const need = Math.ceil(expected * 0.75);
      if (vals.length < need) return { ok: false, reason: `only ${vals.length}/${expected} hourly snapshots (need ${need}) for the median` };
      return { ok: true, value: median(vals), used, detail: { samples: vals.length, expected, min: Math.min(...vals), max: Math.max(...vals), series } };
    }
    if (kind === "med7") {
      const vals = []; for (let i = 6; i >= 0; i--) { const sl = addHours(sClose, -24 * i); const v = valueAt(sl, src); if (v != null) { vals.push(v); used.push(sl); } }
      if (vals.length < 4) return { ok: false, reason: `only ${vals.length}/7 daily snapshots for median` };
      return { ok: true, value: median(vals), used, detail: { values: vals } };
    }
    const v = valueAt(sClose, src); if (v == null) return { ok: false, reason: `missing snapshot ${sClose}` };
    used.push(sClose); return { ok: true, value: v, used, detail: {} };
  }
  // Evidence hash = sha256 over the (verified) per-day bundle hashes, in the order used.
  const evidenceHash = (used, shas) => createHash("sha256").update(used.map((d) => `${d}:${shas[d]}`).join("\n")).digest();


  return { evaluate, verifySlot, parseMetric, valueAt, slotOf, evidenceHash };
}
