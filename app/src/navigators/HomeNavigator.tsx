import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import React from "react";
import MaterialCommunityIcon from "@expo/vector-icons/MaterialCommunityIcons";
import { useTheme } from "react-native-paper";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TopBar } from "../components/top-bar/top-bar-feature";
import { MarketsScreen } from "../screens/MarketsScreen";
import { MyBetsScreen } from "../screens/MyBetsScreen";
import { LeaderboardScreen } from "../screens/LeaderboardScreen";

const Tab = createBottomTabNavigator();
export function HomeNavigator() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Android 15 apps draw edge-to-edge; if the inset comes back 0 we still keep the labels off the screen edge.
  const bottom = Math.max(insets.bottom, Platform.OS === "android" ? 16 : 0);
  return (
    <Tab.Navigator screenOptions={({ route }) => ({
      header: () => <TopBar />,
      tabBarActiveTintColor: theme.colors.primary,
      tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
      tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outlineVariant, height: 60 + bottom, paddingBottom: bottom },
      tabBarItemStyle: { paddingVertical: 6, justifyContent: "center" },
      tabBarLabelStyle: { fontSize: 12, marginTop: 2 },
      tabBarIconStyle: { marginTop: 2 },
      tabBarIcon: ({ focused, color, size }) => <MaterialCommunityIcon name={route.name === "Markets" ? (focused ? "chart-box" : "chart-box-outline") : route.name === "Ranks" ? (focused ? "trophy" : "trophy-outline") : focused ? "ticket-confirmation" : "ticket-confirmation-outline"} size={size} color={color} />,
    })}>
      <Tab.Screen name="Markets" component={MarketsScreen} />
      <Tab.Screen name="My bets" component={MyBetsScreen} />
      <Tab.Screen name="Ranks" component={LeaderboardScreen} />
    </Tab.Navigator>
  );
}
