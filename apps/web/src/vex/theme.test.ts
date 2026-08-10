// @effect-diagnostics nodeBuiltinImport:off - This regression test intentionally inspects the CSS source.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { resolveVexCodeThemeName, VEX_THEME_PREVIEW_COLORS } from "./theme";

const themeCss = NodeFS.readFileSync(new URL("./theme.css", import.meta.url), "utf8");

describe("resolveVexCodeThemeName", () => {
  it("uses the matching Catppuccin code theme", () => {
    expect(resolveVexCodeThemeName("light")).toBe("catppuccin-latte");
    expect(resolveVexCodeThemeName("dark")).toBe("catppuccin-mocha");
  });
});

function cssRuleBody(marker: string): string {
  const markerIndex = themeCss.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);

  const openingBraceIndex = themeCss.indexOf("{", markerIndex);
  const closingBraceIndex = themeCss.indexOf("}", openingBraceIndex);
  expect(openingBraceIndex).toBeGreaterThan(markerIndex);
  expect(closingBraceIndex).toBeGreaterThan(openingBraceIndex);

  return themeCss.slice(openingBraceIndex + 1, closingBraceIndex);
}

describe("Vex standard theme", () => {
  it("uses Catppuccin for the unselected light and dark palettes", () => {
    const light = cssRuleBody(":root {");
    const dark = cssRuleBody(":root.dark");

    expect(light).toContain("--background: #eff1f5");
    expect(light).toContain("--primary: #8839ef");
    expect(light).toContain("--terminal-cursor: #7287fd");
    expect(dark).toContain("--background: #1e1e2e");
    expect(dark).toContain("--primary: #cba6f7");
    expect(dark).toContain("--terminal-cursor: #b4befe");
  });

  it("reattaches the palette at upstream's single sidebar seam", () => {
    const light = cssRuleBody("[data-app-sidebar]");
    const dark = cssRuleBody(".dark [data-app-sidebar]");

    expect(light).toContain("--sidebar: #e6e9ef");
    expect(light).toContain("--sidebar-row-active: #ccd0da");
    expect(dark).toContain("--sidebar: #181825");
    expect(dark).toContain("--sidebar-row-active: #45475a");
    expect(themeCss).not.toContain("data-sidebar-version");
  });

  it("publishes matching theme-library previews", () => {
    expect(VEX_THEME_PREVIEW_COLORS.light.sidebar).toBe("#e6e9ef");
    expect(VEX_THEME_PREVIEW_COLORS.light.accent).toBe("#8839ef");
    expect(VEX_THEME_PREVIEW_COLORS.dark.sidebar).toBe("#181825");
    expect(VEX_THEME_PREVIEW_COLORS.dark.accent).toBe("#cba6f7");
  });
});
