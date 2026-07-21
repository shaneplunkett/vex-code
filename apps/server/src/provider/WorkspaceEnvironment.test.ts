// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it, vi } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceEnvironmentVariableName,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import type * as ProcessRunner from "../processRunner.ts";
import {
  makeProviderSessionEnvironmentWithResolver,
  makeWorkspaceEnvironmentResolver,
  makeWorkspaceEnvironmentResolverWithRunner,
  WorkspaceEnvironmentError,
} from "./WorkspaceEnvironment.ts";

function output(input: {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number | null;
}): ProcessRunner.ProcessRunOutput {
  return {
    stdout: input.stdout ?? "",
    stderr: input.stderr ?? "",
    code:
      input.code === null
        ? null
        : ChildProcessSpawner.ExitCode(input.code === undefined ? 0 : input.code),
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

describe("WorkspaceEnvironment", () => {
  it.effect("falls back unchanged when direnv is unavailable", () => {
    const run = vi.fn<ProcessRunner.ProcessRunner["Service"]["run"]>();
    const resolve = makeWorkspaceEnvironmentResolverWithRunner({
      baseEnvironment: { PATH: "/base", KEEP: "yes" },
      providerEnvironment: [
        {
          name: ProviderInstanceEnvironmentVariableName.make("PROVIDER_TOKEN"),
          value: "configured",
          sensitive: true,
        },
      ],
      direnvCommand: null,
      run,
    });

    return resolve("/workspace").pipe(
      Effect.map((environment) => {
        expect(environment).toEqual({
          PATH: "/base",
          KEEP: "yes",
          PROVIDER_TOKEN: "configured",
        });
        expect(run).not.toHaveBeenCalled();
      }),
    );
  });

  it.effect("applies direnv additions and removals before provider overrides", () => {
    const run = vi.fn<ProcessRunner.ProcessRunner["Service"]["run"]>(() =>
      Effect.succeed(
        output({
          stdout: JSON.stringify({
            PATH: "/direnv",
            REMOVE_ME: null,
            SHARED: "workspace",
            WORKSPACE_ONLY: "loaded",
          }),
        }),
      ),
    );
    const resolve = makeWorkspaceEnvironmentResolverWithRunner({
      baseEnvironment: {
        PATH: "/base",
        REMOVE_ME: "yes",
        SHARED: "base",
      },
      providerEnvironment: [
        {
          name: ProviderInstanceEnvironmentVariableName.make("SHARED"),
          value: "provider",
          sensitive: false,
        },
      ],
      direnvCommand: "/bin/direnv",
      run,
    });

    return resolve("/workspace/project").pipe(
      Effect.map((environment) => {
        expect(environment).toEqual({
          PATH: "/direnv",
          SHARED: "provider",
          WORKSPACE_ONLY: "loaded",
        });
        expect(run).toHaveBeenCalledWith({
          command: "/bin/direnv",
          args: ["export", "json"],
          cwd: "/workspace/project",
          env: {
            PATH: "/base",
            REMOVE_ME: "yes",
            SHARED: "base",
          },
          maxOutputBytes: 1024 * 1024,
          timeout: "2 minutes",
        });
      }),
    );
  });

  it.effect("keeps the base environment when direnv reports no changes", () => {
    const run = vi.fn<ProcessRunner.ProcessRunner["Service"]["run"]>(() =>
      Effect.succeed(output({ stdout: "" })),
    );
    const resolve = makeWorkspaceEnvironmentResolverWithRunner({
      baseEnvironment: { PATH: "/base", ALREADY_LOADED: "yes" },
      direnvCommand: "/bin/direnv",
      run,
    });

    return resolve("/workspace").pipe(
      Effect.map((environment) => {
        expect(environment).toEqual({ PATH: "/base", ALREADY_LOADED: "yes" });
      }),
    );
  });

  it.effect("restores provider-protected variables after workspace resolution", () => {
    const sessionEnvironment = makeProviderSessionEnvironmentWithResolver({
      processEnvironment: { HOME: "/server/home", KEEP: "provider" },
      resolveWorkspaceEnvironment: Effect.fn("test.resolveWorkspaceEnvironment")(() =>
        Effect.succeed({
          HOME: "/workspace/home",
          CODEX_HOME: "/workspace/codex",
          KEEP: "workspace",
        }),
      ),
    });

    return sessionEnvironment
      .resolve({
        cwd: "/workspace",
        provider: ProviderDriverKind.make("codex"),
        threadId: ThreadId.make("thread-protected-environment"),
        protectedVariables: ["HOME", "CODEX_HOME"],
      })
      .pipe(
        Effect.map((environment) => {
          expect(environment).toEqual({
            HOME: "/server/home",
            KEEP: "workspace",
          });
        }),
      );
  });

  it.effect("reports a blocked .envrc without echoing stderr contents", () => {
    const run = vi.fn<ProcessRunner.ProcessRunner["Service"]["run"]>(() =>
      Effect.succeed(
        output({
          code: 1,
          stderr: "direnv: error /workspace/.envrc is blocked SECRET_DO_NOT_ECHO",
        }),
      ),
    );
    const resolve = makeWorkspaceEnvironmentResolverWithRunner({
      baseEnvironment: { PATH: "/base" },
      direnvCommand: "/bin/direnv",
      run,
    });

    return resolve("/workspace").pipe(
      Effect.flip,
      Effect.map((error) => {
        expect(error).toBeInstanceOf(WorkspaceEnvironmentError);
        expect(error.message).toContain("direnv allow");
        expect(error.message).not.toContain("SECRET_DO_NOT_ECHO");
      }),
    );
  });

  it.effect("rejects malformed direnv JSON", () => {
    const run = vi.fn<ProcessRunner.ProcessRunner["Service"]["run"]>(() =>
      Effect.succeed(output({ stdout: "not-json" })),
    );
    const resolve = makeWorkspaceEnvironmentResolverWithRunner({
      baseEnvironment: { PATH: "/base" },
      direnvCommand: "/bin/direnv",
      run,
    });

    return resolve("/workspace").pipe(
      Effect.flip,
      Effect.map((error) => {
        expect(error.message).toContain("invalid JSON");
      }),
    );
  });

  it.effect("discovers direnv from the server PATH when the provider overrides PATH", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-direnv-path-"));
        const executable = NodePath.join(directory, "direnv");
        NodeFS.writeFileSync(executable, '#!/bin/sh\nprintf \'{"FROM_DIRENV":"yes"}\'\n', {
          mode: 0o755,
        });
        return directory;
      }),
      (directory) =>
        Effect.gen(function* () {
          const resolve = yield* makeWorkspaceEnvironmentResolver({
            baseEnvironment: { PATH: directory },
            providerEnvironment: [
              {
                name: ProviderInstanceEnvironmentVariableName.make("PATH"),
                value: "/provider-only",
                sensitive: false,
              },
            ],
          });

          const environment = yield* resolve(directory);

          expect(environment).toEqual({
            PATH: "/provider-only",
            FROM_DIRENV: "yes",
          });
        }),
      (directory) => Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
