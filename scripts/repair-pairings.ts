#!/usr/bin/env node

/**
 * Re-pairs every client with every T3 server on Shane's tailnet in one pass.
 *
 * Reads `~/.config/vex-code/pairings.json`:
 *
 * ```json
 * {
 *   "servers": [
 *     { "name": "desktop", "host": "desktop" },
 *     { "name": "mini", "host": "mini-server", "ssh": "mini" }
 *   ],
 *   "clients": [
 *     { "name": "desktop app", "delivery": "link", "ownServer": "desktop" },
 *     { "name": "phone", "delivery": "qr" },
 *     { "name": "mini browser", "delivery": "open", "openOn": "mini" }
 *   ]
 * }
 * ```
 *
 * `host` is the server's Tailscale Serve machine name. A server without `ssh`
 * runs on this machine. `ownServer` is the server a desktop app already reaches
 * through its local bootstrap, so no code is minted for it. `open` delivery
 * opens the link in the default browser of the `openOn` server's machine; the
 * other codes land on one local page as QR codes (`qr`) or links (`link`).
 */

import * as NodeOS from "node:os";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { QrCode } from "@t3tools/shared/qrCode";
import { parseTailscaleMagicDnsName } from "@t3tools/tailscale";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const PairingServer = Schema.Struct({
  name: Schema.String,
  host: Schema.String,
  ssh: Schema.optional(Schema.String),
});
type PairingServer = typeof PairingServer.Type;

const PairingClient = Schema.Struct({
  name: Schema.String,
  delivery: Schema.Literals(["qr", "link", "open"]),
  ownServer: Schema.optional(Schema.String),
  openOn: Schema.optional(Schema.String),
});
type PairingClient = typeof PairingClient.Type;

const PairingConfig = Schema.Struct({
  servers: Schema.Array(PairingServer),
  clients: Schema.Array(PairingClient),
});
type PairingConfig = typeof PairingConfig.Type;

const MintedPairing = Schema.Struct({ pairUrl: Schema.String, expiresAt: Schema.String });

const SessionList = Schema.Array(
  Schema.Struct({
    client: Schema.Struct({ label: Schema.optional(Schema.String) }),
    scopes: Schema.Array(Schema.String),
    issuedAt: Schema.String,
    expiresAt: Schema.String,
    connected: Schema.Boolean,
  }),
);

export class RepairPairingsError extends Schema.TaggedError<RepairPairingsError>()(
  "RepairPairingsError",
  { step: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `${this.step}: ${this.detail}`;
  }
}

export interface PlannedPairing {
  readonly client: PairingClient;
  readonly server: PairingServer;
}

/** Every client × server pair that needs a code, in config order. */
export function planPairings(config: PairingConfig): ReadonlyArray<PlannedPairing> {
  return config.clients.flatMap((client) =>
    config.servers
      .filter((server) => server.name !== client.ownServer)
      .map((server) => ({ client, server })),
  );
}

/** Quotes one argument for the POSIX shell ssh hands remote commands to. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** `desktop.example.ts.net` → `example.ts.net`. */
export function tailnetSuffix(magicDnsName: string): string {
  return magicDnsName.slice(magicDnsName.indexOf(".") + 1);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => `&#${char.charCodeAt(0)};`);
}

export function renderQrSvg(value: string): string {
  const qr = QrCode.encodeText(value, QrCode.Ecc.MEDIUM);
  const margin = 2;
  let path = "";
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (qr.getModule(x, y)) path += `M${x + margin},${y + margin}h1v1h-1z`;
    }
  }
  const extent = qr.size + margin * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" width="240" height="240" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

const collectText = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const runScoped = Effect.fn("run")(function* (executable: string, args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const failure = (detail: string) => new RepairPairingsError({ step: executable, detail });
  const child = yield* spawner
    .spawn(ChildProcess.make(executable, args))
    .pipe(Effect.mapError((cause) => failure(String(cause))));
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [collectText(child.stdout), collectText(child.stderr), child.exitCode.pipe(Effect.map(Number))],
    { concurrency: "unbounded" },
  ).pipe(Effect.mapError((cause) => failure(String(cause))));
  if (exitCode !== 0) return yield* failure(`exit ${exitCode}: ${stderr.trim()}`);
  return stdout;
});

const run = (executable: string, args: ReadonlyArray<string>) =>
  Effect.scoped(runScoped(executable, args));

/** Runs a command on the server's machine, over ssh unless it is this one. */
const runOn = (server: PairingServer, args: ReadonlyArray<string>) =>
  server.ssh === undefined
    ? run(args[0]!, args.slice(1))
    : run("ssh", [
        "-o",
        "BatchMode=yes",
        "-o",
        "RemoteCommand=none",
        "-o",
        "RequestTTY=no",
        server.ssh,
        args.map(shellQuote).join(" "),
      ]);

const decodeJson = <S extends Schema.Top>(schema: S, step: string) => {
  const decode = Schema.decodeEffect(Schema.fromJsonString(schema));
  return (source: string) =>
    decode(source).pipe(
      Effect.mapError((cause) => new RepairPairingsError({ step, detail: String(cause) })),
    );
};

const loadConfig = Effect.fn("loadConfig")(function* (configPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const source = yield* fs
    .readFileString(configPath)
    .pipe(
      Effect.mapError(
        (cause) => new RepairPairingsError({ step: `read ${configPath}`, detail: String(cause) }),
      ),
    );
  const config = yield* decodeJson(PairingConfig, `decode ${configPath}`)(source);
  const serverNames = new Set(config.servers.map((server) => server.name));
  for (const client of config.clients) {
    for (const reference of [client.ownServer, client.openOn]) {
      if (reference !== undefined && !serverNames.has(reference)) {
        return yield* new RepairPairingsError({
          step: `decode ${configPath}`,
          detail: `client "${client.name}" names unknown server "${reference}"`,
        });
      }
    }
    if (client.delivery === "open" && client.openOn === undefined) {
      return yield* new RepairPairingsError({
        step: `decode ${configPath}`,
        detail: `client "${client.name}" uses open delivery without openOn`,
      });
    }
  }
  return config;
});

const showStatus = Effect.fn("showStatus")(function* (config: PairingConfig) {
  for (const server of config.servers) {
    const sessions = yield* runOn(server, ["t3", "auth", "session", "list", "--json"]).pipe(
      Effect.flatMap(decodeJson(SessionList, `${server.name} sessions`)),
    );
    yield* Console.log(`\n${server.name}`);
    for (const session of sessions) {
      yield* Console.log(
        `  ${(session.client.label ?? "(unlabelled)").padEnd(18)} expires ${session.expiresAt.slice(0, 10)}  ${session.scopes.length} scopes${session.connected ? "  connected" : ""}`,
      );
    }
  }
});

interface DeliveredPairing extends PlannedPairing {
  readonly pairUrl: string;
  readonly expiresAt: string;
  readonly opened: boolean;
}

function renderPage(pairings: ReadonlyArray<DeliveredPairing>): string {
  const clients = [...new Set(pairings.map((pairing) => pairing.client.name))];
  const sections = clients.map((name) => {
    const rows = pairings
      .filter((pairing) => pairing.client.name === name)
      .map((pairing) => {
        const link = `<code>${escapeHtml(pairing.pairUrl)}</code>`;
        const body =
          pairing.client.delivery === "qr"
            ? `${renderQrSvg(pairing.pairUrl)}<br>${link}`
            : pairing.opened
              ? `Opened on ${escapeHtml(pairing.client.openOn ?? "")}. Fallback: ${link}`
              : link;
        return `<div class="pair"><h3>→ ${escapeHtml(pairing.server.name)}</h3>${body}</div>`;
      });
    return `<section><h2>${escapeHtml(name)}</h2>${rows.join("")}</section>`;
  });
  const expiresAt = pairings[0]?.expiresAt ?? "";
  return `<!doctype html><meta charset="utf-8"><title>Repair pairings</title>
<style>body{font:15px system-ui;margin:2rem;max-width:60rem}section{margin-bottom:2rem}.pair{display:inline-block;vertical-align:top;margin:0 1.5rem 1rem 0;max-width:18rem;word-break:break-all}code{font-size:12px}</style>
<h1>Repair pairings</h1><p>Codes expire at ${escapeHtml(expiresAt)}.</p>${sections.join("")}`;
}

const repairPairings = Effect.fn("repairPairings")(function* (input: {
  readonly configPath: string;
  readonly ttl: string;
  readonly status: boolean;
}) {
  const config = yield* loadConfig(input.configPath);
  if (input.status) return yield* showStatus(config);

  const suffix = yield* run("tailscale", ["status", "--json"]).pipe(
    Effect.flatMap(parseTailscaleMagicDnsName),
    Effect.mapError(
      (cause) => new RepairPairingsError({ step: "tailscale", detail: String(cause) }),
    ),
    Effect.flatMap((name) =>
      name === null
        ? new RepairPairingsError({ step: "tailscale", detail: "MagicDNS name unavailable" })
        : Effect.succeed(tailnetSuffix(name)),
    ),
  );
  const serversByName = new Map(config.servers.map((server) => [server.name, server]));
  // Remote servers are Macs, so only this machine can need xdg-open.
  const localOpener = (yield* HostProcess.Platform) === "darwin" ? "open" : "xdg-open";

  const delivered: Array<DeliveredPairing> = [];
  for (const planned of planPairings(config)) {
    const minted = yield* runOn(planned.server, [
      "t3",
      "auth",
      "pairing",
      "create",
      "--json",
      "--ttl",
      input.ttl,
      "--label",
      planned.client.name,
      "--base-url",
      `https://${planned.server.host}.${suffix}`,
    ]).pipe(Effect.flatMap(decodeJson(MintedPairing, `${planned.server.name} pairing`)));

    let opened = false;
    const openOn = planned.client.openOn ? serversByName.get(planned.client.openOn) : undefined;
    if (planned.client.delivery === "open" && openOn !== undefined) {
      const opener = openOn.ssh === undefined ? localOpener : "open";
      opened = yield* runOn(openOn, [opener, minted.pairUrl]).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
    }
    delivered.push({ ...planned, ...minted, opened });
    yield* Console.log(
      `${planned.client.name} → ${planned.server.name}: ${opened ? "opened" : "on the page"}`,
    );
  }

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs
    .makeTempDirectory({ prefix: "repair-pairings-" })
    .pipe(
      Effect.mapError((cause) => new RepairPairingsError({ step: "page", detail: String(cause) })),
    );
  const pagePath = path.join(directory, "index.html");
  yield* fs
    .writeFileString(pagePath, renderPage(delivered), { mode: 0o600 })
    .pipe(
      Effect.mapError((cause) => new RepairPairingsError({ step: "page", detail: String(cause) })),
    );
  yield* run(localOpener, [pagePath]).pipe(Effect.catch(() => Effect.void));
  yield* Console.log(`\nCodes page: ${pagePath}`);
  yield* Console.log("Run again with --status once every client has paired.");
});

export const repairPairingsCommand = Command.make(
  "repair-pairings",
  {
    config: Flag.String("config").pipe(
      Flag.withDescription("Pairing config path."),
      Flag.withDefault(`${NodeOS.homedir()}/.config/vex-code/pairings.json`),
    ),
    ttl: Flag.String("ttl").pipe(
      Flag.withDescription("How long the minted codes stay redeemable."),
      Flag.withDefault("1h"),
    ),
    status: Flag.Boolean("status").pipe(
      Flag.withDescription("List each server's live sessions instead of minting codes."),
      Flag.withDefault(false),
    ),
  },
  ({ config, ttl, status }) => repairPairings({ configPath: config, ttl, status }),
).pipe(
  Command.withDescription(
    "Mint a pairing code for every client on every T3 server and deliver them in one pass.",
  ),
);

if (import.meta.main) {
  Command.run(repairPairingsCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
