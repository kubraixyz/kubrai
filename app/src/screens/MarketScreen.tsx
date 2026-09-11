import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { ActivityIndicator, Button, Chip, Divider, Text, TextInput, useTheme } from "react-native-paper";
import { useRoute } from "@react-navigation/native";
import { PublicKey } from "@solana/web3.js";
import { useBalances, useConfig, useInvalidateAll, useMarket, usePositions } from "../hooks/useKubrai";
import { metricInfo, metricLabel, fmtValue, SOURCE_LABEL } from "../chain/metrics";
import { PoolBar } from "../components/PoolBar";
import { bucketColor, bucketLabel, fmtAmt, fmtTs, statusLabel, timeLeft } from "../chain/format";
import { NO_OUTCOME, buildPlaceBetTx, confirmBySig, currentFeeBps, impliedPayout } from "../chain/kubrai";
import { useConnection } from "../utils/ConnectionProvider";
import { useAuthorization } from "../utils/useAuthorization";
import { useMobileWallet } from "../utils/useMobileWallet";
import { TOKEN_DECIMALS, TOKEN_SYMBOL } from "../config";

export function MarketScreen() {
  const { params } = useRoute<any>(); const id = Number(params?.id);
  const theme = useTheme(); const { connection } = useConnection();
  const { selectedAccount } = useAuthorization(); const { connect, signAndSendTransaction } = useMobileWallet();
  const { data: m, isLoading } = useMarket(id); const { data: cfg } = useConfig(); const bal = useBalances(); const positions = usePositions(); const invalidate = useInvalidateAll();
  const [bucket, setBucket] = useState(0); const [amt, setAmt] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const info = m ? metricInfo(m.metric) : undefined;
  const fee = m && cfg ? currentFeeBps(cfg, m) : 0;
  const open = !!m && m.status === 0 && Date.now() / 1000 >= m.openTs && Date.now() / 1000 < m.closeTs;
  const a = Math.round((Number(amt) || 0) * 10 ** TOKEN_DECIMALS);
  const quote = useMemo(() => (m && a ? impliedPayout(m, bucket, a, fee) : null), [m, a, bucket, fee]);
  const myPos = positions.data?.find((p) => m && p.market.equals(m.pubkey));

  async function placeBet() {
    if (!m || !cfg) return;
    if (a < cfg.minBet.toNumber()) { setMsg({ kind: "err", text: `Minimum bet is ${fmtAmt(cfg.minBet.toNumber())} ${TOKEN_SYMBOL}.` }); return; }
    setBusy(true); setMsg({ kind: "info", text: "Confirm in your wallet…" });
    try {
      const account = selectedAccount ?? (await connect());
      const { tx, minContextSlot } = await buildPlaceBetTx(connection, account.publicKey, m, bucket, a, new PublicKey(cfg.mint));
      const sig = await signAndSendTransaction(tx, minContextSlot);
      setMsg({ kind: "info", text: "Sent. Waiting for confirmation…" });
      await confirmBySig(connection, sig);
      setMsg({ kind: "ok", text: `Bet placed: ${fmtAmt(a)} ${TOKEN_SYMBOL} on “${bucketLabel(m, bucket)}”.` }); setAmt(""); invalidate();
    } catch (e: any) { setMsg({ kind: "err", text: e?.message ?? String(e) }); } finally { setBusy(false); }
  }

  if (isLoading || !m) return <View style={styles.center}><ActivityIndicator /></View>;
  const highlight = m.status >= 1 && m.proposedOutcome !== NO_OUTCOME ? m.proposedOutcome : -1;
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.row}><Chip compact mode="outlined">{statusLabel(m)}</Chip><Text variant="labelSmall" style={styles.dim}>Market #{m.id} · {m.status === 0 ? timeLeft(m.closeTs) : ""}</Text></View>
      <Text variant="headlineSmall" style={{ marginVertical: 8 }}>{m.nBuckets === 2 ? `${metricLabel(m.metric)} ≥ ${fmtValue(m.metric, m.thresholds[0])}?` : `${metricLabel(m.metric)}: which range?`}</Text>
      <Text variant="bodyMedium" style={[styles.dim, { marginBottom: 10 }]}>{info?.how}</Text>
      <KV k={info?.cumulative ? "Baseline at open" : "Value at open"} v={fmtValue(m.metric, m.baseline)} />
      <KV k="Data source" v={SOURCE_LABEL[info?.source ?? "thirdparty"]} />
      <View style={{ marginVertical: 12 }}><PoolBar m={m} highlight={highlight} /></View>

      <Text variant="titleMedium" style={styles.h2}>BET</Text>
      {!open ? <Text style={styles.dim}>{m.status === 0 && Date.now() / 1000 < m.openTs ? "Betting has not opened yet." : "Betting is closed for this market."}</Text> : (
        <View style={{ gap: 10 }}>
          <View style={styles.buckets}>{m.pools.map((_, i) => (
            <Button key={i} mode={bucket === i ? "contained" : "contained-tonal"} buttonColor={bucket === i ? bucketColor(m, i) : undefined} textColor={bucket === i ? "#fff" : undefined} onPress={() => setBucket(i)} style={styles.bucketBtn} compact>{bucketLabel(m, i)}</Button>
          ))}</View>
          <View style={styles.row}>
            <TextInput mode="outlined" keyboardType="numeric" value={amt} onChangeText={setAmt} placeholder={`Amount in ${TOKEN_SYMBOL}`} style={{ flex: 1 }} dense />
            {bal.data ? <Button mode="outlined" compact onPress={() => setAmt(String(Math.floor(bal.data!.token / 10 ** TOKEN_DECIMALS)))}>Max</Button> : null}
          </View>
          {bal.data && <Text variant="labelSmall" style={styles.dim}>Available: {fmtAmt(bal.data.token)} {TOKEN_SYMBOL} · {bal.data.sol.toFixed(3)} SOL{bal.data.sol < 0.002 ? "  ⚠ you need a little SOL for the network fee" : ""}</Text>}
          <View style={[styles.quote, { backgroundColor: theme.colors.elevation.level2 }]}>
            {quote ? (<>
              <Text variant="labelMedium">If “{bucketLabel(m, bucket)}” wins you receive</Text>
              <Text variant="headlineSmall" style={styles.mono}>{fmtAmt(quote.total)} {TOKEN_SYMBOL}</Text>
              <Text variant="bodySmall" style={styles.dim}>= your {fmtAmt(a)} back + {fmtAmt(quote.fromLosers)} from the losing pools − {fmtAmt(quote.fee)} fee{quote.fromSeed ? ` + ${fmtAmt(quote.fromSeed)} house prize (fee-free)` : ""}. Any other outcome loses {fmtAmt(a)}.</Text>
            </>) : <Text variant="bodySmall" style={styles.dim}>Enter an amount to see the payout if “{bucketLabel(m, bucket)}” wins.</Text>}
          </View>
          <Button mode="contained" buttonColor={bucketColor(m, bucket)} textColor="#fff" loading={busy} disabled={busy} onPress={placeBet}>{selectedAccount ? `Place bet on “${bucketLabel(m, bucket)}”` : "Connect wallet & bet"}</Button>
          {msg && <Text style={{ color: msg.kind === "err" ? theme.colors.error : msg.kind === "ok" ? "#0f8f7c" : undefined }}>{msg.text}</Text>}
          <Text variant="bodySmall" style={styles.dim}>Parimutuel: the quote assumes pools stay as they are. Fee ({fee / 100}%) applies to winnings only and is locked in at the time of this bet.</Text>
          {myPos && <KV k="Your position" v={myPos.amounts.slice(0, m.nBuckets).map((x, i) => (x ? `${bucketLabel(m, i)}: ${fmtAmt(x)}` : "")).filter(Boolean).join(" · ") + " " + TOKEN_SYMBOL} />}
        </View>
      )}

      <Divider style={{ marginVertical: 16 }} />
      <Text variant="titleMedium" style={styles.h2}>SCHEDULE</Text>
      <KV k="Betting opens" v={fmtTs(m.openTs)} />
      <KV k="Betting closes" v={fmtTs(m.closeTs)} />
      {cfg && <KV k="Early-bird fee" v={`${(cfg.feeBps - cfg.earlyBirdDiscountBps) / 100}% on winnings until ${fmtTs(m.openTs + cfg.earlyBirdSecs.toNumber())}, then ${cfg.feeBps / 100}%`} />}
      <KV k="Result proposed" v={m.proposedAt ? `${fmtTs(m.proposedAt)} · observed ${fmtValue(m.metric, m.proposedValue)} → ${bucketLabel(m, m.proposedOutcome)}` : "after close"} />
      {m.nBuckets > 2 && <KV k="How ranges are set" v="Cut at the quantiles of the last 12 weekly values, so every range started out roughly equally likely." />}
      {cfg && <KV k="Dispute window" v={`${cfg.disputeWindowSecs.toNumber() / 3600} h after the proposal; anyone can then finalize`} />}
      <KV k="Snapshot hash" v={m.proposedAt ? m.snapshotHash : "—"} mono />
      <KV k="Market account" v={m.pubkey.toBase58()} mono />
    </ScrollView>
  );
}
function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <View style={styles.kv}><Text variant="labelMedium" style={[styles.dim, { width: 120 }]}>{k}</Text><Text variant="bodyMedium" style={[{ flex: 1 }, mono && { fontSize: 11, fontFamily: "monospace" }]}>{v}</Text></View>;
}
const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 48 }, center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }, dim: { opacity: 0.7 }, mono: { fontVariant: ["tabular-nums"] },
  h2: { letterSpacing: 1, opacity: 0.7, marginBottom: 8, fontSize: 13 }, kv: { flexDirection: "row", gap: 12, marginBottom: 6 },
  buckets: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, bucketBtn: { flexGrow: 1, flexBasis: "45%" }, quote: { borderRadius: 8, padding: 12, gap: 2 },
});
