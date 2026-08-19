import { describe, expect, it } from "vite-plus/test";
import { BUILT_IN_THEMES, getThemeColorsForAppearance } from "@t3tools/shared/themePalettes";

import { themeColorToNativeColor } from "../../lib/mobileTheme";

import {
  buildGhosttyThemeConfig,
  getMobileTerminalTheme,
  getPierreTerminalTheme,
} from "./terminalTheme";

describe("getPierreTerminalTheme", () => {
  it("returns the upstream light terminal palette", () => {
    expect(getPierreTerminalTheme("light")).toMatchObject({
      background: "#f2f2f7",
      foreground: "#6C6C71",
      cursorForeground: "#009fff",
      cursorBackground: "#f2f2f7",
    });
  });

  it("returns the upstream dark terminal palette", () => {
    expect(getPierreTerminalTheme("dark")).toMatchObject({
      background: "#0a0a0a",
      foreground: "#adadb1",
      cursorForeground: "#009fff",
      cursorBackground: "#0a0a0a",
    });
  });
});

describe("getMobileTerminalTheme", () => {
  it("uses the Vex terminal palette for the compatible default theme", () => {
    expect(getMobileTerminalTheme("t3-code", "light")).toMatchObject({
      background: "#eff1f5",
      cursorForeground: "#7287fd",
    });
    expect(getMobileTerminalTheme("t3-code", "dark")).toMatchObject({
      background: "#1e1e2e",
      cursorForeground: "#b4befe",
    });
  });

  it("applies the selected palette without replacing ANSI status colors", () => {
    const standard = getMobileTerminalTheme("t3-code", "dark");
    const ocean = getMobileTerminalTheme("ocean", "dark");

    expect(ocean.background).not.toBe(standard.background);
    expect(ocean.cursorForeground).not.toBe(standard.cursorForeground);
    expect(ocean.palette).toEqual(getPierreTerminalTheme("dark").palette);
  });

  it("uses the canonical desktop terminal roles for built-in themes", () => {
    const theme = BUILT_IN_THEMES.find((candidate) => candidate.id === "ocean")!;
    const colors = getThemeColorsForAppearance(theme, "dark")!;
    const terminal = getMobileTerminalTheme("ocean", "dark");

    expect(terminal.background).toBe(themeColorToNativeColor(colors.terminalBackground));
    expect(terminal.foreground).toBe(themeColorToNativeColor(colors.terminalForeground));
    expect(terminal.cursorForeground).toBe(themeColorToNativeColor(colors.terminalCursor));
  });
});

describe("buildGhosttyThemeConfig", () => {
  it("serializes theme colors into a ghostty config file", () => {
    const config = buildGhosttyThemeConfig(getMobileTerminalTheme("t3-code", "dark"));

    expect(config).toContain("background = #1e1e2e");
    expect(config).toContain("foreground = #cdd6f4");
    expect(config).toContain("cursor-color = #b4befe");
    expect(config).toContain("palette = 0=#45475a");
    expect(config).toContain("palette = 15=#a6adc8");
    expect(config.endsWith("\n")).toBe(true);
  });
});
