export const VEX_CODE_THEME_NAMES = {
  light: "catppuccin-latte",
  dark: "catppuccin-mocha",
} as const;

export type VexCodeThemeName = (typeof VEX_CODE_THEME_NAMES)[keyof typeof VEX_CODE_THEME_NAMES];

export function resolveVexCodeThemeName(theme: "light" | "dark"): VexCodeThemeName {
  return theme === "dark" ? VEX_CODE_THEME_NAMES.dark : VEX_CODE_THEME_NAMES.light;
}
