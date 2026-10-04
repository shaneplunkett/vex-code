// @effect-diagnostics nodeBuiltinImport:off
import * as NodeZlib from "node:zlib";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Clock from "effect/Clock";

import type * as ProcessRunner from "../processRunner.ts";
import {
  applyWorkspaceEnvironment,
  codexWorkspaceEnvironmentConfig,
  makeWithOptions,
  withWorkspaceEnvironmentSpawn,
} from "./workspaceEnvironment.ts";

interface FakeDirenv {
  /** `.envrc` paths direnv treats as allowed. */
  readonly allowed: Set<string>;
  /** What `direnv export json` prints, or a failure. */
  exportResult: { readonly stdout: string } | { readonly stderr: string; readonly code: number };
  readonly calls: Array<ReadonlyArray<string>>;
  gitIgnored: boolean;
}

const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const output = (stdout: string, code = 0, stderr = ""): ProcessRunner.ProcessRunOutput =>
  ({
    stdout,
    stderr,
    code,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutInvalidUtf8: false,
    stderrInvalidUtf8: false,
  }) as ProcessRunner.ProcessRunOutput;

const encodeWatches = (
  watches: ReadonlyArray<{ path: string; modtime: number; exists: boolean }>,
) => NodeZlib.deflateSync(toJson(watches)).toString("base64url");

/** Finds the nearest `.envrc` the way direnv does and answers like direnv 2.37. */
const makeFakeDirenv = (fileSystem: FileSystem.FileSystem, path: Path.Path, fake: FakeDirenv) =>
  ((input: ProcessRunner.ProcessRunInput) =>
    Effect.gen(function* () {
      fake.calls.push([input.command, ...input.args]);
      if (input.command === "git") return output("", fake.gitIgnored ? 0 : 1);
      let envrcPath: string | null = null;
      for (let directory = input.cwd ?? "/"; ; directory = path.dirname(directory)) {
        const candidate = path.join(directory, ".envrc");
        if (yield* fileSystem.exists(candidate)) {
          envrcPath = candidate;
          break;
        }
        if (path.dirname(directory) === directory) break;
      }
      const [command, target] = input.args;
      if (command === "status") {
        return output(
          toJson({
            state: {
              foundRC:
                envrcPath === null
                  ? null
                  : { path: envrcPath, allowed: fake.allowed.has(envrcPath) ? 0 : 1 },
            },
          }),
        );
      }
      if (command === "allow" && target !== undefined) {
        fake.allowed.add(target);
        return output("");
      }
      if (command === "deny" && target !== undefined) {
        fake.allowed.delete(target);
        return output("");
      }
      if (command === "export") {
        return "stdout" in fake.exportResult
          ? output(fake.exportResult.stdout)
          : output("", fake.exportResult.code, fake.exportResult.stderr);
      }
      return output("", 1, "unexpected command");
    }).pipe(Effect.orDie)) as ProcessRunner.ProcessRunner["Service"]["run"];

const setup = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-direnv-" });
  const project = path.join(root, "project");
  yield* fileSystem.makeDirectory(path.join(project, "src"), { recursive: true });
  const envrcPath = path.join(project, ".envrc");
  yield* fileSystem.writeFileString(envrcPath, "use flake\n");
  const modtime = (filePath: string) =>
    fileSystem
      .stat(filePath)
      .pipe(
        Effect.map((info) =>
          info.mtime._tag === "Some" ? Math.floor(info.mtime.value.getTime() / 1000) : 0,
        ),
      );
  const fake: FakeDirenv = {
    allowed: new Set(),
    exportResult: { stdout: "" },
    calls: [],
    gitIgnored: true,
  };
  const exportWith = (environment: Record<string, string | null>) =>
    Effect.gen(function* () {
      fake.exportResult = {
        stdout: toJson({
          ...environment,
          DIRENV_WATCHES: encodeWatches([
            { path: envrcPath, modtime: yield* modtime(envrcPath), exists: true },
          ]),
        }),
      };
    });
  const make = (direnvCommand: string | null = "direnv") =>
    makeWithOptions({
      direnvCommand,
      gitCommand: "git",
      baseEnvironment: {},
      run: makeFakeDirenv(fileSystem, path, fake),
    });
  const exportCalls = () => fake.calls.filter((call) => call[1] === "export").length;
  return { fileSystem, path, root, project, envrcPath, fake, exportWith, make, exportCalls };
});

describe("WorkspaceEnvironment", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("is inactive where no .envrc applies", () =>
      Effect.gen(function* () {
        const { root, make } = yield* setup;
        const environment = yield* make();
        expect(yield* environment.resolve(root)).toEqual({
          status: { _tag: "inactive" },
          environment: {},
        });
      }).pipe(Effect.scoped),
    );

    it.effect("reports a blocked .envrc without evaluating it", () =>
      Effect.gen(function* () {
        const { project, envrcPath, make, exportCalls } = yield* setup;
        const environment = yield* make();
        const resolution = yield* environment.resolve(project);
        expect(resolution.status).toEqual({ _tag: "blocked", envrcPath });
        expect(resolution.environment).toEqual({});
        expect(exportCalls()).toBe(0);
      }).pipe(Effect.scoped),
    );

    it.effect("loads an allowed .envrc for subdirectories, minus variables T3 owns", () =>
      Effect.gen(function* () {
        const { project, path, envrcPath, fake, exportWith, make } = yield* setup;
        fake.allowed.add(envrcPath);
        yield* exportWith({
          PATH: "/flake/bin:/usr/bin",
          OLD: null,
          HOME: "/elsewhere",
          CODEX_HOME: "/elsewhere/.codex",
          T3CODE_HOME: "/elsewhere/.t3",
        });
        const environment = yield* make();
        const resolution = yield* environment.resolve(path.join(project, "src"));
        expect(resolution.status).toEqual({ _tag: "ready", envrcPath });
        expect(resolution.environment).toMatchObject({ PATH: "/flake/bin:/usr/bin", OLD: null });
        expect(resolution.environment).not.toHaveProperty("HOME");
        expect(resolution.environment).not.toHaveProperty("CODEX_HOME");
        expect(resolution.environment).not.toHaveProperty("T3CODE_HOME");
      }).pipe(Effect.scoped),
    );

    it.effect("reuses the result until a watched file changes", () =>
      Effect.gen(function* () {
        const { fileSystem, project, envrcPath, fake, exportWith, make, exportCalls } =
          yield* setup;
        fake.allowed.add(envrcPath);
        yield* exportWith({ FOO: "1" });
        const environment = yield* make();
        yield* environment.resolve(project);
        yield* environment.resolve(project);
        expect(exportCalls()).toBe(1);

        const later = (yield* Clock.currentTimeMillis) / 1000 + 5;
        yield* fileSystem.utimes(envrcPath, later, later);
        yield* exportWith({ FOO: "2" });
        const resolution = yield* environment.resolve(project);
        expect(exportCalls()).toBe(2);
        expect(resolution.environment).toMatchObject({ FOO: "2" });
      }).pipe(Effect.scoped),
    );

    it.effect("reports a failed evaluation and keeps reporting it to clients", () =>
      Effect.gen(function* () {
        const { project, envrcPath, fake, make } = yield* setup;
        fake.allowed.add(envrcPath);
        fake.exportResult = { code: 1, stderr: "direnv: loading .envrc\nerror: flake.nix broke" };
        const environment = yield* make();
        const resolution = yield* environment.resolve(project);
        const failed = {
          _tag: "failed",
          envrcPath,
          detail: "direnv: loading .envrc\nerror: flake.nix broke",
        };
        expect(resolution).toEqual({ status: failed, environment: {} });
        expect(yield* environment.status(project)).toEqual(failed);
      }).pipe(Effect.scoped),
    );

    it.effect("reports a missing direnv only where an .envrc exists", () =>
      Effect.gen(function* () {
        const { root, project, envrcPath, make } = yield* setup;
        const environment = yield* make(null);
        expect((yield* environment.resolve(project)).status).toEqual({
          _tag: "direnvMissing",
          envrcPath,
        });
        expect((yield* environment.resolve(root)).status).toEqual({ _tag: "inactive" });
      }).pipe(Effect.scoped),
    );

    it.effect("allows and revokes through direnv's own allow list", () =>
      Effect.gen(function* () {
        const { project, envrcPath, fake, exportWith, make } = yield* setup;
        yield* exportWith({ FOO: "1" });
        const environment = yield* make();
        expect(yield* environment.allow(project)).toEqual({ _tag: "ready", envrcPath });
        expect(fake.calls).toContainEqual(["direnv", "allow", envrcPath]);
        expect((yield* environment.resolve(project)).environment).toMatchObject({ FOO: "1" });

        expect(yield* environment.revoke(project)).toEqual({ _tag: "blocked", envrcPath });
        expect(fake.calls).toContainEqual(["direnv", "deny", envrcPath]);
        expect((yield* environment.resolve(project)).status._tag).toBe("blocked");
      }).pipe(Effect.scoped),
    );

    it.effect("copies a gitignored .envrc into a worktree and allows the identical copy", () =>
      Effect.gen(function* () {
        const { fileSystem, path, root, project, envrcPath, fake, make } = yield* setup;
        fake.allowed.add(envrcPath);
        const worktree = path.join(root, "worktree");
        yield* fileSystem.makeDirectory(worktree);
        const environment = yield* make();
        yield* environment.prepareWorktree({ sourceCwd: project, targetCwd: worktree });
        const copied = path.join(worktree, ".envrc");
        expect(yield* fileSystem.readFileString(copied)).toBe("use flake\n");
        expect(fake.allowed.has(copied)).toBe(true);
      }).pipe(Effect.scoped),
    );

    it.effect("leaves a worktree alone when the .envrc is not gitignored", () =>
      Effect.gen(function* () {
        const { fileSystem, path, root, project, envrcPath, fake, make } = yield* setup;
        fake.allowed.add(envrcPath);
        fake.gitIgnored = false;
        const worktree = path.join(root, "worktree");
        yield* fileSystem.makeDirectory(worktree);
        const environment = yield* make();
        yield* environment.prepareWorktree({ sourceCwd: project, targetCwd: worktree });
        expect(yield* fileSystem.exists(path.join(worktree, ".envrc"))).toBe(false);
      }).pipe(Effect.scoped),
    );

    it.effect("copies but does not allow when the original is not allowed", () =>
      Effect.gen(function* () {
        const { fileSystem, path, root, project, fake, make } = yield* setup;
        const worktree = path.join(root, "worktree");
        yield* fileSystem.makeDirectory(worktree);
        const environment = yield* make();
        yield* environment.prepareWorktree({ sourceCwd: project, targetCwd: worktree });
        const copied = path.join(worktree, ".envrc");
        expect(yield* fileSystem.exists(copied)).toBe(true);
        expect(fake.allowed.has(copied)).toBe(false);
      }).pipe(Effect.scoped),
    );
  });
});

describe("workspace environment helpers", () => {
  it("applies exports and unsets without touching the original", () => {
    const base = { PATH: "/usr/bin", OLD: "x", KEEP: "y" };
    expect(applyWorkspaceEnvironment(base, { PATH: "/flake/bin", OLD: null })).toEqual({
      PATH: "/flake/bin",
      KEEP: "y",
    });
    expect(base.OLD).toBe("x");
  });

  it("rebuilds an extending spawn as a full environment so unsets take effect", () => {
    const original: { command: string; env?: NodeJS.ProcessEnv; extendEnv?: boolean } = {
      command: "grok",
      env: { GROK_KEY: "k" },
    };
    const spawn = withWorkspaceEnvironmentSpawn(original, { PATH: "/flake/bin", USER: null });
    expect(spawn.extendEnv).toBe(false);
    expect(spawn.env).toMatchObject({ GROK_KEY: "k", PATH: "/flake/bin" });
    expect(spawn.env).not.toHaveProperty("USER");
  });

  it("turns the diff into Codex shell environment overrides", () => {
    expect(
      codexWorkspaceEnvironmentConfig({
        environment: { PATH: "/flake/bin", OLD: null, "BAD NAME": "x" },
      }),
    ).toEqual({ "shell_environment_policy.set.PATH": "/flake/bin" });
  });
});
