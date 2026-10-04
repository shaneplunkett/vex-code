import {
  DEFAULT_SERVER_SETTINGS,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type ProviderSessionId,
  type WorkspaceEnvironmentStatus,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as IdAllocator from "../orchestration-v2/IdAllocator.ts";
import type { ProviderAdapterV2RuntimePolicy } from "../orchestration-v2/ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ServerSettings from "../serverSettings.ts";
import { WorkspaceEnvironment, type WorkspaceEnvironmentDiff } from "./workspaceEnvironment.ts";
import * as WorkspaceEnvironmentTurns from "./workspaceEnvironmentTurns.ts";

interface World {
  status: WorkspaceEnvironmentStatus;
  environment: WorkspaceEnvironmentDiff;
  driver: string;
  sharedSessions: boolean;
  sessionLive: boolean;
  instanceEnvironment: ReadonlyArray<{ name: string; value: string }>;
  readonly detached: Array<ProviderSessionId>;
  readonly notices: Array<string>;
}

const envrcPath = "/repo/.envrc";
const policy: ProviderAdapterV2RuntimePolicy = {
  runtimeMode: "full-access",
  interactionMode: "default",
  cwd: "/repo",
};
const run = {
  id: "run-1",
  threadId: "thread-1",
  providerInstanceId: "codex",
  modelSelection: { instanceId: "codex", model: "gpt" },
} as unknown as OrchestrationV2Run;
const providerSessionId = "session-1" as ProviderSessionId;

const makeWorld = (): World => ({
  status: { _tag: "ready", envrcPath },
  environment: { PATH: "/flake/bin", API_URL: "https://dev" },
  driver: "codex",
  sharedSessions: true,
  sessionLive: false,
  instanceEnvironment: [],
  detached: [],
  notices: [],
});

const layerFor = (world: World) =>
  WorkspaceEnvironmentTurns.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        IdAllocator.layer,
        Layer.succeed(WorkspaceEnvironment, {
          resolve: () =>
            Effect.sync(() => ({
              status: world.status,
              environment: world.status._tag === "ready" ? world.environment : {},
            })),
        } as unknown as WorkspaceEnvironment["Service"]),
        Layer.succeed(ProviderSessionManager.ProviderSessionManagerV2, {
          get: () =>
            Effect.sync(() => (world.sessionLive ? Option.some({} as never) : Option.none())),
          detach: (input: { readonly providerSessionId: ProviderSessionId }) =>
            Effect.sync(() => {
              world.detached.push(input.providerSessionId);
              world.sessionLive = false;
            }),
        } as unknown as ProviderSessionManager.ProviderSessionManagerV2["Service"]),
        Layer.succeed(ProviderAdapterRegistry.ProviderAdapterRegistryV2, {
          get: () =>
            Effect.sync(() => ({
              driver: world.driver,
              getCapabilities: () =>
                Effect.succeed({
                  sessions: { supportsMultipleProviderThreadsPerSession: world.sharedSessions },
                }),
            })),
        } as unknown as ProviderAdapterRegistry.ProviderAdapterRegistryV2["Service"]),
        Layer.succeed(ServerSettings.ServerSettingsService, {
          getSettings: Effect.sync(() => ({
            ...DEFAULT_SERVER_SETTINGS,
            providerInstances: {
              codex: { driver: "codex", environment: world.instanceEnvironment },
            },
          })),
        } as unknown as ServerSettings.ServerSettingsService["Service"]),
        Layer.succeed(EventSink.EventSinkV2, {
          writeIfRunCurrent: (input: {
            readonly events: ReadonlyArray<OrchestrationV2DomainEvent>;
          }) =>
            Effect.sync(() => {
              for (const event of input.events) {
                if (event.type === "turn-item.updated" && event.payload.type === "system_notice") {
                  world.notices.push(event.payload.message);
                }
              }
              return { committed: true, storedEvents: [] };
            }),
        } as unknown as EventSink.EventSinkV2["Service"]),
      ),
    ),
  );

const prepare = Effect.gen(function* () {
  const turns = yield* WorkspaceEnvironmentTurns.WorkspaceEnvironmentTurns;
  return yield* turns.prepare({
    policy,
    run,
    attemptId: "attempt-1" as never,
    rootNodeId: "node-1" as never,
    providerThreadId: "provider-thread-1" as never,
    providerSessionId,
  });
});

const turnWith = (world: World) => prepare.pipe(Effect.provide(layerFor(world)));

describe("WorkspaceEnvironmentTurns", () => {
  it.effect("adds the .envrc environment, letting the provider instance's own values win", () =>
    Effect.gen(function* () {
      const world = makeWorld();
      world.instanceEnvironment = [{ name: "API_URL", value: "https://prod" }];
      const prepared = yield* turnWith(world);
      expect(prepared.environment).toEqual({ PATH: "/flake/bin" });
      expect(world.notices).toEqual([]);
    }),
  );

  it.effect("reopens a live session when the environment changes, and only then", () =>
    Effect.gen(function* () {
      const world = makeWorld();
      yield* Effect.gen(function* () {
        // The first turn opens the session with this environment.
        yield* prepare;
        world.sessionLive = true;
        yield* prepare;
        expect(world.detached).toEqual([]);

        world.environment = { PATH: "/new-flake/bin" };
        const prepared = yield* prepare;
        expect(world.detached).toEqual([providerSessionId]);
        expect(prepared.environment).toEqual({ PATH: "/new-flake/bin" });
      }).pipe(Effect.provide(layerFor(world)));
    }),
  );

  it.effect("posts a warning when the status changes, not on every turn", () =>
    Effect.gen(function* () {
      const world = makeWorld();
      world.status = { _tag: "blocked", envrcPath };
      yield* Effect.gen(function* () {
        const prepared = yield* prepare;
        yield* prepare;
        expect(prepared.environment).toBeUndefined();
        expect(world.notices).toHaveLength(1);
        expect(world.notices[0]).toContain("blocked");

        world.status = { _tag: "ready", envrcPath };
        yield* prepare;
        world.status = { _tag: "blocked", envrcPath };
        yield* prepare;
        expect(world.notices).toHaveLength(2);
      }).pipe(Effect.provide(layerFor(world)));
    }),
  );

  it.effect("says so instead of applying the environment for providers that cannot take it", () =>
    Effect.gen(function* () {
      const world = makeWorld();
      world.driver = "cursor";
      world.sharedSessions = false;
      const prepared = yield* turnWith(world);
      expect(prepared.environment).toBeUndefined();
      expect(world.notices).toHaveLength(1);
      expect(world.notices[0]).toContain("Cursor");
    }),
  );

  it.effect("applies to OpenCode 1 sessions but not the shared OpenCode 2 server", () =>
    Effect.gen(function* () {
      const v1 = makeWorld();
      v1.driver = "opencode";
      v1.sharedSessions = false;
      expect((yield* turnWith(v1)).environment).toEqual(v1.environment);

      const v2 = makeWorld();
      v2.driver = "opencode";
      v2.sharedSessions = true;
      expect((yield* turnWith(v2)).environment).toBeUndefined();
    }),
  );
});
