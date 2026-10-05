import React, { useState } from "react";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import { Button, Text, TextInput, useTheme } from "react-native-paper";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthorization } from "../utils/useAuthorization";
import { APP } from "../config";
import { lastErrors } from "../utils/errorLog";
import { t } from "../i18n";

export function FeedbackScreen() {
  const theme = useTheme(); const insets = useSafeAreaInsets(); const { selectedAccount } = useAuthorization();
  const [note, setNote] = useState(""); const [img, setImg] = useState<{ uri: string; mime: string; w?: number; h?: number } | null>(null);
  // `ok` marks the thank-you line: the words differ per language, so its colour cannot be told from the text
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(""); const [ok, setOk] = useState(false);

  async function pick() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setOk(false); setMsg(t("app.fb.denied")); return; }
    // No base64 here: the picker returns instantly and the preview shows at once; the file is read only when sending.
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6, allowsMultipleSelection: false });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    const a = r.assets[0]; setImg({ uri: a.uri, mime: a.mimeType ?? "image/jpeg", w: a.width, h: a.height }); setMsg(""); setOk(false);
  }
  async function send() {
    if (!note.trim() && !img) { setOk(false); setMsg(t("app.fb.empty")); return; }
    setBusy(true); setOk(false); setMsg(img ? t("app.fb.reading") : t("fb.sending"));
    try {
      const base64 = img ? await FileSystem.readAsStringAsync(img.uri, { encoding: FileSystem.EncodingType.Base64 }) : null;
      setMsg(t("fb.sending"));
      const diagnostics = { app: Constants.expoConfig?.version, cluster: APP.cluster, insets: { top: insets.top, bottom: insets.bottom }, structuredClone: typeof (globalThis as any).structuredClone, textDecoder: typeof (globalThis as any).TextDecoder, hermes: typeof (globalThis as any).HermesInternal === "object", errors: lastErrors() };
      const r = await fetch(APP.apiBase + "/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note, diagnostics, wallet: selectedAccount?.publicKey.toBase58() ?? null, image: base64, imageType: img?.mime ?? null }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "failed");
      setOk(true); setMsg(t("app.fb.sent", { id: j.id.slice(0, 19) })); setNote(""); setImg(null);
    } catch (e: any) { setMsg(e?.message ?? String(e)); } finally { setBusy(false); }
  }
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text variant="headlineSmall">{t("app.fb.title")}</Text>
      <Text style={styles.dim}>{t("app.fb.lead")}</Text>
      <TextInput mode="outlined" multiline numberOfLines={4} value={note} onChangeText={setNote} placeholder={t("app.fb.ph")} />
      <View style={styles.row}>
        <Button mode="outlined" icon="image" onPress={pick}>{img ? t("app.fb.change") : t("app.fb.add")}</Button>
        {img && <Button compact onPress={() => setImg(null)}>{t("app.common.remove")}</Button>}
      </View>
      {img && <View style={{ gap: 4 }}><Image source={{ uri: img.uri }} style={{ width: 180, height: img.w && img.h ? Math.round((180 * img.h) / img.w) : 360, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.outlineVariant }} resizeMode="cover" /><Text variant="labelSmall" style={styles.dim}>{t("app.fb.attached")}{img.w ? ` · ${img.w}×${img.h}` : ""}</Text></View>}
      <Button mode="contained" loading={busy} disabled={busy} onPress={send}>{t("fb.send")}</Button>
      {!!msg && <Text style={{ color: ok ? "#0f8f7c" : busy ? undefined : theme.colors.error }}>{msg}</Text>}
    </ScrollView>
  );
}
const styles = StyleSheet.create({ screen: { padding: 16, gap: 12, paddingBottom: 48 }, row: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }, dim: { opacity: 0.7 } });
