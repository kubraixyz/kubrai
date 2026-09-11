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

export function FeedbackScreen() {
  const theme = useTheme(); const insets = useSafeAreaInsets(); const { selectedAccount } = useAuthorization();
  const [note, setNote] = useState(""); const [img, setImg] = useState<{ uri: string; mime: string; w?: number; h?: number } | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");

  async function pick() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setMsg("Photo access was denied."); return; }
    // No base64 here: the picker returns instantly and the preview shows at once; the file is read only when sending.
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6, allowsMultipleSelection: false });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    const a = r.assets[0]; setImg({ uri: a.uri, mime: a.mimeType ?? "image/jpeg", w: a.width, h: a.height }); setMsg("");
  }
  async function send() {
    if (!note.trim() && !img) { setMsg("Add a note or a screenshot first."); return; }
    setBusy(true); setMsg(img ? "Reading screenshot…" : "Sending…");
    try {
      const base64 = img ? await FileSystem.readAsStringAsync(img.uri, { encoding: FileSystem.EncodingType.Base64 }) : null;
      setMsg("Sending…");
      const diagnostics = { app: Constants.expoConfig?.version, cluster: APP.cluster, insets: { top: insets.top, bottom: insets.bottom }, structuredClone: typeof (globalThis as any).structuredClone, textDecoder: typeof (globalThis as any).TextDecoder, hermes: typeof (globalThis as any).HermesInternal === "object", errors: lastErrors() };
      const r = await fetch(APP.apiBase + "/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note, diagnostics, wallet: selectedAccount?.publicKey.toBase58() ?? null, image: base64, imageType: img?.mime ?? null }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "failed");
      setMsg(`Sent. Thank you — report ${j.id.slice(0, 19)}.`); setNote(""); setImg(null);
    } catch (e: any) { setMsg(e?.message ?? String(e)); } finally { setBusy(false); }
  }
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text variant="headlineSmall">Send feedback</Text>
      <Text style={styles.dim}>A screenshot plus one line is enough. Version, network and recent errors are attached automatically.</Text>
      <TextInput mode="outlined" multiline numberOfLines={4} value={note} onChangeText={setNote} placeholder="What happened? What did you expect?" />
      <View style={styles.row}>
        <Button mode="outlined" icon="image" onPress={pick}>{img ? "Change screenshot" : "Add screenshot"}</Button>
        {img && <Button compact onPress={() => setImg(null)}>Remove</Button>}
      </View>
      {img && <View style={{ gap: 4 }}><Image source={{ uri: img.uri }} style={{ width: 180, height: img.w && img.h ? Math.round((180 * img.h) / img.w) : 360, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.outlineVariant }} resizeMode="cover" /><Text variant="labelSmall" style={styles.dim}>Attached{img.w ? ` · ${img.w}×${img.h}` : ""}</Text></View>}
      <Button mode="contained" loading={busy} disabled={busy} onPress={send}>Send</Button>
      {!!msg && <Text style={{ color: /Sent/.test(msg) ? "#0f8f7c" : theme.colors.error }}>{msg}</Text>}
    </ScrollView>
  );
}
const styles = StyleSheet.create({ screen: { padding: 16, gap: 12, paddingBottom: 48 }, row: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }, dim: { opacity: 0.7 } });
