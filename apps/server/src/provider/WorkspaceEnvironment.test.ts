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
  makeWorkspaceEnvironmentManagerWithRunner,
  makeWorkspaceEnvironmentResolver,
  makeWorkspaceEnvironmentResolverWithRunner,
  WorkspaceEnvironmentApprovalRequired,
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
    stdoutInvalidUtf8: false,
    stderrInvalidUtf8: false,
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
        expect(error).toBeInstanceOf(WorkspaceEnvironmentApprovalRequired);
        expect(error).toMatchObject({
          cwd: "/workspace",
          envrcPath: "/workspace/.envrc",
        });
        expect(error.message).not.toContain("SECRET_DO_NOT_ECHO");
      }),
    );
  });

  it.effect("reports blocked approval as inspectable state", () => {
    const run = vi.fn<ProcessRunner.ProcessRunner["Service"]["run"]>(() =>
      Effect.succeed(
        output({
          code: 1,
          stderr: "direnv: error /workspace/.envrc is blocked",
        }),
      ),
    );
    const manager = makeWorkspaceEnvironmentManagerWithRunner({
      baseEnvironment: { PATH: "/base" },
      direnvCommand: "/bin/direnv",
      run,
    });

    return manager.inspect("/workspace").pipe(
      Effect.map((status) => {
        expect(status).toEqual({
          _tag: "approvalRequired",
          envrcPath: "/workspace/.envrc",
        });
      }),
    );
  });

  it.effect("allows and validates a blocked workspace", () => {
    let allowed = false;
    const run = vi.fn<ProcessRunner.ProcessRunner["Service"]["run"]>((input) => {
      if (input.args[0] === "allow") {
        allowed = true;
        return Effect.succeed(output({}));
      }
      return Effect.succeed(
        allowed
          ? output({ stdout: JSON.stringify({ READY: "yes" }) })
          : output({
              code: 1,
              stderr: "direnv: error /workspace/.envrc is blocked",
            }),
      );
    });
    const manager = makeWorkspaceEnvironmentManagerWithRunner({
      baseEnvironment: { PATH: "/base" },
      direnvCommand: "/bin/direnv",
      run,
    });

    return manager.allow("/workspace").pipe(
      Effect.map((status) => {
        expect(status).toEqual({ _tag: "ready" });
        expect(run).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            args: ["allow", "/workspace/.envrc"],
            cwd: "/workspace",
          }),
        );
        expect(run).toHaveBeenCalledTimes(3);
      }),
    );
  });

  it.effect("inherits approval for an identical worktree .envrc", () => {
    const run = vi.fn<ProcessRunner.ProcessRunner["Service"]["run"]>(() =>
      Effect.succeed(output({ stdout: JSON.stringify({ READY: "yes" }) })),
    );
    const readFile = vi.fn<(path: string) => Promise<Uint8Array>>(() =>
      Promise.resolve(new TextEncoder().encode("use flake\n")),
    );
    const manager = makeWorkspaceEnvironmentManagerWithRunner({
      baseEnvironment: { PATH: "/base" },
      direnvCommand: "/bin/direnv",
      run,
      readFile,
    });

    return manager.prepareWorktree({ sourceCwd: "/project", targetCwd: "/worktree" }).pipe(
      Effect.map((inherited) => {
        expect(inherited).toBe(true);
        expect(readFile.mock.calls.map(([path]) => path)).toEqual([
          "/project/.envrc",
          "/worktree/.envrc",
          "/project/.envrc",
        ]);
        expect(run).toHaveBeenCalledWith(
          expect.objectContaining({
            args: ["allow", "/worktree/.envrc"],
            cwd: "/worktree",
          }),
        );
      }),
    );
  });

  it.effect(
    "copies an approved ignored .envrc into a new worktree before inheriting approval",
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-direnv-copy-"));
          const sourceCwd = NodePath.join(directory, "project");
          const targetCwd = NodePath.join(directory, "worktree");
          NodeFS.mkdirSync(sourceCwd);
          NodeFS.mkdirSync(targetCwd);
          NodeFS.writeFileSync(NodePath.join(sourceCwd, ".envrc"), "use flake\n", { mode: 0o600 });
          return { directory, sourceCwd, targetCwd };
        }),
        ({ sourceCwd, targetCwd }) =>
          Effect.gen(function* () {
            const run = vi.fn<ProcessRunner.ProcessRunner["Service"]["run"]>((input) => {
              if (input.command === "/bin/git") {
                return Effect.succeed(output({ code: 0 }));
              }
              return Effect.succeed(output({ stdout: JSON.stringify({ READY: "yes" }) }));
            });
            const manager = makeWorkspaceEnvironmentManagerWithRunner({
              baseEnvironment: { PATH: "/base" },
              direnvCommand: "/bin/direnv",
              gitCommand: "/bin/git",
              run,
            });

            const prepared = yield* manager.prepareWorktree({ sourceCwd, targetCwd });

            expect(prepared).toBe(true);
            expect(NodeFS.readFileSync(NodePath.join(targetCwd, ".envrc"), "utf8")).toBe(
              "use flake\n",
            );
            expect(NodeFS.statSync(NodePath.join(targetCwd, ".envrc")).mode & 0o777).toBe(0o600);
            expect(run.mock.calls.map(([input]) => [input.command, input.args, input.cwd])).toEqual(
              [
                ["/bin/direnv", ["export", "json"], sourceCwd],
                ["/bin/git", ["check-ignore", "--quiet", "--", ".envrc"], sourceCwd],
                ["/bin/git", ["check-ignore", "--quiet", "--", ".envrc"], targetCwd],
                ["/bin/direnv", ["allow", NodePath.join(targetCwd, ".envrc")], targetCwd],
                ["/bin/direnv", ["export", "json"], targetCwd],
              ],
            );
          }),
        ({ directory }) =>
          Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
      ),
  );

  it.effect("does not copy a missing worktree .envrc when the source file is not ignored", () => {
    const run = vi.fn<ProcessRunner.ProcessRunner["Service"]["run"]>((input) =>
      Effect.succeed(
        input.command === "/bin/git"
          ? output({ code: 1 })
          : output({ stdout: JSON.stringify({ READY: "yes" }) }),
      ),
    );
    const readFile = vi.fn<(path: string) => Promise<Uint8Array>>((path) =>
      path.startsWith("/project")
        ? Promise.resolve(new TextEncoder().encode("use flake\n"))
        : Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" })),
    );
    const writeFile = vi.fn(() => Promise.resolve());
    const manager = makeWorkspaceEnvironmentManagerWithRunner({
      baseEnvironment: { PATH: "/base" },
      direnvCommand: "/bin/direnv",
      gitCommand: "/bin/git",
      run,
      readFile,
      writeFile,
    });

    return manager.prepareWorktree({ sourceCwd: "/project", targetCwd: "/worktree" }).pipe(
      Effect.map((prepared) => {
        expect(prepared).toBe(false);
        expect(writeFile).not.toHaveBeenCalled();
        expect(run).toHaveBeenCalledTimes(2);
      }),
    );
  });

  it.effect("does not copy when the target branch would expose the ignored source .envrc", () => {
    const run = vi.fn<ProcessRunner.ProcessRunner["Service"]["run"]>((input) =>
      Effect.succeed(
        input.command === "/bin/git"
          ? output({ code: input.cwd === "/project" ? 0 : 1 })
          : output({ stdout: JSON.stringify({ READY: "yes" }) }),
      ),
    );
    const readFile = vi.fn<(path: string) => Promise<Uint8Array>>((path) =>
      path.startsWith("/project")
        ? Promise.resolve(new TextEncoder().encode("use flake\n"))
        : Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" })),
    );
    const writeFile = vi.fn(() => Promise.resolve());
    const manager = makeWorkspaceEnvironmentManagerWithRunner({
      baseEnvironment: { PATH: "/base" },
      direnvCommand: "/bin/direnv",
      gitCommand: "/bin/git",
      run,
      readFile,
      writeFile,
    });

    return manager.prepareWorktree({ sourceCwd: "/project", targetCwd: "/worktree" }).pipe(
      Effect.map((prepared) => {
        expect(prepared).toBe(false);
        expect(writeFile).not.toHaveBeenCalled();
        expect(run.mock.calls.map(([input]) => [input.command, input.cwd])).toEqual([
          ["/bin/direnv", "/project"],
          ["/bin/git", "/project"],
          ["/bin/git", "/worktree"],
        ]);
      }),
    );
  });

  it.effect("does not inherit approval when the worktree .envrc differs", () => {
    const run = vi.fn<ProcessRunner.ProcessRunner["Service"]["run"]>(() =>
      Effect.succeed(output({ stdout: JSON.stringify({ READY: "yes" }) })),
    );
    const readFile = vi.fn<(path: string) => Promise<Uint8Array>>((path) =>
      Promise.resolve(
        new TextEncoder().encode(path.startsWith("/project") ? "trusted" : "changed"),
      ),
    );
    const manager = makeWorkspaceEnvironmentManagerWithRunner({
      baseEnvironment: { PATH: "/base" },
      direnvCommand: "/bin/direnv",
      run,
      readFile,
    });

    return manager.prepareWorktree({ sourceCwd: "/project", targetCwd: "/worktree" }).pipe(
      Effect.map((inherited) => {
        expect(inherited).toBe(false);
        expect(run).toHaveBeenCalledTimes(1);
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
