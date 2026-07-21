import { describe, expect, it } from "vite-plus/test";

import { resolveExternalPreferredEditor, resolvePickerPreferredEditor } from "./editorPreferences";

describe("resolvePickerPreferredEditor", () => {
  it("keeps an explicitly selected Neovim preference", () => {
    expect(resolvePickerPreferredEditor(["neovim", "file-manager"], "neovim")).toBe("neovim");
  });

  it("uses the file manager instead of an arbitrary detected IDE", () => {
    expect(resolvePickerPreferredEditor(["datagrip", "file-manager"], null)).toBe("file-manager");
  });

  it("uses the only available option", () => {
    expect(resolvePickerPreferredEditor(["neovim"], null)).toBe("neovim");
  });

  it("requires an explicit choice when several non-file-manager options are available", () => {
    expect(resolvePickerPreferredEditor(["datagrip", "neovim"], null)).toBeNull();
  });
});

describe("resolveExternalPreferredEditor", () => {
  it("falls back to an external option when the preference needs a terminal", () => {
    expect(resolveExternalPreferredEditor(["neovim", "file-manager"], "neovim")).toBe(
      "file-manager",
    );
  });
});
