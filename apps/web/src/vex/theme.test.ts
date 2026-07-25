// @effect-diagnostics nodeBuiltinImport:off - This regression test intentionally inspects the CSS source.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { resolveVexCodeThemeName } from "./theme";

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

describe("Vex sidebar theme", () => {
  it("reapplies Catppuccin Latte over upstream's scoped sidebar palette", () => {
    const rule = cssRuleBody('[data-sidebar-version="v1"]');

    expect(rule).toContain("--sidebar: #e6e9ef");
    expect(rule).toContain("--sidebar-row-hover: #dce0e8");
    expect(rule).toContain("--sidebar-row-active: #ccd0da");
    expect(rule).not.toContain("zinc");
  });

  it("reapplies Catppuccin Mocha over upstream's scoped dark sidebar palette", () => {
    const rule = cssRuleBody('.dark [data-sidebar-version="v1"]');

    expect(rule).toContain("--sidebar: #181825");
    expect(rule).toContain("--sidebar-row-hover: #313244");
    expect(rule).toContain("--sidebar-row-active: #45475a");
    expect(rule).not.toContain("#000");
  });
});
