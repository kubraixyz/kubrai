import { useTheme } from "react-native-paper";
/** The website's colour names (web/src/styles.css :root) read off the app theme, so a screen ported from a page keeps
 *  the page's colours in both themes. The warning and "no" tints are not theme colours and are spelled out here. */
export function usePalette() {
  const { dark, colors: c } = useTheme() as any;
  return {
    dark: !!dark, bg: c.background, surface: c.surface, surface2: c.elevation.level3, line: c.outlineVariant, fg: c.onSurface,
    dim: c.onSurfaceVariant, accent: c.primary, accentBg: c.primaryContainer, no: c.error,
    noBg: dark ? "#33231f" : "#f6e2dd", warnBg: dark ? "#3a3110" : "#fff3c4", warnFg: dark ? "#e8d48b" : "#6b5200",
  };
}
export type Palette = ReturnType<typeof usePalette>;
/** The website's monospace figures (IBM Plex Mono there; the phone's monospace here). */
export const MONO = { fontFamily: "monospace", fontVariant: ["tabular-nums"] as any };
