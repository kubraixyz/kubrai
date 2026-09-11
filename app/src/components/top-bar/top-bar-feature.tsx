import { StyleSheet } from "react-native";
import { Appbar, Button, useTheme } from "react-native-paper";
import { TopBarWalletButton, TopBarWalletMenu } from "./top-bar-ui";
import { useNavigation } from "@react-navigation/core";

export function TopBar() {
  const navigation = useNavigation();
  const theme = useTheme();

  return (
    <Appbar.Header mode="small" style={styles.topBar}>
      <Appbar.Content title="Kubrai" titleStyle={{ fontWeight: "700", letterSpacing: 0.5 }} />
      <TopBarWalletMenu />

      <Button mode="outlined" compact icon="cog" textColor={theme.colors.onSurface} onPress={() => navigation.navigate("Settings")} style={{ marginRight: 8 }}>
        Settings
      </Button>
    </Appbar.Header>
  );
}

const styles = StyleSheet.create({
  topBar: {
    justifyContent: "space-between",
    alignItems: "center",
  },
});
