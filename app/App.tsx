// Polyfills first.
import "./src/polyfills";

import { StyleSheet, useColorScheme } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PaperProvider } from "react-native-paper";
import { ConnectionProvider } from "./src/utils/ConnectionProvider";
import { AppNavigator } from "./src/navigators/AppNavigator";
import { ClusterProvider } from "./src/components/cluster/cluster-data-access";
import { KubraiDark, KubraiLight } from "./src/theme";

const queryClient = new QueryClient();

export default function App() {
  const theme = useColorScheme() === "dark" ? KubraiDark : KubraiLight;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ClusterProvider>
          <ConnectionProvider config={{ commitment: "confirmed" }}>
            <PaperProvider theme={theme}>
              {/* Top edge only: the bottom tab bar reads the inset itself via SafeAreaProvider. */}
              <SafeAreaView edges={["top"]} style={[styles.shell, { backgroundColor: theme.colors.background }]}>
                <AppNavigator theme={theme} />
              </SafeAreaView>
            </PaperProvider>
          </ConnectionProvider>
        </ClusterProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({ shell: { flex: 1 } });
