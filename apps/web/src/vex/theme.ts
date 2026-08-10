export const VEX_CODE_THEME_NAMES = {
  light: "catppuccin-latte",
  dark: "catppuccin-mocha",
} as const;

/** Preview roles for the unselected standard theme in Settings. Keep these in
 * sync with theme.css; selecting any library theme replaces the standard Vex
 * palette through upstream's semantic theme variables. */
export const VEX_THEME_PREVIEW_COLORS = {
  light: {
    sidebar: "#e6e9ef",
    canvas: "#eff1f5",
    surface: "#eff1f5",
    accentSurface: "#ccd0da",
    accent: "#8839ef",
    messageSurface: "#dce0e8",
    messageAction: "#8839ef",
  },
  dark: {
    sidebar: "#181825",
    canvas: "#1e1e2e",
    surface: "#1e1e2e",
    accentSurface: "#313244",
    accent: "#cba6f7",
    messageSurface: "#313244",
    messageAction: "#cba6f7",
  },
} as const;

export type VexCodeThemeName = (typeof VEX_CODE_THEME_NAMES)[keyof typeof VEX_CODE_THEME_NAMES];

export function resolveVexCodeThemeName(theme: "light" | "dark"): VexCodeThemeName {
  return theme === "dark" ? VEX_CODE_THEME_NAMES.dark : VEX_CODE_THEME_NAMES.light;
}
