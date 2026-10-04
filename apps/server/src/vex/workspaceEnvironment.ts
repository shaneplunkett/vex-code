// @effect-diagnostics nodeBuiltinImport:off
import * as NodeZlib from "node:zlib";

import {
  WS_METHODS,
  type WorkspaceEnvironmentInput,
  WorkspaceEnvironmentRequestError,
  type WorkspaceEnvironmentStatus,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { makeKeyedSerialExecutor } from "../orchestration-v2/KeyedSerialExecutor.ts";
import * as ProcessRunner from "../processRunner.ts";
import type * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

/**
 * Variables an `.envrc` exports or unsets, as `direnv export json` reports
 * them. `null` unsets the variable.
 */
export type WorkspaceEnvironmentDiff = Readonly<Record<string, string | null>>;

export interface WorkspaceEnvironmentResolution {
  readonly status: WorkspaceEnvironmentStatus;
  /** Empty unless the status is `ready`. */
  readonly environment: WorkspaceEnvironmentDiff;
}

const EMPTY_DIFF: WorkspaceEnvironmentDiff = {};
const DIRENV_TIMEOUT = "2 minutes" as const;
const DIRENV_STATUS_TIMEOUT = "15 seconds" as const;
const DIRENV_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * T3 and its providers own these. An `.envrc` that sets one would point a
 * provider at the wrong home or break its connection back to T3.
 */
function isProtectedVariable(name: string): boolean {
  return (
    name === "HOME" ||
    name === "CODEX_HOME" ||
    name === "CLAUDE_CONFIG_DIR" ||
    name.startsWith("T3CODE_") ||
    name.startsWith("T3_")
  );
}

/** Applies a workspace diff on top of an environment without mutating it. */
export function applyWorkspaceEnvironment(
  environment: NodeJS.ProcessEnv,
  diff: WorkspaceEnvironmentDiff | undefined,
): NodeJS.ProcessEnv {
  if (diff === undefined || Object.keys(diff).length === 0) return environment;
  const next = { ...environment };
  for (const [name, value] of Object.entries(diff)) {
    if (value === null) delete next[name];
    else next[name] = value;
  }
  return next;
}

/** Where provider adapters read a turn's workspace diff from. */
interface WithWorkspaceDiff {
  readonly environment?: WorkspaceEnvironmentDiff | undefined;
}

/**
 * The environment a provider process should start with: its own environment
 * (the server's when undefined) plus the thread directory's `.envrc` diff.
 */
export function withWorkspaceEnvironment(
  environment: NodeJS.ProcessEnv,
  runtimePolicy: WithWorkspaceDiff | undefined,
): NodeJS.ProcessEnv;
export function withWorkspaceEnvironment(
  environment: NodeJS.ProcessEnv | undefined,
  runtimePolicy: WithWorkspaceDiff | undefined,
): NodeJS.ProcessEnv | undefined;
export function withWorkspaceEnvironment(
  environment: NodeJS.ProcessEnv | undefined,
  runtimePolicy: WithWorkspaceDiff | undefined,
): NodeJS.ProcessEnv | undefined {
  const diff = runtimePolicy?.environment;
  if (diff === undefined || Object.keys(diff).length === 0) return environment;
  return applyWorkspaceEnvironment(environment ?? process.env, diff);
}

/**
 * The same, for a spawn whose `env` extends the server environment by default.
 * Unsetting a variable needs the full environment, so the result never extends.
 */
export function withWorkspaceEnvironmentSpawn<
  Spawn extends { readonly env?: NodeJS.ProcessEnv; readonly extendEnv?: boolean },
>(spawn: Spawn, diff: WorkspaceEnvironmentDiff | undefined): Spawn {
  if (diff === undefined || Object.keys(diff).length === 0) return spawn;
  const base = spawn.extendEnv === false ? (spawn.env ?? {}) : { ...process.env, ...spawn.env };
  return { ...spawn, env: applyWorkspaceEnvironment(base, diff), extendEnv: false };
}

/**
 * Codex runs one shared process for every thread, so the diff travels as
 * per-thread config overrides instead. Codex re-exports these after its shell
 * snapshot, so they win over the PATH the snapshot captured. It has no way to
 * unset a variable, so unsets are dropped.
 */
export function codexWorkspaceEnvironmentConfig(
  runtimePolicy: WithWorkspaceDiff | undefined,
): Readonly<Record<string, string>> {
  const entries = Object.entries(runtimePolicy?.environment ?? {}).flatMap(([name, value]) =>
    value !== null && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
      ? [[`shell_environment_policy.set.${name}`, value] as const]
      : [],
  );
  return Object.fromEntries(entries);
}

/** A stable identity for a diff, so a changed `.envrc` result can be detected. */
export function workspaceEnvironmentFingerprint(diff: WorkspaceEnvironmentDiff): string {
  return JSON.stringify(Object.entries(diff).toSorted(([a], [b]) => a.localeCompare(b)));
}

const DirenvExport = Schema.Record(Schema.String, Schema.NullOr(Schema.String));
const decodeDirenvExport = Schema.decodeUnknownOption(Schema.fromJsonString(DirenvExport));

const DirenvStatus = Schema.Struct({
  state: Schema.Struct({
    foundRC: Schema.NullOr(Schema.Struct({ path: Schema.String, allowed: Schema.Number })),
  }),
});
const decodeDirenvStatus = Schema.decodeUnknownOption(Schema.fromJsonString(DirenvStatus));

const DirenvWatches = Schema.Array(
  Schema.Struct({ path: Schema.String, modtime: Schema.Number, exists: Schema.Boolean }),
);
type DirenvWatches = typeof DirenvWatches.Type;
const decodeDirenvWatchesJson = Schema.decodeUnknownOption(Schema.fromJsonString(DirenvWatches));

/** `DIRENV_WATCHES` is zlib-compressed JSON in URL-safe base64. */
function decodeDirenvWatches(encoded: string | null | undefined): DirenvWatches | undefined {
  if (!encoded) return undefined;
  try {
    const json = NodeZlib.inflateSync(Buffer.from(encoded, "base64url")).toString("utf8");
    return Option.getOrUndefined(decodeDirenvWatchesJson(json));
  } catch {
    return undefined;
  }
}

function lastLines(text: string, count: number): string {
  return text.trim().split("\n").slice(-count).join("\n");
}

type DirenvInspection =
  | { readonly _tag: "inactive" }
  | { readonly _tag: "direnvMissing"; readonly envrcPath: string }
  | { readonly _tag: "blocked"; readonly envrcPath: string }
  | { readonly _tag: "allowed"; readonly envrcPath: string };

interface CachedResolution {
  readonly resolution: WorkspaceEnvironmentResolution;
  readonly watches: DirenvWatches;
}

export interface WorkspaceEnvironmentShape {
  /**
   * Loads the `.envrc` that applies to `cwd`. Never fails: problems come back
   * as a status with an empty environment. A ready result is cached until a
   * file direnv watches changes, including direnv's own allow and deny records.
   */
  readonly resolve: (cwd: string) => Effect.Effect<WorkspaceEnvironmentResolution>;
  /** The status a client shows, without waiting on a slow `.envrc` evaluation. */
  readonly status: (cwd: string) => Effect.Effect<WorkspaceEnvironmentStatus>;
  readonly allow: (
    cwd: string,
  ) => Effect.Effect<WorkspaceEnvironmentStatus, WorkspaceEnvironmentRequestError>;
  readonly revoke: (
    cwd: string,
  ) => Effect.Effect<WorkspaceEnvironmentStatus, WorkspaceEnvironmentRequestError>;
  /**
   * Copies a gitignored `.envrc` into a new worktree and allows the copy when
   * the original is allowed and the bytes match. Failures are only logged.
   */
  readonly prepareWorktree: (input: {
    readonly sourceCwd: string;
    readonly targetCwd: string;
  }) => Effect.Effect<void>;
}

export class WorkspaceEnvironment extends Context.Service<
  WorkspaceEnvironment,
  WorkspaceEnvironmentShape
>()("t3/vex/workspaceEnvironment") {}

export interface WorkspaceEnvironmentOptions {
  /** Null when direnv is not installed on the server's PATH. */
  readonly direnvCommand: string | null;
  readonly gitCommand: string | null;
  readonly baseEnvironment: NodeJS.ProcessEnv;
  readonly run: ProcessRunner.ProcessRunner["Service"]["run"];
}

export const makeWithOptions = Effect.fn("WorkspaceEnvironment.makeWithOptions")(function* (
  options: WorkspaceEnvironmentOptions,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serial = yield* makeKeyedSerialExecutor<string>();
  const cache = new Map<string, CachedResolution>();
  // The last failure per directory, so the status a client reads matches what
  // the most recent turn hit without re-running a slow evaluation.
  const failures = new Map<string, WorkspaceEnvironmentStatus>();
  const { direnvCommand, baseEnvironment } = options;

  const runDirenv = (cwd: string, args: ReadonlyArray<string>, timeout: Duration.Input) =>
    direnvCommand === null
      ? Effect.die("direnv is not available.")
      : options.run({
          command: direnvCommand,
          args,
          cwd,
          env: baseEnvironment,
          timeout,
          maxOutputBytes: DIRENV_MAX_OUTPUT_BYTES,
          timeoutBehavior: "timedOutResult",
        });

  const findEnvrc = Effect.fn("WorkspaceEnvironment.findEnvrc")(function* (cwd: string) {
    let directory = path.resolve(cwd);
    while (true) {
      const candidate = path.join(directory, ".envrc");
      const isFile = yield* fileSystem.stat(candidate).pipe(
        Effect.map((info) => info.type === "File"),
        Effect.orElseSucceed(() => false),
      );
      if (isFile) return Option.some(candidate);
      const parent = path.dirname(directory);
      if (parent === directory) return Option.none<string>();
      directory = parent;
    }
  });

  const inspect = Effect.fn("WorkspaceEnvironment.inspect")(function* (cwd: string) {
    if (direnvCommand === null) {
      const envrcPath = yield* findEnvrc(cwd);
      return Option.match(envrcPath, {
        onNone: (): DirenvInspection => ({ _tag: "inactive" }),
        onSome: (envrcPath): DirenvInspection => ({ _tag: "direnvMissing", envrcPath }),
      });
    }
    const output = yield* runDirenv(cwd, ["status", "--json"], DIRENV_STATUS_TIMEOUT);
    const foundRC = Option.getOrUndefined(decodeDirenvStatus(output.stdout))?.state.foundRC;
    if (output.code !== 0 || foundRC === undefined) {
      return yield* Effect.fail(`direnv status failed. ${lastLines(output.stderr, 3)}`.trim());
    }
    if (foundRC === null) return { _tag: "inactive" } satisfies DirenvInspection;
    // direnv reports 0 for allowed, 1 for not yet allowed and 2 for denied.
    return foundRC.allowed === 0
      ? ({ _tag: "allowed", envrcPath: foundRC.path } satisfies DirenvInspection)
      : ({ _tag: "blocked", envrcPath: foundRC.path } satisfies DirenvInspection);
  });

  const watchesUnchanged = Effect.fn("WorkspaceEnvironment.watchesUnchanged")(function* (
    watches: DirenvWatches,
  ) {
    for (const watch of watches) {
      const info = yield* fileSystem.stat(watch.path).pipe(Effect.option);
      const exists = Option.isSome(info);
      if (exists !== watch.exists) return false;
      if (!exists) continue;
      const modtime = Option.match(info.value.mtime, {
        onNone: () => 0,
        onSome: (mtime) => Math.floor(mtime.getTime() / 1000),
      });
      if (modtime !== watch.modtime) return false;
    }
    return true;
  });

  const evaluate = Effect.fn("WorkspaceEnvironment.evaluate")(function* (
    cwd: string,
    envrcPath: string,
  ) {
    const failed = (detail: string) => {
      const status: WorkspaceEnvironmentStatus = { _tag: "failed", envrcPath, detail };
      failures.set(cwd, status);
      return { status, environment: EMPTY_DIFF } satisfies WorkspaceEnvironmentResolution;
    };
    const output = yield* runDirenv(cwd, ["export", "json"], DIRENV_TIMEOUT);
    if (output.timedOut) return failed("direnv took longer than 2 minutes to load it.");
    if (output.code !== 0) {
      return failed(lastLines(output.stderr, 5) || `direnv exited with code ${output.code}.`);
    }
    const exported =
      output.stdout.trim().length === 0
        ? Option.some(EMPTY_DIFF)
        : decodeDirenvExport(output.stdout);
    if (Option.isNone(exported)) return failed("direnv returned output T3 could not read.");
    const environment = Object.fromEntries(
      Object.entries(exported.value).filter(([name]) => !isProtectedVariable(name)),
    );
    failures.delete(cwd);
    const resolution: WorkspaceEnvironmentResolution = {
      status: { _tag: "ready", envrcPath },
      environment,
    };
    const watches = decodeDirenvWatches(exported.value.DIRENV_WATCHES);
    // Without a watch list there is nothing to invalidate on, so re-run next time.
    if (watches === undefined) cache.delete(cwd);
    else cache.set(cwd, { resolution, watches });
    return resolution;
  });

  const resolveUncached = Effect.fn("WorkspaceEnvironment.resolveUncached")(function* (
    cwd: string,
  ) {
    const cached = cache.get(cwd);
    if (cached !== undefined && (yield* watchesUnchanged(cached.watches))) {
      return cached.resolution;
    }
    cache.delete(cwd);
    const inspection = yield* inspect(cwd);
    switch (inspection._tag) {
      case "inactive":
        failures.delete(cwd);
        return { status: inspection, environment: EMPTY_DIFF };
      case "direnvMissing":
      case "blocked":
        failures.delete(cwd);
        return { status: inspection, environment: EMPTY_DIFF };
      case "allowed":
        return yield* evaluate(cwd, inspection.envrcPath);
    }
  });

  const resolve: WorkspaceEnvironmentShape["resolve"] = (cwd) =>
    serial.withLock(
      cwd,
      resolveUncached(cwd).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not load the workspace .envrc", { cwd, cause }).pipe(
            Effect.as<WorkspaceEnvironmentResolution>({
              status: { _tag: "inactive" },
              environment: EMPTY_DIFF,
            }),
          ),
        ),
      ),
    );

  const statusFromInspection = (
    cwd: string,
    inspection: DirenvInspection,
  ): WorkspaceEnvironmentStatus =>
    inspection._tag === "allowed"
      ? (failures.get(cwd) ?? { _tag: "ready", envrcPath: inspection.envrcPath })
      : inspection;

  const status: WorkspaceEnvironmentShape["status"] = Effect.fn("WorkspaceEnvironment.status")(
    function* (cwd) {
      const cached = cache.get(cwd);
      if (cached !== undefined && (yield* watchesUnchanged(cached.watches))) {
        return cached.resolution.status;
      }
      const inspection = yield* inspect(cwd);
      return statusFromInspection(cwd, inspection);
    },
    Effect.catchCause(() => Effect.succeed<WorkspaceEnvironmentStatus>({ _tag: "inactive" })),
  );

  const requestError = (cwd: string, message: string) => (cause: unknown) =>
    new WorkspaceEnvironmentRequestError({ cwd, message, cause });

  /** Runs `direnv allow` or `direnv deny` on the `.envrc` that applies to `cwd`. */
  const setTrust = Effect.fn("WorkspaceEnvironment.setTrust")(function* (
    cwd: string,
    action: "allow" | "deny",
  ) {
    const inspection = yield* inspect(cwd).pipe(
      Effect.mapError(requestError(cwd, "direnv could not inspect this directory.")),
    );
    if (inspection._tag === "inactive" || inspection._tag === "direnvMissing") {
      return statusFromInspection(cwd, inspection);
    }
    const output = yield* runDirenv(
      cwd,
      [action, inspection.envrcPath],
      DIRENV_STATUS_TIMEOUT,
    ).pipe(Effect.mapError(requestError(cwd, `direnv ${action} could not run.`)));
    if (output.code !== 0) {
      return yield* requestError(
        cwd,
        lastLines(output.stderr, 3) || `direnv ${action} exited with code ${output.code}.`,
      )(undefined);
    }
    cache.clear();
    failures.clear();
    const confirmed = yield* inspect(cwd).pipe(
      Effect.mapError(requestError(cwd, "direnv could not inspect this directory.")),
    );
    if (action === "allow" && confirmed._tag === "allowed") {
      // Warm the cache so the next turn does not wait on a cold evaluation.
      yield* resolve(cwd).pipe(Effect.forkDetach);
    }
    return statusFromInspection(cwd, confirmed);
  });

  const isGitIgnored = Effect.fn("WorkspaceEnvironment.isGitIgnored")(function* (cwd: string) {
    if (options.gitCommand === null) return false;
    const output = yield* options.run({
      command: options.gitCommand,
      args: ["check-ignore", "--quiet", "--", ".envrc"],
      cwd,
      env: baseEnvironment,
      timeout: DIRENV_STATUS_TIMEOUT,
    });
    return output.code === 0;
  });

  const prepareWorktree: WorkspaceEnvironmentShape["prepareWorktree"] = Effect.fn(
    "WorkspaceEnvironment.prepareWorktree",
  )(
    function* (input) {
      if (direnvCommand === null) return;
      const sourcePath = path.join(input.sourceCwd, ".envrc");
      const targetPath = path.join(input.targetCwd, ".envrc");
      const source = yield* fileSystem.readFile(sourcePath).pipe(Effect.option);
      if (Option.isNone(source)) return;

      if (!(yield* fileSystem.exists(targetPath))) {
        // A tracked `.envrc` arrives with the checkout. Only an ignored one is ours to bring.
        if (!(yield* isGitIgnored(input.sourceCwd))) return;
        const sourceInfo = yield* fileSystem.stat(sourcePath);
        yield* fileSystem.writeFile(targetPath, source.value, {
          flag: "wx",
          mode: sourceInfo.mode & 0o777,
        });
      }

      const sourceInspection = yield* inspect(input.sourceCwd);
      if (sourceInspection._tag !== "allowed" || sourceInspection.envrcPath !== sourcePath) return;
      const target = yield* fileSystem.readFile(targetPath);
      if (!Buffer.from(target).equals(Buffer.from(source.value))) return;
      const allowed = yield* runDirenv(
        input.targetCwd,
        ["allow", targetPath],
        DIRENV_STATUS_TIMEOUT,
      );
      if (allowed.code !== 0) {
        yield* Effect.logWarning("direnv could not allow the worktree .envrc", {
          targetPath,
          stderr: lastLines(allowed.stderr, 3),
        });
      }
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not prepare the worktree .envrc", { cause }),
    ),
  );

  return WorkspaceEnvironment.of({
    resolve,
    status,
    allow: (cwd) => serial.withLock(cwd, setTrust(cwd, "allow")),
    revoke: (cwd) => serial.withLock(cwd, setTrust(cwd, "deny")),
    prepareWorktree,
  });
});

export const make = Effect.fn("WorkspaceEnvironment.make")(function* () {
  const baseEnvironment = yield* HostProcessEnvironment;
  // direnv and git are server tools, looked up on the server's own PATH so a
  // provider instance's PATH cannot switch the feature off.
  const direnvCommand = yield* resolveCommandPath("direnv", { env: baseEnvironment }).pipe(
    Effect.option,
  );
  const gitCommand = yield* resolveCommandPath("git", { env: baseEnvironment }).pipe(Effect.option);
  const processRunner = yield* ProcessRunner.ProcessRunner;
  return yield* makeWithOptions({
    direnvCommand: Option.getOrNull(direnvCommand),
    gitCommand: Option.getOrNull(gitCommand),
    baseEnvironment,
    run: processRunner.run,
  });
});

export const layer = Layer.effect(WorkspaceEnvironment, make()).pipe(
  Layer.provide(ProcessRunner.layer),
);

/** The WebSocket handlers for the workspace environment RPCs. */
export const rpcHandlers = (workspaceEnvironment: WorkspaceEnvironmentShape) => ({
  [WS_METHODS.workspaceEnvironmentStatus]: (input: WorkspaceEnvironmentInput) =>
    workspaceEnvironment.status(input.cwd),
  [WS_METHODS.workspaceEnvironmentAllow]: (input: WorkspaceEnvironmentInput) =>
    workspaceEnvironment.allow(input.cwd),
  [WS_METHODS.workspaceEnvironmentRevoke]: (input: WorkspaceEnvironmentInput) =>
    workspaceEnvironment.revoke(input.cwd),
});

/**
 * Wraps the git driver so every new worktree gets the project's gitignored
 * `.envrc` before anything (the setup script, a terminal, a turn) runs in it.
 */
export const withWorktreeEnvrc = Effect.fn("WorkspaceEnvironment.withWorktreeEnvrc")(function* (
  driver: GitVcsDriver.GitVcsDriver["Service"],
) {
  const workspaceEnvironment = yield* WorkspaceEnvironment;
  const wrapped: GitVcsDriver.GitVcsDriver["Service"] = {
    ...driver,
    createWorktree: (input, worktreeOptions) =>
      driver.createWorktree(input, worktreeOptions).pipe(
        Effect.tap((result) =>
          workspaceEnvironment.prepareWorktree({
            sourceCwd: input.cwd,
            targetCwd: result.worktree.path,
          }),
        ),
      ),
  };
  return wrapped;
});
