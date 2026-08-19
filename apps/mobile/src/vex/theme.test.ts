import { describe, expect, it } from "vite-plus/test";

import { getMobileThemeVariables, MOBILE_THEME_OPTIONS } from "../lib/mobileTheme";
import { DEFAULT_MOBILE_THEME_VARIABLES } from "../lib/mobileDefaultTheme";
import {
  resolveVexMobileReviewDiffTheme,
  resolveVexMobileTerminalTheme,
  VEX_MOBILE_SHIKI_THEME_NAME_BY_SCHEME,
} from "./codeTheme";
import { VEX_MOBILE_APP_NAME, VEX_MOBILE_PALETTE, VEX_MOBILE_THEME_VARIABLES } from "./theme";

describe("Vex mobile colour theme", () => {
  it("provides every upstream semantic colour in Latte and Mocha", () => {
    for (const scheme of ["light", "dark"] as const) {
      expect(Object.keys(VEX_MOBILE_THEME_VARIABLES[scheme]).sort()).toEqual(
        Object.keys(DEFAULT_MOBILE_THEME_VARIABLES[scheme]).sort(),
      );
      expect(getMobileThemeVariables("t3-code", scheme)).toEqual(
        VEX_MOBILE_THEME_VARIABLES[scheme],
      );
    }
  });

  it("keeps Vex as the compatible default theme identity", () => {
    expect(MOBILE_THEME_OPTIONS[0]).toEqual({ id: "t3-code", label: VEX_MOBILE_APP_NAME });
  });

  it("keeps native surfaces aligned with the Vex palette", () => {
    expect(VEX_MOBILE_THEME_VARIABLES.light["--color-screen"]).toBe(
      VEX_MOBILE_PALETTE.light.screen,
    );
    expect(VEX_MOBILE_THEME_VARIABLES.light["--color-sheet"]).toBe(VEX_MOBILE_PALETTE.light.sheet);
    expect(VEX_MOBILE_THEME_VARIABLES.dark["--color-screen"]).toBe(VEX_MOBILE_PALETTE.dark.screen);
    expect(VEX_MOBILE_THEME_VARIABLES.dark["--color-sheet"]).toBe(VEX_MOBILE_PALETTE.dark.sheet);
  });
});

describe("Vex mobile code theme", () => {
  it("uses Catppuccin syntax themes", () => {
    expect(VEX_MOBILE_SHIKI_THEME_NAME_BY_SCHEME).toEqual({
      light: "catppuccin-latte",
      dark: "catppuccin-mocha",
    });
  });

  it("uses matching Catppuccin terminal and diff surfaces", () => {
    const lightTerminal = resolveVexMobileTerminalTheme("light");
    const darkTerminal = resolveVexMobileTerminalTheme("dark");
    const lightDiff = resolveVexMobileReviewDiffTheme("light");
    const darkDiff = resolveVexMobileReviewDiffTheme("dark");

    expect(lightTerminal).toMatchObject({ background: "#eff1f5", cursorForeground: "#7287fd" });
    expect(darkTerminal).toMatchObject({ background: "#1e1e2e", cursorForeground: "#b4befe" });
    expect(lightDiff.background).toBe(lightTerminal.background);
    expect(darkDiff.background).toBe(darkTerminal.background);
  });
});
