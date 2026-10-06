import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ActivityIndicator } from "react-native-paper";
import { useNavigation, useRoute } from "@react-navigation/native";
import { PublicKey } from "@solana/web3.js";
import { useBalances, useConfig, useInvalidateAll, useMarket, useMarkets, useNoteBet, usePositions } from "../hooks/useKubrai";
import { useApplyInvite, usePendingReferral, type InviteNote } from "../hooks/useReferral";
import { metricInfo, fmtValue, rangesFixed, sourceLabel } from "../chain/metrics";
import { fmtRange, fmtTs, fmtTsShort, fmtWait, inWords, zoneShort } from "../chain/time";
import { bucketColor, bucketLabel, fmtAmt, question, short } from "../chain/format";
import { buildPlaceBetTx, waitForSignature, impliedPayout, earlyBirdUntil, programId, totalPool, NO_OUTCOME, type MarketView } from "../chain/kubrai";
import { nextStepHead } from "../chain/timeline";
import { explorerTxUrl } from "../chain/explorer";
import { discountLabel, feeWithDiscounts, holderProof, stakeRuleText, type HolderProof } from "../chain/holder";
import { useConnection } from "../utils/ConnectionProvider";
import { useAuthorization } from "../utils/useAuthorization";
import { useMobileWallet } from "../utils/useMobileWallet";
import { APP, TOKEN_DECIMALS, TOKEN_SYMBOL, IS_TEST } from "../config";
import bs58 from "bs58";
import { recordError } from "../utils/errorLog";
import { t } from "../i18n";
import { DayStrip } from "../components/DayStrip";
import { Pools, PositionCard, StatusPill, TimelineGrid } from "../components/MarketParts";
import { MONO, usePalette, type Palette } from "../components/palette";

/** "wait" = sent, neither confirmed nor rejected yet: neutral, and the bet button stays locked. `sig` adds an explorer link. */
type BetMsg = { kind: "ok" | "err" | "info" | "wait"; text: string; sig?: string };
const NO_PROOF: HolderProof = { accounts: [], sgt: false, stake: false, sgtDiscountBps: 0, stakeDiscountBps: 0, minFeeBps: 0, stakeLabel: "" };

/** One screen for every day of a question: the row of days stays in place while the market under it is swapped. The
 *  market is keyed by its id, so the bet form, messages and lock of one day never carry over to another; while a bet is
 *  on its way the row does not switch days (the form that is waiting on it would be thrown away). */
export function MarketScreen() {
  const { params } = useRoute<any>(); const nav = useNavigation<any>(); const id = Number(params?.id); const p = usePalette();
  const [betting, setBetting] = useState(false);
  return (
    <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <DayStrip id={id} disabled={betting} onPick={(day) => nav.setParams({ id: day })} />
      <Market key={id} id={id} onBetting={setBetting} />
    </ScrollView>
  );
}

// The website's market page (web/src/market.ts) on a phone: status and number; the question; what happens next, the pot,
// the bettors and the zone; the timeline; how the number is read and where from; the pools; the bet; the rules, with the
// snapshots behind the result. Same words, same order. What is the app's own is the wallet: Mobile Wallet Adapter signs.
function Market({ id, onBetting }: { id: number; onBetting: (on: boolean) => void }) {
  const p = usePalette(); const nav = useNavigation<any>(); const { connection } = useConnection();
  const { selectedAccount } = useAuthorization(); const { connect, signAndSendTransaction, signTransaction } = useMobileWallet();
  const { data: m, isLoading, isError, error } = useMarket(id); const list = useMarkets();
  const { data: cfg } = useConfig(); const bal = useBalances(); const positions = usePositions(); const invalidate = useInvalidateAll(); const noteBet = useNoteBet();
  const [bucket, setBucket] = useState(0); const [amt, setAmt] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<BetMsg | null>(null);
  // A sent bet the network has neither confirmed nor rejected after every poll locks the button until the screen is
  // reopened: tapping again would place a second real bet.
  const [locked, setLocked] = useState(false);
  // Invite code waiting on this phone (Settings / ?ref= link): bound right after this wallet's first bet (hooks/useReferral).
  const [inviteNote, setInviteNote] = useState<InviteNote | null>(null);
  const pendingInvite = usePendingReferral(); const applyInvite = useApplyInvite();
  const [proof, setProof] = useState<HolderProof>(NO_PROOF);
  useEffect(() => { let live = true; holderProof(connection, programId, selectedAccount?.publicKey ?? null, cfg?.feeTiers ?? null).then((x) => { if (live) setProof(x); }); return () => { live = false; }; }, [selectedAccount?.publicKey?.toBase58?.(), cfg?.feeTiers?.sgtGroupMint]);
  const now = Date.now() / 1000;
  const a = Math.round((Number(amt) || 0) * 10 ** TOKEN_DECIMALS);
  const early = !!m && !!cfg && now < earlyBirdUntil(cfg, m);
  const fee = m && cfg ? feeWithDiscounts(cfg.feeBps, early, cfg.earlyBirdDiscountBps, proof) : 0;
  const quote = useMemo(() => (m && a > 0 ? impliedPayout(m, bucket, a, fee) : null), [m, a, bucket, fee]);

  if (Number.isNaN(id)) return <Missing text={t("err.marketNoId")} />;
  if (!m) {
    if (!isError) return <View style={s.center}><ActivityIndicator /></View>;
    // a number no market has (mistyped, or a link cut short) says so in plain words and offers the way back
    const gone = (list.data ? !list.data.some((x) => x.id === id) : false) || /not found|beyond buffer|has no data/i.test(String((error as any)?.message ?? error));
    return <Missing text={gone ? t("err.marketMissing", { id }) : t("err.market", { id, err: String((error as any)?.message ?? error) })} />;
  }

  const copy = metricInfo(m.metric, m.closeTs, m.resolveAfterTs);
  const open = m.status === 0 && now >= m.openTs && now < m.closeTs;
  const win = cfg ? cfg.disputeWindowSecs.toNumber() : null;
  const myPos = positions.data?.find((x: any) => x.market.equals(m.pubkey));
  const myStake = myPos ? myPos.amounts.slice(0, m.nBuckets).reduce((x: number, y: number) => x + y, 0) : 0;
  const tiers = cfg?.feeTiers;
  const label = bucketLabel(m, bucket), color = bucketColor(m, bucket, p.dark);
  const balance = bal.data?.token;

  async function placeBet() {
    if (!m || !cfg || !selectedAccount) return;
    const side = bucket;
    if (a < cfg.minBet.toNumber()) { setMsg({ kind: "err", text: t("bet.min", { amt: fmtAmt(cfg.minBet.toNumber()), tok: TOKEN_SYMBOL }) }); return; }
    // More than the wallet holds stops here, before the wallet asks for a signature; the balance is read again first, so
    // tokens that arrived a moment ago are not refused.
    if (balance != null && a > balance) { const fresh = (await bal.refetch()).data?.token ?? balance; if (a > fresh) { setMsg({ kind: "err", text: t("bet.overBalance", { amt: fmtAmt(fresh), tok: TOKEN_SYMBOL }) }); return; } }
    setBusy(true); onBetting(true); setMsg({ kind: "info", text: t("bet.confirm") }); setInviteNote(null);
    try {
      const account = selectedAccount;
      const hp = await holderProof(connection, programId, account.publicKey, cfg.feeTiers ?? null);
      const { tx, minContextSlot } = await buildPlaceBetTx(connection, account.publicKey, m, side, a, new PublicKey(cfg.mint), hp.accounts);
      let sig: string;
      try {
        sig = await signAndSendTransaction(tx, minContextSlot);
      } catch (e1: any) {
        // Some wallets cancel the session instead of reporting why. Retry with sign-only and broadcast
        // ourselves so a program/simulation error reaches the screen.
        recordError(e1, "bet:signAndSend");
        setMsg({ kind: "info", text: t("app.bet.signOnly") });
        const signed = await signTransaction(tx);
        sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
      }
      setMsg({ kind: "info", text: t("bet.sent"), sig });
      const expiry = { lastValidBlockHeight: tx.lastValidBlockHeight };
      let r = await waitForSignature(connection, sig, { ...expiry, timeoutMs: 60_000, everyMs: 1200 });
      if (r.status === "unknown") {
        // Slow is not failed: the bet can still land, and re-enabling the button here is what used to let a second tap
        // place a second real bet. It stays locked while we keep asking.
        setMsg({ kind: "wait", text: t("bet.slow", { sig: short(sig) }), sig });
        r = await waitForSignature(connection, sig, { ...expiry, timeoutMs: 5 * 60_000, everyMs: 3000, history: true });
      }
      if (r.status === "failed") throw new Error(r.reason);
      if (r.status === "unknown") { setLocked(true); setMsg({ kind: "wait", text: t("bet.unconfirmed", { min: 6, sig: short(sig) }), sig }); return; }
      setMsg({ kind: "ok", text: t("bet.placed", { amt: fmtAmt(a), tok: TOKEN_SYMBOL, b: bucketLabel(m, side) }), sig }); setAmt(""); noteBet(account.publicKey, m, side, a, fee); invalidate();
      // First bet with an invite code waiting: one more signature binds the wallet to it (nothing is charged).
      await applyInvite(account.publicKey.toBase58(), setInviteNote);
    } catch (e: any) {
      recordError(e, "bet");
      const raw = String(e?.message ?? e);
      const friendly = /Cancellation/i.test(raw) ? t("app.bet.cancelled") : /User declined|rejected/i.test(raw) ? t("app.bet.declined") : raw;
      setMsg({ kind: "err", text: friendly + (friendly !== raw ? `\n(${raw})` : "") });
    } finally { setBusy(false); onBetting(false); }
  }

  const quoteBody = !(a > 0) ? <Text style={[s.note, { color: p.dim }]}>{t("bet.enterAmount", { b: label })}</Text>   // a typed "-1" is not quoted as "you receive -1"
    : cfg && a < cfg.minBet.toNumber() ? <Text style={[s.note, { color: p.dim }]}>{t("bet.min", { amt: fmtAmt(cfg.minBet.toNumber()), tok: TOKEN_SYMBOL })}</Text>
    : balance != null && a > balance ? <Text style={[s.note, { color: p.dim }]}>{t("bet.overBalance", { amt: fmtAmt(balance), tok: TOKEN_SYMBOL })}</Text>
    : quote ? (<>
      <Text style={[s.body, { color: p.fg }]}>{t("bet.ifWins", { b: "\u0000" }).split("\u0000")[0]}<Text style={{ fontWeight: "700" }}>{label}</Text>{t("bet.ifWins", { b: "\u0000" }).split("\u0000")[1]}</Text>
      <Text style={[s.big, MONO, { color: p.fg }]}>{fmtAmt(quote.total)} {TOKEN_SYMBOL}</Text>
      <Text style={[s.note, { color: p.dim }]}>{t("bet.breakdown", { stake: fmtAmt(a), losers: fmtAmt(quote.fromLosers), fee: fmtAmt(quote.fee) })}{quote.fromSeed ? ` ${t("bet.plusSeed", { seed: fmtAmt(quote.fromSeed) })}` : ""}. {t("bet.otherLoses", { stake: fmtAmt(a) })}</Text>
    </>) : null;
  const discount = discountLabel(early, proof);

  return (
    <View>
      <View style={s.mtop}><StatusPill m={m} /><Text style={[s.mtopText, { color: p.dim }]}>{t("mkt.n", { id: m.id })}</Text></View>
      <Text style={[s.h1, { color: p.fg }]}>{question(m)}</Text>
      <View style={s.mnow}>
        <Text style={[s.mnowHead, { color: p.accent }]}>{open ? t("mkt.headOpen", { in: inWords(m.closeTs) }) : nextStepHead(m, win)}</Text>
        <Text style={[s.mnowText, { color: p.dim }]}>{t("card.inPot", { amt: fmtAmt(totalPool(m), 0), tok: TOKEN_SYMBOL })}</Text>
        <Text style={[s.mnowText, { color: p.dim }]}>{t(m.positions === 1 ? "card.bettor1" : "card.bettors", { n: m.positions })}</Text>
        {myStake > 0 ? <View style={[s.minepill, { borderColor: p.accent, backgroundColor: p.accentBg }]}><Text style={[s.mnowText, { color: p.fg, fontWeight: "700" }]}>{t("bet.position")}</Text><Text style={[s.mnowText, MONO, { color: p.fg }]}>{fmtAmt(myStake)} {TOKEN_SYMBOL}</Text></View> : null}
        <Text style={[s.mnowText, { color: p.dim }]}>{t("mkt.zoneShort", { z: zoneShort() })}</Text>
      </View>
      <TimelineGrid m={m} disputeWindowSecs={win} />
      <Text style={[s.lead, { color: p.dim }]}>{copy?.how ?? ""}</Text>
      <View style={{ marginBottom: 16 }}><KV p={p} w={92} k={t("mkt.source")} v={copy?.sourceLabel ?? sourceLabel(copy?.source ?? "thirdparty")} /></View>
      <Pools m={m} highlight={m.status >= 1 && m.proposedOutcome !== NO_OUTCOME ? m.proposedOutcome : -1} />
      {/* the wallet's own stake on this market, open or not: whoever comes back to a market they bet on sees it, and so does whoever just bet */}
      {myPos ? <PositionCard m={m} amounts={myPos.amounts} feeW={myPos.feeW} /> : null}

      <Text style={[s.h2, { color: p.dim }]}>{t("mkt.bet")}</Text>
      {!open ? <Text style={[s.note, { color: p.dim }]}>{m.status === 0 && now < m.openTs ? t("bet.notOpen") : t("bet.closed")}</Text> : (
        <View style={{ gap: 12 }}>
          <View style={s.sides}>{m.pools.map((_, i) => { const on = bucket === i, c = bucketColor(m, i, p.dark); return (
            <Pressable key={i} onPress={() => setBucket(i)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[s.side, { backgroundColor: on ? c : p.surface2, borderColor: on ? c : "transparent" }]}>
              <Text style={[s.sideText, { color: on ? "#fff" : p.fg }]}>{bucketLabel(m, i)}</Text>
            </Pressable>); })}</View>
          <View style={s.amtrow}>
            <TextInput value={amt} onChangeText={setAmt} keyboardType="decimal-pad" placeholder={t("bet.amountPh", { tok: TOKEN_SYMBOL })} placeholderTextColor={p.dim} selectionColor={p.accent} style={[s.amt, MONO, { color: p.fg, backgroundColor: p.surface, borderColor: p.line }]} />
            {selectedAccount && balance != null ? <Pressable onPress={() => setAmt(String(Math.floor(balance / 10 ** TOKEN_DECIMALS)))} accessibilityLabel={t("bet.maxTitle", { tok: TOKEN_SYMBOL })} style={[s.btn, { backgroundColor: p.surface, borderColor: p.line }]}><Text style={[s.btnText, { color: p.fg }]}>{t("bet.max")}</Text></Pressable> : null}
          </View>
          {selectedAccount && bal.data ? <Text style={[s.note, { color: p.dim }]}>{t("bet.available")} <Text style={[MONO, { color: p.dim }]}>{fmtAmt(bal.data.token)} {TOKEN_SYMBOL}</Text>{bal.data.sol < 0.002 ? <Text style={{ color: p.no }}>{" · " + t("bet.needSol")}</Text> : null}</Text> : null}
          <View style={[s.quote, { backgroundColor: p.surface2 }]}>{quoteBody}</View>
          {selectedAccount
            ? <Pressable disabled={busy || locked} onPress={placeBet} style={[s.primary, { backgroundColor: color, borderColor: color, opacity: busy || locked ? 0.5 : 1 }]}>{busy ? <ActivityIndicator color="#fff" size={18} /> : <Text style={s.primaryText}>{t("bet.place", { b: label })}</Text>}</Pressable>
            : <Pressable onPress={() => connect().catch((e) => recordError(e, "connect"))} style={[s.primary, { backgroundColor: p.accent, borderColor: p.accent }]}><Text style={s.primaryText}>{t("wallet.connect")}</Text></Pressable>}
          {msg && <View style={[s.msg, msg.kind === "ok" ? { backgroundColor: p.accentBg } : msg.kind === "err" ? { backgroundColor: p.noBg } : null]}><Text style={[s.body, { color: p.fg }]}>{msg.text}</Text></View>}
          {msg?.sig ? <Text style={[s.note, { color: p.accent }]} onPress={() => Linking.openURL(explorerTxUrl(msg.sig!))}>{t("app.bet.explorer")} ↗</Text> : null}
          {inviteNote ? <View style={[s.msg, inviteNote.kind === "ok" ? { backgroundColor: p.accentBg } : inviteNote.kind === "err" ? { backgroundColor: p.noBg } : null]}><Text style={[s.body, { color: p.fg }]}>{inviteNote.text}</Text></View>
            : pendingInvite.data ? <Text style={[s.note, { color: p.dim }]}>{t("app.bet.invitePending", { code: pendingInvite.data })}</Text> : null}
          <Text style={[s.note, { color: p.dim }]}>{t("bet.parimutuel")} <Text style={{ fontWeight: "700", color: p.fg }}>{t("bet.yourFee", { pct: fee / 100 })}</Text>{discount ? ` (${discount})` : ""} {t("bet.feeNote")}</Text>
        </View>
      )}

      <Text style={[s.h2, { color: p.dim }]}>{t("mkt.rules")}</Text>
      <View style={{ gap: 8 }}>
        {cfg && <KV p={p} k={t("mkt.earlyBird")} v={t("mkt.earlyBirdV", { a: (cfg.feeBps - cfg.earlyBirdDiscountBps) / 100, ts: fmtTs(earlyBirdUntil(cfg, m)), b: cfg.feeBps / 100 })} />}
        {tiers ? <KV p={p} k={t("mkt.discounts")} v={<>{`${[tiers.sgtDiscountBps ? t("mkt.sgtDisc", { pct: tiers.sgtDiscountBps / 100 }) : "", stakeRuleText(tiers)].filter(Boolean).join(" · ")}${tiers.minFeeBps ? ` · ${t("mkt.floor", { pct: tiers.minFeeBps / 100 })}` : ""}. ${t("mkt.proven")}`}{IS_TEST ? <Text style={{ color: p.no }}>{" " + t("mkt.devnetNote")}</Text> : null}</>} /> : null}
        <KV p={p} k={t("mkt.proposed")} v={m.proposedAt ? t("mkt.proposedV", { ts: fmtTs(m.proposedAt), v: fmtValue(m.metric, m.proposedValue, m.thresholds), b: bucketLabel(m, m.proposedOutcome) }) : t("mkt.afterClose")} />
        {m.nBuckets > 2 ? <KV p={p} k={t("mkt.ranges")} v={t(rangesFixed(m.metric) ? "mkt.rangesFixed" : "mkt.rangesV")} /> : null}
        {win != null ? <KV p={p} k={t("mkt.dispute")} v={t("mkt.disputeV", { h: win / 3600 })} /> : null}
        <KV p={p} k={t("mkt.snapshots")} v={<Evidence m={m} p={p} />} />
        <KV p={p} k={t("mkt.hash")} v={<Text style={[s.hash, MONO, { color: p.dim }]}>{m.proposedAt ? m.snapshotHash + " " + t("mkt.hashOn") : t("mkt.hashLater")}</Text>} />
        {m.status === 1 && cfg ? <KV p={p} k={t("mkt.disagree")} v={<Dispute m={m} p={p} until={m.proposedAt + cfg.disputeWindowSecs.toNumber()} />} /> : null}
        <KV p={p} k={t("mkt.account")} v={<Text style={[s.hash, MONO, { color: p.dim }]} selectable>{m.pubkey.toBase58()}</Text>} />
      </View>
      <Text style={[s.note, { color: p.accent, marginTop: 24 }]} onPress={() => nav.navigate("Markets")}>{t("nav.all")}</Text>
    </View>
  );
}

function Missing({ text }: { text: string }) {
  const p = usePalette(); const nav = useNavigation<any>();
  return <View style={{ gap: 12 }}><View style={[s.msg, { backgroundColor: p.surface2 }]}><Text style={[s.body, { color: p.fg }]}>{text}</Text></View><Text style={[s.body, { color: p.accent }]} onPress={() => nav.navigate("Markets")}>{t("nav.all")}</Text></View>;
}

/** A label and its value, the label in a column of its own (the website's .kv). */
function KV({ p, k, v, w = 132 }: { p: Palette; k: string; v: React.ReactNode; w?: number }) {
  return (
    <View style={s.kv}>
      <Text style={[s.kvKey, { color: p.dim, width: w }]}>{k}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>{typeof v === "string" ? <Text style={[s.kvVal, { color: p.fg }]}>{v}</Text> : React.isValidElement(v) && (v.type === React.Fragment) ? <Text style={[s.kvVal, { color: p.fg }]}>{v}</Text> : v}</View>
    </View>
  );
}

/** Disagree with a proposed result: the wallet signs a short message; the operator is paged and must re-propose or void
 *  before the window ends. Nothing is charged. */
function Dispute({ m, p, until }: { m: MarketView; p: Palette; until: number }) {
  const { selectedAccount } = useAuthorization(); const { connect, signMessage } = useMobileWallet();
  const [st, setSt] = useState<{ open: boolean; reason: string; claimed: string; msg: string; ok: boolean; busy: boolean }>({ open: false, reason: "", claimed: "", msg: "", ok: false, busy: false });
  const [filed, setFiled] = useState(0);
  useEffect(() => { fetch(`${APP.apiBase}/disputes?market=${m.pubkey.toBase58()}`).then((r) => (r.ok ? r.json() : null)).then((j) => setFiled((j?.disputes ?? []).filter((d: any) => d.status === "open").length)).catch(() => {}); }, [m.pubkey.toBase58()]);
  async function file() {
    if (st.reason.trim().length < 5) { setSt((d) => ({ ...d, msg: t("app.dispute.reasonShort"), ok: false })); return; }
    setSt((d) => ({ ...d, busy: true, msg: t("app.dispute.signing"), ok: false }));
    try {
      const account = selectedAccount ?? (await connect());
      const reason = st.reason.trim().slice(0, 2000), claimed = st.claimed.trim();
      const text = `kubrai-dispute v1\nmarket=${m.pubkey.toBase58()}\nwallet=${account.publicKey.toBase58()}\nclaimed=${claimed}\nreason=${reason}`;
      const sig = await signMessage(new TextEncoder().encode(text));
      const r = await fetch(APP.apiBase + "/dispute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ market: m.pubkey.toBase58(), wallet: account.publicKey.toBase58(), reason, claimedValue: claimed || null, signature: bs58.encode(sig) }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "failed");
      setSt({ open: false, reason: "", claimed: "", msg: t("mkt.disputeDone"), ok: true, busy: false });
    } catch (e: any) { recordError(e, "dispute"); setSt((d) => ({ ...d, busy: false, msg: e?.message ?? String(e), ok: false })); }
  }
  return (
    <View style={{ gap: 8 }}>
      {st.open ? (<>
        <TextInput multiline value={st.reason} onChangeText={(v) => setSt((d) => ({ ...d, reason: v }))} placeholder={t("mkt.disputeWhy")} placeholderTextColor={p.dim} style={[s.input, { color: p.fg, backgroundColor: p.surface, borderColor: p.line, minHeight: 72, textAlignVertical: "top" }]} />
        <TextInput value={st.claimed} onChangeText={(v) => setSt((d) => ({ ...d, claimed: v }))} keyboardType="decimal-pad" placeholder={t("mkt.disputeValue")} placeholderTextColor={p.dim} style={[s.input, { color: p.fg, backgroundColor: p.surface, borderColor: p.line }]} />
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Pressable disabled={st.busy} onPress={file} style={[s.btn, { backgroundColor: p.accent, borderColor: p.accent, opacity: st.busy ? 0.5 : 1 }]}><Text style={[s.btnText, { color: "#fff", fontWeight: "600" }]}>{t("app.dispute.file")}</Text></Pressable>
          <Pressable onPress={() => setSt((d) => ({ ...d, open: false }))} style={[s.btn, { backgroundColor: p.surface, borderColor: p.line }]}><Text style={[s.btnText, { color: p.fg }]}>{t("app.dispute.cancel")}</Text></Pressable>
        </View>
      </>) : <Pressable onPress={() => setSt((d) => ({ ...d, open: true, msg: "" }))} style={[s.btn, { alignSelf: "flex-start", backgroundColor: p.surface, borderColor: p.line }]}><Text style={[s.btnText, { color: p.fg }]}>{t("mkt.disputeBtn")}</Text></Pressable>}
      <Text style={[s.note, { color: p.dim }]}>{t("mkt.disputeNote", { ts: fmtTs(until) })}</Text>
      {filed > 0 && <Text style={[s.note, { color: p.dim }]}>{t("mkt.disputesFiled", { n: filed })}</Text>}
      {!!st.msg && <Text style={[s.body, { color: st.ok ? p.accent : p.no }]}>{st.msg}</Text>}
    </View>
  );
}

/** The hourly snapshots behind this market, with their values, so nobody has to dig through the API. One format
 *  everywhere: "<label> <value> · <snapshot hour, local time> · sha256 <prefix>… · memo tx" (web/src/market.ts loadEvidence). */
function Evidence({ m, p }: { m: MarketView; p: Palette }) {
  const [e, setE] = useState<any>(undefined); const [more, setMore] = useState(false);
  useEffect(() => { fetch(`${APP.apiBase}/evidence?metric=${encodeURIComponent(m.metric)}&open=${m.openTs}&close=${m.closeTs}&baseline=${m.baseline}&id=${m.id}&resolveAfter=${m.resolveAfterTs}`).then((r) => (r.ok ? r.json() : null)).then(setE).catch(() => setE(null)); }, [m.pubkey.toBase58(), m.status, m.proposedAt]);
  if (e === undefined) return <Text style={[s.note, { color: p.dim }]}>{t("common.loading")}</Text>;
  if (!e) return <Text style={[s.note, { color: p.dim }]}>{t("ev.none")}</Text>;
  const fv = (v: number | null | undefined) => (v == null ? "—" : fmtValue(m.metric, v, m.thresholds));
  const link = (text: string, url: string) => <Text style={{ color: p.accent }} onPress={() => Linking.openURL(url)}>{text}</Text>;
  const when = (slot?: string | null) => (!slot ? null : slot === "on-chain" ? <Text>{t("ev.onchainBaseline")}</Text> : link(fmtTsShort(Date.parse(slot + ":00:00Z") / 1000), `${APP.apiBase}/snapshots/${slot}`));
  const row = (key: string, label: string, value: string, x?: any) => (
    <Text key={key} style={[s.evRow, { color: p.dim }]}>
      {label ? <Text style={{ fontWeight: "700" }}>{label} </Text> : null}<Text style={[MONO, { color: p.fg }]}>{value}</Text>
      {x?.slot ? <> · {when(x.slot)}</> : null}
      {x?.sha256 ? <> · sha256 <Text style={MONO}>{x.sha256.slice(0, 12)}…</Text>{x.memo ? <> · {link(t("ev.memo"), explorerTxUrl(x.memo))}</> : null}</> : null}
    </Text>
  );
  const toggle = (label: string) => <Text style={[s.evRow, { color: p.accent }]} onPress={() => setMore((v) => !v)}>{more ? "▾ " : "▸ "}{label}</Text>;
  const rows: React.ReactNode[] = [];
  if (e.kind === "daily") {
    const dayWin = (d: string) => { const st = Date.parse(d + "T00:00:00Z") / 1000; return fmtRange(st, st + 86400); };
    rows.push(row("day", t("ev.dailyDay"), dayWin(e.day)));
    if (e.resolution) rows.push(row("res", t("ev.result"), fv(e.resolution.observed), e.resolution.slot ? { slot: e.resolution.slot } : null));
    else {
      // Not read yet. The source usually shows the day's number long before the market reads it; say when it is read.
      const dayEnd = Date.parse(e.day + "T00:00:00Z") / 1000 + 86400, readAt: number = e.readAt ?? m.resolveAfterTs, wait = fmtWait(readAt - dayEnd);
      rows.push(row("rep", t("ev.dailyReported"), e.reported != null ? fv(e.reported) : t("ev.dailyNotYet", { wait })));
      rows.push(row("read", t("ev.dailyReadAt"), fmtTs(readAt)));
      rows.push(<Text key="note" style={[s.note, { color: p.dim }]}>{t("ev.dailyReadNote", { wait })}</Text>);
    }
    if (e.recent?.length) { rows.push(<React.Fragment key="tg">{toggle(t("ev.dailyRecent"))}</React.Fragment>); if (more) e.recent.forEach(([d, v]: [string, number]) => rows.push(row("r" + d, dayWin(d), fv(v)))); }
    if (e.source) rows.push(<Text key="src" style={[s.note, { color: p.dim }]}>{e.source}</Text>);
  } else if (e.kind === "cum") {
    rows.push(e.opening ? row("open", t("ev.opening"), fv(e.opening.value), e.opening) : row("open", t("ev.opening"), t("ev.notYet")));
    if (e.resolution) { rows.push(row("close", t("ev.closing"), fv(e.closing?.value), e.closing)); rows.push(row("res", t("ev.result"), fv(e.resolution.observed))); }
    else if (e.latest) { rows.push(row("latest", t("ev.latest"), fv(e.latest.value), e.latest)); rows.push(row("sofar", t("ev.soFar"), fv(e.soFar))); }
  } else {
    rows.push(row("n", t("ev.samples"), t("ev.samplesV", { n: e.samples, of: e.expected })));
    if (e.soFar != null) rows.push(row("med", e.resolution ? t("ev.resultMedian") : t("ev.medianSoFar"), fv(e.resolution ? e.resolution.observed : e.soFar)));
    if (e.series?.length) { rows.push(<React.Fragment key="tg">{toggle(t("ev.every"))}</React.Fragment>); if (more) e.series.forEach((x: any, i: number) => rows.push(row("s" + i, "", fv(x.value), x))); }
  }
  return <View style={{ gap: 3 }}>{rows}</View>;
}

const s = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 48 }, center: { paddingVertical: 96, alignItems: "center" },
  mtop: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  mtopText: { fontSize: 13, lineHeight: 18 },
  h1: { fontSize: 21, lineHeight: 28, fontWeight: "700", marginBottom: 6 },
  mnow: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4, marginTop: 4, marginBottom: 16 },
  minepill: { flexDirection: "row", alignItems: "baseline", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10 },
  mnowHead: { fontSize: 14, lineHeight: 21, fontWeight: "700" },
  mnowText: { fontSize: 14, lineHeight: 21 },
  lead: { fontSize: 15, lineHeight: 22, marginBottom: 20 },
  h2: { fontSize: 16, lineHeight: 22, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginTop: 28, marginBottom: 10 },
  kv: { flexDirection: "row", gap: 16 },
  kvKey: { fontSize: 14, lineHeight: 21, fontWeight: "500" },
  kvVal: { fontSize: 14, lineHeight: 21 },
  body: { fontSize: 14, lineHeight: 21 },
  note: { fontSize: 12.5, lineHeight: 18 },
  hash: { fontSize: 12, lineHeight: 18 },
  evRow: { fontSize: 13, lineHeight: 19 },
  sides: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  side: { flexGrow: 1, flexBasis: "40%", borderWidth: 2, borderRadius: 6, paddingVertical: 12, paddingHorizontal: 8, alignItems: "center" },
  sideText: { fontSize: 14, lineHeight: 18, fontWeight: "600", textAlign: "center" },
  amtrow: { flexDirection: "row", gap: 8 },
  amt: { flex: 1, minWidth: 0, fontSize: 15, borderWidth: 1, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 12 },
  input: { fontSize: 14, borderWidth: 1, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 10 },
  btn: { borderWidth: 1, borderRadius: 6, paddingVertical: 9, paddingHorizontal: 14, justifyContent: "center" },
  btnText: { fontSize: 14, lineHeight: 20 },
  quote: { borderRadius: 8, padding: 12, gap: 4 },
  big: { fontSize: 20, lineHeight: 28 },
  primary: { borderWidth: 1, borderRadius: 6, paddingVertical: 12, paddingHorizontal: 14, alignItems: "center", minHeight: 46, justifyContent: "center" },
  primaryText: { color: "#fff", fontSize: 15, lineHeight: 20, fontWeight: "600", textAlign: "center" },
  msg: { borderRadius: 6, paddingVertical: 10, paddingHorizontal: 12 },
});
