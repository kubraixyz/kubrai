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
  Snackbar,
  Text,
  adaptNavigationTheme,
} from "react-native-paper";
import { useReferralLinkCapture } from "../hooks/useReferral";
import { NavigationContainerRef } from "@react-navigation/native";
import { t } from "../i18n";

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
      <Stack.Screen name="Settings" component={Screens.SettingsScreen} options={{ title: t("app.settings") }} />
      <Stack.Screen name="Market" component={Screens.MarketScreen} options={{ title: t("app.market") }} />
      <Stack.Screen name="Feedback" component={Screens.FeedbackScreen} options={{ title: t("app.fb.title") }} />
    </Stack.Navigator>
  );
};

export interface NavigationProps
  extends Partial<React.ComponentProps<typeof NavigationContainer>> {}

// Where the user is, kept outside the navigator: a language switch redraws the whole tree (App.tsx), and the navigator
// comes back on the screen it was on (Settings, where the language is picked) instead of the market list.
let lastNavState: any = undefined;
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
  // Invite links (https://kubrai.xyz/?ref=CODE, kubrai://…?ref=CODE) hand the app a code that waits for the wallet's
  // first bet (hooks/useReferral). Say so: the link otherwise just opens the market list.
  const [invite, setInvite] = useState<string | null>(null);
  useReferralLinkCapture(setInvite);
  return (
    <NavigationContainer ref={navRef} initialState={lastNavState} onStateChange={(st) => { lastNavState = st; }} {...props}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <AppStack />
      <Portal>
        <Dialog visible={askExit} onDismiss={() => setAskExit(false)}>
          <Dialog.Title>{t("app.exit.title")}</Dialog.Title>
          <Dialog.Content><Text variant="bodyMedium">{t("app.exit.body")}</Text></Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAskExit(false)}>{t("app.exit.stay")}</Button>
            <Button onPress={() => { setAskExit(false); BackHandler.exitApp(); }}>{t("app.exit.leave")}</Button>
          </Dialog.Actions>
        </Dialog>
        <Snackbar visible={!!invite} onDismiss={() => setInvite(null)} duration={7000} wrapperStyle={{ bottom: 76 }} action={{ label: t("app.settings"), onPress: () => navRef.current?.navigate("Settings") }}>{t("app.invite.saved", { code: invite ?? "" })}</Snackbar>
      </Portal>
    </NavigationContainer>
  );
};
