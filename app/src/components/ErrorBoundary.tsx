import React from "react";
import { ScrollView, Text, View } from "react-native";
// Last line of defence: a JS exception during render shows this screen instead of a silent crash.
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: any }> {
  state = { error: null as any };
  static getDerivedStateFromError(error: any) { return { error }; }
  componentDidCatch(error: any) { try { require("../utils/errorLog").recordError(error, "render"); } catch {} }
  render() {
    if (!this.state.error) return this.props.children;
    const e = this.state.error; const shims = (globalThis as any).__polyfillErrors ?? [];
    return (
      <ScrollView style={{ flex: 1, backgroundColor: "#15171b" }} contentContainerStyle={{ padding: 20, paddingTop: 60 }}>
        <Text style={{ color: "#d9dce3", fontSize: 20, fontWeight: "700", marginBottom: 8 }}>Kubrai hit an error</Text>
        <Text style={{ color: "#d9826b", marginBottom: 12 }} selectable>{String(e?.message ?? e)}</Text>
        <Text style={{ color: "#8c919c", fontFamily: "monospace", fontSize: 11 }} selectable>{String(e?.stack ?? "").split("\n").slice(0, 14).join("\n")}</Text>
        {shims.length > 0 && <View style={{ marginTop: 16 }}><Text style={{ color: "#8c919c" }}>Startup shim failures:</Text>{shims.map((s: string, i: number) => <Text key={i} style={{ color: "#8c919c", fontSize: 11 }} selectable>{s}</Text>)}</View>}
        <Text style={{ color: "#8c919c", marginTop: 16 }}>Screenshot this and send it via Settings → Send feedback (or just tell me what it says).</Text>
      </ScrollView>
    );
  }
}
