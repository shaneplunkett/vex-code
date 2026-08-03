import catppuccinLatte from "@shikijs/themes/catppuccin-latte";
import catppuccinMocha from "@shikijs/themes/catppuccin-mocha";

import type { VexMobileColourScheme } from "./theme";

export const VEX_MOBILE_SHIKI_THEME_NAME_BY_SCHEME = {
  light: "catppuccin-latte",
  dark: "catppuccin-mocha",
} as const;

export const VEX_MOBILE_SHIKI_THEMES = [catppuccinLatte, catppuccinMocha] as const;

export const VEX_MOBILE_TERMINAL_THEMES = {
  light: {
    background: "#eff1f5",
    foreground: "#4c4f69",
    mutedForeground: "#8c8fa1",
    border: "#ccd0da",
    cursorForeground: "#7287fd",
    cursorBackground: "#eff1f5",
    palette: [
      "#5c5f77",
      "#d20f39",
      "#40a02b",
      "#df8e1d",
      "#1e66f5",
      "#ea76cb",
      "#179299",
      "#acb0be",
      "#6c6f85",
      "#d20f39",
      "#40a02b",
      "#df8e1d",
      "#1e66f5",
      "#ea76cb",
      "#179299",
      "#bcc0cc",
    ],
  },
  dark: {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    mutedForeground: "#7f849c",
    border: "#585b70",
    cursorForeground: "#b4befe",
    cursorBackground: "#1e1e2e",
    palette: [
      "#45475a",
      "#f38ba8",
      "#a6e3a1",
      "#f9e2af",
      "#89b4fa",
      "#f5c2e7",
      "#94e2d5",
      "#bac2de",
      "#585b70",
      "#f38ba8",
      "#a6e3a1",
      "#f9e2af",
      "#89b4fa",
      "#f5c2e7",
      "#94e2d5",
      "#a6adc8",
    ],
  },
} as const;

export function resolveVexMobileTerminalTheme(scheme: VexMobileColourScheme) {
  return VEX_MOBILE_TERMINAL_THEMES[scheme];
}

export function resolveVexMobileReviewDiffTheme(scheme: VexMobileColourScheme) {
  const terminal = resolveVexMobileTerminalTheme(scheme);
  const [, red, , , blue] = terminal.palette;

  if (scheme === "dark") {
    return {
      background: "#1e1e2e",
      text: terminal.foreground,
      mutedText: terminal.mutedForeground,
      headerBackground: "#1e1e2e",
      border: terminal.border,
      hunkBackground: "#29334f",
      hunkText: blue,
      addBackground: "#273849",
      deleteBackground: "#3f2d3d",
      addBar: "#a6e3a1",
      deleteBar: red,
      addText: "#a6e3a1",
      deleteText: "#f38ba8",
    } as const;
  }

  return {
    background: "#eff1f5",
    text: terminal.foreground,
    mutedText: terminal.mutedForeground,
    headerBackground: "#eff1f5",
    border: terminal.border,
    hunkBackground: "#dce6f5",
    hunkText: blue,
    addBackground: "#dcebdc",
    deleteBackground: "#f0dfe3",
    addBar: "#40a02b",
    deleteBar: red,
    addText: "#40a02b",
    deleteText: "#d20f39",
  } as const;
}
