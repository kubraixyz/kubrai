/**
 * The app navigator (formerly "AppNavigator" and "MainNavigator") is used for the primary
 * navigation flows of your app.
 */
import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
  NavigationContainer,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React, { useEffect, useRef, useState } from "react";
import { Appearance, BackHandler, useColorScheme } from "react-native";
import * as Screens from "../screens";
import { HomeNavigator } from "./HomeNavigator";
import { StatusBar } from "expo-status-bar";
import {
  Button,
  Dialog,
  MD3DarkTheme,
  MD3LightTheme,
  Portal,
  Text,
  adaptNavigationTheme,
} from "react-native-paper";
import { NavigationContainerRef } from "@react-navigation/native";

/**
 * This type allows TypeScript to know what routes are defined in this navigator
 * as well as what properties (if any) they might take when navigating to them.
 *
 * If no params are allowed, pass through `undefined`.
 *
 * For more information, see this documentation:
 *   https://reactnavigation.org/docs/params/
 *   https://reactnavigation.org/docs/typescript#type-checking-the-navigator
 *   https://reactnavigation.org/docs/typescript/#organizing-types
 *
 */

type RootStackParamList = {
  Home: undefined;
  Settings: undefined;
  Market: { id: number };
  Feedback: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

// Documentation: https://reactnavigation.org/docs/stack-navigator/
const Stack = createNativeStackNavigator();

const AppStack = () => {
  return (
    <Stack.Navigator initialRouteName={"HomeStack"}>
      <Stack.Screen
        name="HomeStack"
        component={HomeNavigator}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="Settings" component={Screens.SettingsScreen} />
      <Stack.Screen name="Market" component={Screens.MarketScreen} options={{ title: "Market" }} />
      <Stack.Screen name="Feedback" component={Screens.FeedbackScreen} options={{ title: "Send feedback" }} />
    </Stack.Navigator>
  );
};

export interface NavigationProps
  extends Partial<React.ComponentProps<typeof NavigationContainer>> {}

export const AppNavigator = (props: NavigationProps) => {
  const colorScheme = useColorScheme();
  const navRef = useRef<NavigationContainerRef<any>>(null);
  // Android back at the root of the app used to drop straight to the launcher; ask first.
  const [askExit, setAskExit] = useState(false);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (navRef.current?.canGoBack()) return false;
      setAskExit(true); return true;
    });
    return () => sub.remove();
  }, []);
  return (
    <NavigationContainer ref={navRef} {...props}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <AppStack />
      <Portal>
        <Dialog visible={askExit} onDismiss={() => setAskExit(false)}>
          <Dialog.Title>Leave Kubrai?</Dialog.Title>
          <Dialog.Content><Text variant="bodyMedium">Your bets stay where they are; payouts arrive in your wallet whether the app is open or not.</Text></Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAskExit(false)}>Stay</Button>
            <Button onPress={() => { setAskExit(false); BackHandler.exitApp(); }}>Exit</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </NavigationContainer>
  );
};
