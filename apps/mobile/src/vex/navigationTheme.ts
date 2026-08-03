import { DarkTheme, DefaultTheme, type Theme } from "@react-navigation/native";
import { useMemo } from "react";
import { useColorScheme } from "react-native";

import { useThemeColor } from "../lib/useThemeColor";

export function useVexNavigationTheme(): Theme {
  const isDark = useColorScheme() === "dark";
  const primary = String(useThemeColor("--color-primary"));
  const background = String(useThemeColor("--color-screen"));
  const card = String(useThemeColor("--color-header"));
  const text = String(useThemeColor("--color-foreground"));
  const border = String(useThemeColor("--color-header-border"));
  const notification = String(useThemeColor("--color-danger-foreground"));

  return useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary,
        background,
        card,
        text,
        border,
        notification,
      },
    };
  }, [background, border, card, isDark, notification, primary, text]);
}
