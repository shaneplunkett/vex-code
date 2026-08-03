import { describe, expect, it } from "vite-plus/test";

import { buildGhosttyThemeConfig, getPierreTerminalTheme } from "./terminalTheme";

describe("getPierreTerminalTheme", () => {
  it("returns the Catppuccin Latte terminal palette", () => {
    expect(getPierreTerminalTheme("light")).toMatchObject({
      background: "#eff1f5",
      foreground: "#4c4f69",
      cursorForeground: "#7287fd",
      cursorBackground: "#eff1f5",
    });
  });

  it("returns the Catppuccin Mocha terminal palette", () => {
    expect(getPierreTerminalTheme("dark")).toMatchObject({
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      cursorForeground: "#b4befe",
      cursorBackground: "#1e1e2e",
    });
  });
});

describe("buildGhosttyThemeConfig", () => {
  it("serializes theme colors into a ghostty config file", () => {
    const config = buildGhosttyThemeConfig(getPierreTerminalTheme("dark"));

    expect(config).toContain("background = #1e1e2e");
    expect(config).toContain("foreground = #cdd6f4");
    expect(config).toContain("cursor-color = #b4befe");
    expect(config).toContain("palette = 0=#45475a");
    expect(config).toContain("palette = 15=#a6adc8");
    expect(config.endsWith("\n")).toBe(true);
  });
});
