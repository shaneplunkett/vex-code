import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { VexSidebarWordmark } from "./VexSidebarWordmark";

describe("VexSidebarWordmark", () => {
  it("renders the Vex Code name and icon", () => {
    const markup = renderToStaticMarkup(<VexSidebarWordmark />);

    expect(markup).toContain('aria-label="Vex Code"');
    expect(markup).toContain('src="/apple-touch-icon.png"');
    expect(markup).toContain(">Vex<");
    expect(markup).toContain(">Code<");
    expect(markup).not.toContain("T3");
  });
});
