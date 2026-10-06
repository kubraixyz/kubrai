// The invite card, as the website's invite page draws it (web/src/invite.ts): the link, four numbers (invited, your
// share, earned, your points), how far the next share is, the earnings split, payouts, and how it works with the table
// of shares (20% from the first bet, 25% from 10,000 points, 30% from 100,000). `data` is the API's /referral/<wallet>;
// null without a wallet.
import React, { useState } from "react";
import { Linking, Share, StyleSheet, View } from "react-native";
import { Button, Text } from "react-native-paper";
import * as Clipboard from "expo-clipboard";
import { t } from "../i18n";
import { fmtTs } from "../chain/time";
import { explorerTxUrl } from "../chain/explorer";
import { TOKEN_SYMBOL } from "../config";
import { MONO, usePalette } from "./palette";

const pct = (bps: number) => (bps / 100).toFixed(0) + "%";
const amt = (v: number) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const DEFAULT_TIERS = [{ points: 0, bps: 2000 }, { points: 10_000, bps: 2500 }, { points: 100_000, bps: 3000 }];

export function InviteCard({ data, wallet, loading }: { data: any | null; wallet: boolean; loading?: boolean }) {
  const p = usePalette(); const [copied, setCopied] = useState("");
  const note = (s: string, extra?: object) => <Text style={[s_.note, { color: p.dim }, extra]}>{s}</Text>;
  const body = !wallet ? note(t("inv.connect")) : loading || !data ? note(t("common.loading")) : data.error ? note(String(data.error)) : (
    <View style={{ gap: 10 }}>
      <Text variant="titleSmall">{t("inv.yourLink")}</Text>
      {data.eligible && data.link ? (<>
        <Text style={[MONO, { fontSize: 13, color: p.fg }]} selectable>{data.link}</Text>
        <View style={s_.row}>
          <Button mode="contained" icon="share-variant" onPress={() => Share.share({ message: t("app.set.shareMsg", { link: data.link }) }).catch(() => {})}>{t("app.set.share")}</Button>
          <Button mode="outlined" icon="content-copy" onPress={async () => { try { await Clipboard.setStringAsync(data.link); setCopied(t("common.copied")); } catch { setCopied(data.link); } setTimeout(() => setCopied(""), 2000); }}>{t("inv.copy")}</Button>
        </View>
        {!!copied && note(copied)}
        {note(t("inv.code", { code: data.code }))}
      </>) : <View style={[s_.msg, { backgroundColor: p.surface2 }]}><Text style={{ color: p.fg }}>{t("inv.locked")}</Text></View>}
      <View style={s_.stats}>
        {[[t("inv.invited"), String(Number(data.referred ?? 0))], [t("inv.share"), pct(Number(data.tierBps ?? 2000))], [t("inv.earned"), `${amt(data.earned ?? 0)} ${TOKEN_SYMBOL}`], [t("inv.points"), Math.round(Number(data.points ?? 0)).toLocaleString("en-US")]].map(([k, v]) => (
          <View key={k} style={[s_.stat, { backgroundColor: p.surface2 }]}><Text style={[s_.statLabel, { color: p.dim }]}>{k}</Text><Text style={[s_.statNum, MONO, { color: p.fg }]}>{v}</Text></View>
        ))}
      </View>
      {data.nextTier ? note(t("inv.next", { n: (data.nextTier.points - data.points).toLocaleString("en-US", { maximumFractionDigits: 0 }), pct: pct(data.nextTier.bps) })) : null}
      {data.bound ? note(t("inv.joined", { code: data.bound.code, who: data.bound.referrer, pct: pct(data.refereeBps ?? 1000) })) : null}
      <Text variant="titleSmall" style={{ marginTop: 6 }}>{t("inv.earnings")}</Text>
      {[[t("inv.asInviter"), data.asReferrer], [t("inv.asInvitee"), data.asReferee], [t("inv.paid"), data.paid], [t("inv.owed"), data.owed]].map(([k, v]) => (
        <View key={String(k)} style={s_.kv}><Text style={[s_.kvKey, { color: p.dim }]}>{k}</Text><Text style={[MONO, s_.kvVal, { color: p.fg }]}>{amt(Number(v ?? 0))} {TOKEN_SYMBOL}</Text></View>
      ))}
      {note(t("inv.payNote", { tok: TOKEN_SYMBOL }))}
      {(data.payouts ?? []).length ? <Text style={[s_.note, { color: p.dim }]}>{t("inv.lastPayouts")} {(data.payouts as any[]).slice(0, 5).map((x, i) => (
        <Text key={i}>{i ? " · " : ""}{amt(x.amount)} {TOKEN_SYMBOL} <Text style={{ color: p.accent }} onPress={() => Linking.openURL(explorerTxUrl(x.signature))}>tx</Text> ({fmtTs(Date.parse(x.at) / 1000)})</Text>
      ))}</Text> : null}
    </View>
  );
  return <View style={{ gap: 12 }}>{body}<HowItWorks data={wallet ? data : null} /></View>;
}

/** The three steps and the table of shares by all-time points; the wallet's own row is marked. */
function HowItWorks({ data }: { data: any | null }) {
  const p = usePalette();
  const tiers: { points: number; bps: number }[] = data?.tiers ?? DEFAULT_TIERS, refereeBps = data?.refereeBps ?? 1000;
  return (
    <View style={{ gap: 8 }}>
      <Text variant="titleSmall">{t("inv.how")}</Text>
      {[t("inv.how1"), t("inv.how2", { pct: pct(refereeBps) }), t("inv.how3", { tok: TOKEN_SYMBOL, amt: amt(10 * 3 * (tiers[0].bps / 10000)) })].map((s, i) => (
        <View key={i} style={s_.step}><Text style={[s_.stepNo, { color: p.dim }]}>{i + 1}.</Text><Text style={[s_.body, { color: p.fg, flex: 1 }]}>{s}</Text></View>
      ))}
      <View style={[s_.table, { borderColor: p.line }]}>
        <View style={[s_.tr, { borderBottomColor: p.line, borderBottomWidth: 1 }]}><Text style={[s_.th, { color: p.dim, flex: 1 }]}>{t("inv.colAllTime")}</Text><Text style={[s_.th, { color: p.dim, textAlign: "right" }]}>{t("inv.colShare")}</Text></View>
        {tiers.map((x) => { const mine = !!data && x.bps === data.tierBps; return (
          <View key={x.points} style={[s_.tr, mine && { backgroundColor: p.accentBg }]}>
            <Text style={[s_.td, { color: p.fg, flex: 1 }]}>{x.points ? t("inv.tierFrom", { n: x.points.toLocaleString("en-US") }) : t("inv.tierFirst")}</Text>
            <Text style={[s_.td, MONO, { color: p.fg, fontWeight: "700" }]}>{pct(x.bps)}</Text>
          </View>); })}
      </View>
    </View>
  );
}

const s_ = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  note: { fontSize: 12.5, lineHeight: 18 },
  body: { fontSize: 14, lineHeight: 20 },
  msg: { borderRadius: 6, paddingVertical: 10, paddingHorizontal: 12 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { flexGrow: 1, flexBasis: "45%", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
  statLabel: { fontSize: 12, lineHeight: 16 },
  statNum: { fontSize: 18, lineHeight: 24, fontWeight: "700" },
  kv: { flexDirection: "row", gap: 12 },
  kvKey: { fontSize: 14, lineHeight: 20, flex: 1 },
  kvVal: { fontSize: 14, lineHeight: 20 },
  step: { flexDirection: "row", gap: 6 },
  stepNo: { fontSize: 14, lineHeight: 20, width: 18 },
  table: { borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  tr: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 10, gap: 12 },
  th: { fontSize: 12.5, lineHeight: 18, fontWeight: "600" },
  td: { fontSize: 14, lineHeight: 20 },
});
