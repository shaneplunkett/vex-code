import { assert, it } from "@effect/vitest";

import { planPairings, shellQuote, tailnetSuffix } from "./repair-pairings.ts";

it("mints a code for every server except the one a desktop app already owns", () => {
  const plan = planPairings({
    servers: [
      { name: "desktop", host: "desktop" },
      { name: "mini", host: "mini-server", ssh: "mini" },
    ],
    clients: [
      { name: "desktop app", delivery: "link", ownServer: "desktop" },
      { name: "phone", delivery: "qr" },
    ],
  });

  assert.deepStrictEqual(
    plan.map(({ client, server }) => `${client.name} → ${server.name}`),
    ["desktop app → mini", "phone → desktop", "phone → mini"],
  );
});

it("quotes remote arguments so labels and URLs survive the remote shell", () => {
  assert.strictEqual(shellQuote("mini browser"), "'mini browser'");
  assert.strictEqual(shellQuote("it's"), "'it'\\''s'");
  assert.strictEqual(
    shellQuote("https://h/pair#token=X&y=$HOME"),
    "'https://h/pair#token=X&y=$HOME'",
  );
});

it("drops the machine name from a MagicDNS name", () => {
  assert.strictEqual(tailnetSuffix("desktop.example.ts.net"), "example.ts.net");
});
