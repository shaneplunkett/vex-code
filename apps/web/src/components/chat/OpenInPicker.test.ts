import { describe, expect, it } from "vite-plus/test";

import { resolveOpenInOptions } from "./OpenInPicker";

describe("resolveOpenInOptions", () => {
  it("offers Neovim only when the caller can provide an embedded terminal", () => {
    expect(
      resolveOpenInOptions("Linux", ["neovim", "file-manager"], false).map(
        (option) => option.value,
      ),
    ).toEqual(["file-manager"]);
    expect(
      resolveOpenInOptions("Linux", ["neovim", "file-manager"], true).map((option) => option.value),
    ).toEqual(["neovim", "file-manager"]);
  });
});
