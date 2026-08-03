export type VexMobileColourScheme = "light" | "dark";

export const VEX_MOBILE_PALETTE = {
  light: {
    screen: "#eff1f5",
    sheet: "rgba(239, 241, 245, 0.98)",
    foreground: "#4c4f69",
    mutedForeground: "#6c6f85",
    border: "#ccd0da",
    primary: "#8839ef",
    danger: "#d20f39",
    green: "#40a02b",
    blue: "#1e66f5",
  },
  dark: {
    screen: "#1e1e2e",
    sheet: "rgba(30, 30, 46, 0.98)",
    foreground: "#cdd6f4",
    mutedForeground: "#a6adc8",
    border: "#585b70",
    primary: "#cba6f7",
    danger: "#f38ba8",
    green: "#a6e3a1",
    blue: "#89b4fa",
  },
} as const;

export function resolveVexMobilePalette(scheme: VexMobileColourScheme) {
  return VEX_MOBILE_PALETTE[scheme];
}
