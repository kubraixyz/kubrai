// Polyfills first.
import "./src/polyfills";

import React, { useEffect, useState } from "react";
import { StyleSheet, useColorScheme } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PaperProvider } from "react-native-paper";
import { ConnectionProvider } from "./src/utils/ConnectionProvider";
import { AppNavigator } from "./src/navigators/AppNavigator";
import { ClusterProvider } from "./src/components/cluster/cluster-data-access";
import { KubraiDark, KubraiLight } from "./src/theme";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { getLang, loadSavedLang, onLang } from "./src/i18n";

const queryClient = new QueryClient();

/** The language picked in Settings is read before the first screen is drawn (a few milliseconds), so nothing shows in the
 *  phone's language first. A switch redraws every screen in the new language: the tree under it is keyed by language,
 *  and the navigator keeps its place (AppNavigator). */
function LangGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false); const [lang, setL] = useState(getLang());
  useEffect(() => { const off = onLang(setL); loadSavedLang().finally(() => { setL(getLang()); setReady(true); }); return off; }, []);
  return ready ? <React.Fragment key={lang}>{children}</React.Fragment> : null;
}

export default function App() {
  const theme = useColorScheme() === "dark" ? KubraiDark : KubraiLight;
  return (
    <ErrorBoundary>
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ClusterProvider>
          <ConnectionProvider config={{ commitment: "confirmed" }}>
            <PaperProvider theme={theme}>
              {/* Top edge only: the bottom tab bar reads the inset itself via SafeAreaProvider. */}
              <SafeAreaView edges={["top"]} style={[styles.shell, { backgroundColor: theme.colors.background }]}>
                <LangGate><AppNavigator theme={theme} /></LangGate>
              </SafeAreaView>
            </PaperProvider>
          </ConnectionProvider>
        </ClusterProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
    </ErrorBoundary>
  );
}
const styles = StyleSheet.create({ shell: { flex: 1 } });
