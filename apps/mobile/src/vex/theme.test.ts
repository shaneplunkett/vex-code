// @effect-diagnostics nodeBuiltinImport:off - This regression test intentionally inspects CSS.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveVexMobileReviewDiffTheme,
  resolveVexMobileTerminalTheme,
  VEX_MOBILE_SHIKI_THEME_NAME_BY_SCHEME,
} from "./codeTheme";
import { VEX_MOBILE_PALETTE } from "./theme";

const upstreamCss = NodeFS.readFileSync(new URL("../../global.css", import.meta.url), "utf8");
const themeCss = NodeFS.readFileSync(new URL("./theme.css", import.meta.url), "utf8");

function blockBody(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);

  const openingBraceIndex = source.indexOf("{", markerIndex);
  expect(openingBraceIndex).toBeGreaterThan(markerIndex);

  let depth = 1;
  for (let index = openingBraceIndex + 1; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openingBraceIndex + 1, index);
  }

  throw new Error(`Unclosed CSS block: ${marker}`);
}

function colourTokenNames(source: string): ReadonlyArray<string> {
  return [...source.matchAll(/--color-[a-z0-9-]+(?=\s*:)/g)].map(([name]) => name).sort();
}

describe("Vex mobile colour theme", () => {
  it("overrides every upstream semantic colour in Latte and Mocha", () => {
    const upstreamTokens = [...new Set(colourTokenNames(upstreamCss))];

    for (const scheme of ["light", "dark"] as const) {
      const themeTokens = [...new Set(colourTokenNames(blockBody(themeCss, `@variant ${scheme}`)))];
      expect(themeTokens).toEqual(upstreamTokens);
    }
  });

  it("keeps native surfaces aligned with the CSS palette", () => {
    expect(themeCss).toContain(`--color-screen: ${VEX_MOBILE_PALETTE.light.screen}`);
    expect(themeCss).toContain(`--color-sheet: ${VEX_MOBILE_PALETTE.light.sheet}`);
    expect(themeCss).toContain(`--color-screen: ${VEX_MOBILE_PALETTE.dark.screen}`);
    expect(themeCss).toContain(`--color-sheet: ${VEX_MOBILE_PALETTE.dark.sheet}`);
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
