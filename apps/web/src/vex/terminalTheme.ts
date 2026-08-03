import type { GhosttyColor, GhosttyTheme } from "../terminal/ghostty/core";

export function vexTerminalTheme(input: {
  readonly isDark: boolean;
  readonly background: GhosttyColor;
  readonly foreground: GhosttyColor;
}): GhosttyTheme {
  if (input.isDark) {
    return {
      background: input.background,
      foreground: input.foreground,
      cursor: { r: 180, g: 190, b: 254 },
      selectionBackground: "#585b7066",
    };
  }

  return {
    background: input.background,
    foreground: input.foreground,
    cursor: { r: 114, g: 135, b: 253 },
    selectionBackground: "#9ca0b066",
  };
}
