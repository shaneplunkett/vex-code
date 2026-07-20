import { describe, expect, it } from "vite-plus/test";
import { resolveVexCodeThemeName } from "./theme";

describe("resolveVexCodeThemeName", () => {
  it("uses the matching Catppuccin code theme", () => {
    expect(resolveVexCodeThemeName("light")).toBe("catppuccin-latte");
    expect(resolveVexCodeThemeName("dark")).toBe("catppuccin-mocha");
  });
});
