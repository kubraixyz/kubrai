// Metric evaluation from snapshot bundles, shared by the resolver (app host) and the independent verifier (Tokyo).
// Both read the same tag grammar (see resolve.mjs header) from a directory of hourly bundles; only the directory and
// the RPC used to check memo transactions differ.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseMetric, dailyDayStart, dailyReadTs, countedWindow } from "./history.mjs";

const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const MEMO_MAX_LAG_SECS = 6 * 3600;   // snapshot.mjs anchors each hour 3–7 minutes after it (measured 2026-09-18…10-05)

/** tx: getParsedTransaction's answer for the signature in a snapshot's .memo sidecar. True when the transaction
 *  succeeded and carries a Memo-program instruction with "sha256=<sha>", signed by `signer` (the snapshot key: the
 *  proposer, snapshot.mjs); a v2 memo must also name `slot` and have landed within MEMO_MAX_LAG_SECS of that hour, or
 *  the file could have been rewritten and anchored again later. Otherwise the reason, as a string. Until 2026-10-05
 *  any transaction whose logs held "sha256=<sha>" passed, whoever sent it and whenever (audit 2026-10-05). */
export function memoMatches(tx, { slot, sha, signer }) {
  if (!signer) return "no snapshot key to check the memo's signer against";
  if (!tx) return "memo transaction not found";
  if (tx.meta?.err) return "memo transaction failed on-chain";
  const b58 = (k) => String(k?.toBase58?.() ?? k ?? "");
  const msg = tx.transaction?.message ?? {};
  if (!(msg.accountKeys ?? []).some((k) => k.signer && b58(k.pubkey) === signer)) return `memo not signed by the snapshot key ${signer.slice(0, 6)}…`;
  const memo = (msg.instructions ?? []).filter((ix) => b58(ix.programId) === MEMO_PROGRAM && typeof ix.parsed === "string").map((ix) => ix.parsed)
    .find((t) => t.split(/\s+/).includes(`sha256=${sha}`));
  if (!memo) return "no memo with this file's sha256";
  const v2 = memo.match(/^kubrai-snapshot v2 (\S+) /);
  if (v2) {
    if (v2[1] !== slot) return `memo is for ${v2[1]}, not ${slot}`;
    const lag = (tx.blockTime ?? Infinity) - Date.parse(slot + ":00:00Z") / 1000;
    if (!(lag <= MEMO_MAX_LAG_SECS)) return `memo landed ${Number.isFinite(lag) ? Math.round(lag / 3600) + " h" : "at an unknown time"} after its hour`;
  }
  return true;
}

/** memoSigner: base58 of the key that signs snapshot memos (snapshot.mjs uses proposer.json). verifySlot refuses
 *  every slot without it; evaluate does not need it. */
export function makeEvaluator({ snapDir, conn, memoSigner = null }) {
  const SNAP = snapDir;
  // ---------- metric evaluation from snapshot bundles ----------
  // metric base → snapshot field. One source per metric — never fall back between counting bases inside a market.
  // One metric table for the whole system (history.mjs): the API, the market opener and the resolver must agree on
  // what a tag means, or a market opens that can never resolve (the ORE markets of 2026-09-24 did exactly that).
  // (2026-09-26: this file kept its own copy of the grammar without the DefiLlama "_next" tags, so every such market
  // would have come back "unknown metric" at resolution. It now uses the shared parser.)
  const slotOf = (ts) => new Date(ts * 1000).toISOString().slice(0, 13);          // hour containing ts (UTC)
  const slotFile = (slot) => { const h = path.join(SNAP, slot + ".json"); if (fs.existsSync(h)) return h; if (slot.endsWith("T00")) { const d = path.join(SNAP, slot.slice(0, 10) + ".json"); if (fs.existsSync(d)) return d; } return null; };
  // A slot's bundle is only trusted if its bytes hash to the sidecar AND to the hash the snapshot key published on-chain
  // for that hour (memoMatches).
  const memoOk = new Map();
  async function verifySlot(slot) {
    const f = slotFile(slot); if (!f) return { ok: false, reason: `no snapshot ${slot}` };
    const raw = fs.readFileSync(f); const sha = createHash("sha256").update(raw).digest("hex");
    const side = fs.existsSync(f + ".sha256") ? fs.readFileSync(f + ".sha256", "utf8").trim() : null;
    if (side !== sha) return { ok: false, reason: `snapshot ${slot} was modified after it was recorded (sha256 mismatch)` };
    if (!fs.existsSync(f + ".memo")) return { ok: false, reason: `snapshot ${slot} has no on-chain memo` };
    if (!memoOk.has(slot)) {
      const memo = JSON.parse(fs.readFileSync(f + ".memo", "utf8"));
      const tx = await conn.getParsedTransaction(memo.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      memoOk.set(slot, memoMatches(tx, { slot, sha, signer: memoSigner }));
    }
    if (memoOk.get(slot) !== true) return { ok: false, reason: `on-chain memo for ${slot} does not vouch for the file: ${memoOk.get(slot)}` };
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

  /** resolveAfterTs: the market's on-chain resolve_after. Only daily (DefiLlama) markets use it: it is the hour their
   *  number is read, fixed when the market opened (history.mjs dailyReadTs). */
  function evaluate(metric, openTs, closeTs, baseline, resolveAfterTs) {
    const spec = parseMetric(metric); if (!spec) return { ok: false, reason: `unknown metric ${metric}` };
    // everything below reads the counted period (history.mjs countedWindow), which is open→close only for older markets
    if (spec.kind !== "med7" && spec.kind !== "close" && spec.kind !== "daily") { const w = countedWindow(spec, openTs, closeTs); openTs = w.from; closeTs = w.to; }
    const { kind, src } = spec; const sClose = slotOf(closeTs), sOpen = slotOf(openTs); const used = [];
    if (kind === "cum") {
      const b = valueAt(sClose, src); if (b == null) return { ok: false, reason: `missing snapshot ${sClose}` };
      let base = baseline, baseSlot = null;
      if (baseline === 0) { base = valueAt(sOpen, src); baseSlot = sOpen; if (base == null) return { ok: false, reason: `missing opening snapshot ${sOpen}` }; used.push(sOpen); }
      used.push(sClose);
      return { ok: true, value: b - base, used, detail: { baseline: base, baselineSlot: baseSlot ?? "on-chain", close: b, closeSlot: sClose } };
    }
    if (kind === "daily") {
      // the number reported for day D (the betting day for _today, the day after close for _next), read from the first
      // snapshot at or after the market's resolve_after that carries D; what the source changes later does not count.
      // The hour comes from the market, not from today's config: a market opened with a 2-day wait is read 2 days after
      // its day even once new markets wait 6 hours (2026-10-03), and both hosts derive the same hour from the chain.
      const d0 = dailyDayStart(spec, openTs, closeTs); const D = new Date(d0 * 1000).toISOString().slice(0, 10); const from = slotOf(dailyReadTs(spec, openTs, closeTs, resolveAfterTs));
      for (let i = 0; i < 48; i++) {
        const sl = addHours(from, i); const b = readSlot(sl); const ser = b?.metrics?.[src]?.raw?.series; if (!ser) continue;
        const hit = ser.find(([d]) => d === D); /* a 0 is a source gap, not a result: keep waiting */ if (hit && hit[1] > 0) { used.push(sl); return { ok: true, value: hit[1], used, detail: { day: D, slot: sl, source: b.metrics[src].source, neighbours: ser.filter(([d]) => d >= D).slice(0, 3) } }; }
      }
      return { ok: false, reason: `no reading for ${D} in the snapshots from ${from} (source not published yet)` };
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
  /** What the source says NOW about a daily market's day: its number in the newest bundle (this hour, or up to
   *  `hours` back) that carries the day. The verifier's last look before a proposal becomes final compares it with
   *  the proposed value. null for other kinds of market, or when no recent bundle has the day. */
  function dailyLatest(metric, openTs, closeTs, nowTs = Date.now() / 1000, hours = 6) {
    const spec = parseMetric(metric); if (spec?.kind !== "daily") return null;
    const D = new Date(dailyDayStart(spec, openTs, closeTs) * 1000).toISOString().slice(0, 10);
    for (let i = 0; i < hours; i++) {
      const sl = addHours(slotOf(nowTs), -i); const hit = readSlot(sl)?.metrics?.[spec.src]?.raw?.series?.find(([d]) => d === D);
      if (hit && hit[1] > 0) return { value: hit[1], slot: sl, day: D };
    }
    return null;
  }
  // Evidence hash = sha256 over the (verified) per-day bundle hashes, in the order used.
  const evidenceHash = (used, shas) => createHash("sha256").update(used.map((d) => `${d}:${shas[d]}`).join("\n")).digest();


  return { evaluate, dailyLatest, verifySlot, parseMetric, valueAt, slotOf, evidenceHash };
}
