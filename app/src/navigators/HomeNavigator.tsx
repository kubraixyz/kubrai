import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import React from "react";
import MaterialCommunityIcon from "@expo/vector-icons/MaterialCommunityIcons";
import { TopBar } from "../components/top-bar/top-bar-feature";
import { MarketsScreen } from "../screens/MarketsScreen";
import { MyBetsScreen } from "../screens/MyBetsScreen";

const Tab = createBottomTabNavigator();
export function HomeNavigator() {
  return (
    <Tab.Navigator screenOptions={({ route }) => ({
      header: () => <TopBar />,
      tabBarIcon: ({ focused, color, size }) => <MaterialCommunityIcon name={route.name === "Markets" ? (focused ? "chart-box" : "chart-box-outline") : focused ? "ticket-confirmation" : "ticket-confirmation-outline"} size={size} color={color} />,
    })}>
      <Tab.Screen name="Markets" component={MarketsScreen} />
      <Tab.Screen name="My bets" component={MyBetsScreen} />
    </Tab.Navigator>
  );
}
