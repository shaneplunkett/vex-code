// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type {
  ProviderDriverKind,
  ProviderInstanceEnvironment,
  ThreadId,
  WorkspaceEnvironmentStatus,
} from "@t3tools/contracts";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import { ProviderAdapterProcessError } from "./Errors.ts";
import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";

const DIRENV_EXPORT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DIRENV_EXPORT_TIMEOUT = "2 minutes" as const;

const DirenvExport = Schema.Record(Schema.String, Schema.NullOr(Schema.String));
const decodeDirenvExport = Schema.decodeUnknownEffect(Schema.fromJsonString(DirenvExport));

export class WorkspaceEnvironmentError extends Schema.TaggedErrorClass<WorkspaceEnvironmentError>()(
  "WorkspaceEnvironmentError",
  {
    cwd: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Could not load the workspace environment for '${this.cwd}': ${this.detail}`;
  }
}

export class WorkspaceEnvironmentApprovalRequired extends Schema.TaggedErrorClass<WorkspaceEnvironmentApprovalRequired>()(
  "WorkspaceEnvironmentApprovalRequired",
  {
    cwd: Schema.String,
    envrcPath: Schema.String,
  },
) {
  override get message(): string {
    return `The workspace .envrc is blocked for '${this.cwd}'.`;
  }
}

export type WorkspaceEnvironmentResolveError =
  | WorkspaceEnvironmentApprovalRequired
  | WorkspaceEnvironmentError;

export type WorkspaceEnvironmentResolver = (
  cwd: string,
) => Effect.Effect<NodeJS.ProcessEnv, WorkspaceEnvironmentResolveError>;

export interface WorkspaceEnvironmentManager {
  readonly resolve: WorkspaceEnvironmentResolver;
  readonly inspect: (
    cwd: string,
  ) => Effect.Effect<WorkspaceEnvironmentStatus, WorkspaceEnvironmentError>;
  readonly allow: (
    cwd: string,
  ) => Effect.Effect<WorkspaceEnvironmentStatus, WorkspaceEnvironmentError>;
  readonly inheritApproval: (input: {
    readonly sourceCwd: string;
    readonly targetCwd: string;
  }) => Effect.Effect<boolean, WorkspaceEnvironmentError>;
}

export interface ProviderSessionEnvironment {
  readonly processEnvironment: NodeJS.ProcessEnv;
  readonly resolve: (input: {
    readonly cwd: string;
    readonly provider: ProviderDriverKind;
    readonly threadId: ThreadId;
    readonly protectedVariables?: ReadonlyArray<string>;
  }) => Effect.Effect<NodeJS.ProcessEnv, ProviderAdapterProcessError>;
}

export interface ProviderSessionEnvironmentOptions {
  readonly sessionEnvironment?: ProviderSessionEnvironment;
}

interface WorkspaceEnvironmentResolverOptions {
  readonly baseEnvironment?: NodeJS.ProcessEnv;
  readonly providerEnvironment?: ProviderInstanceEnvironment;
}

interface WorkspaceEnvironmentRunnerOptions extends WorkspaceEnvironmentResolverOptions {
  readonly direnvCommand: string | null;
  readonly run: ProcessRunner.ProcessRunner["Service"]["run"];
  readonly readFile?: (path: string) => Promise<Uint8Array>;
}

function applyDirenvExport(
  baseEnvironment: NodeJS.ProcessEnv,
  exported: Readonly<Record<string, string | null>>,
): NodeJS.ProcessEnv {
  const environment = { ...baseEnvironment };
  for (const [name, value] of Object.entries(exported)) {
    if (value === null) {
      delete environment[name];
    } else {
      environment[name] = value;
    }
  }
  return environment;
}

function restoreProtectedVariables(
  environment: NodeJS.ProcessEnv,
  processEnvironment: NodeJS.ProcessEnv,
  names: ReadonlyArray<string> | undefined,
): NodeJS.ProcessEnv {
  if (names === undefined || names.length === 0) return environment;
  const restored = { ...environment };
  for (const name of names) {
    const value = processEnvironment[name];
    if (value === undefined) {
      delete restored[name];
    } else {
      restored[name] = value;
    }
  }
  return restored;
}

function blockedEnvrcPath(stderr: string, cwd: string): string {
  const match = /direnv:\s+error\s+(.+?)\s+(?:is blocked|is not allowed)/i.exec(stderr);
  return match?.[1]?.trim() || NodePath.join(cwd, ".envrc");
}

function direnvFailure(
  cwd: string,
  stderr: string,
  code: number | null,
): WorkspaceEnvironmentResolveError {
  const normalized = stderr.toLowerCase();
  if (normalized.includes("is blocked") || normalized.includes("not allowed")) {
    return new WorkspaceEnvironmentApprovalRequired({
      cwd,
      envrcPath: blockedEnvrcPath(stderr, cwd),
    });
  }
  return new WorkspaceEnvironmentError({
    cwd,
    detail: `direnv export failed${code === null ? "" : ` with exit code ${code}`}. Run 'direnv export json' in the workspace for details.`,
  });
}

export function makeWorkspaceEnvironmentManagerWithRunner(
  options: WorkspaceEnvironmentRunnerOptions,
): WorkspaceEnvironmentManager {
  const baseEnvironment = { ...(options.baseEnvironment ?? process.env) };
  const fallbackEnvironment = mergeProviderInstanceEnvironment(
    options.providerEnvironment,
    baseEnvironment,
  );

  const direnvCommand = options.direnvCommand;
  const readFile = options.readFile ?? NodeFSP.readFile;
  if (direnvCommand === null) {
    const resolve = Effect.fn("WorkspaceEnvironmentResolver.fallback")(() =>
      Effect.succeed({ ...fallbackEnvironment }),
    );
    return {
      resolve,
      inspect: Effect.fn("WorkspaceEnvironmentManager.inspectInactive")(() =>
        Effect.succeed({ _tag: "inactive" as const }),
      ),
      allow: Effect.fn("WorkspaceEnvironmentManager.allowInactive")(() =>
        Effect.succeed({ _tag: "inactive" as const }),
      ),
      inheritApproval: Effect.fn("WorkspaceEnvironmentManager.inheritInactive")(() =>
        Effect.succeed(false),
      ),
    };
  }

  const resolve = Effect.fn("WorkspaceEnvironmentResolver.resolve")(function* (cwd: string) {
    const output = yield* options
      .run({
        command: direnvCommand,
        args: ["export", "json"],
        cwd,
        env: baseEnvironment,
        maxOutputBytes: DIRENV_EXPORT_MAX_OUTPUT_BYTES,
        timeout: DIRENV_EXPORT_TIMEOUT,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceEnvironmentError({
              cwd,
              detail: "direnv could not be started or did not finish successfully.",
              cause,
            }),
        ),
      );

    if (output.code !== 0) {
      return yield* direnvFailure(cwd, output.stderr, output.code);
    }

    // direnv emits an empty successful export when the supplied environment
    // is already current for this directory (and when there is no applicable
    // .envrc). In either case there is no diff to apply.
    if (output.stdout.trim().length === 0) {
      return { ...fallbackEnvironment };
    }

    const exported = yield* decodeDirenvExport(output.stdout).pipe(
      Effect.mapError(
        () =>
          new WorkspaceEnvironmentError({
            cwd,
            detail: "direnv returned an invalid JSON environment export.",
          }),
      ),
    );
    const workspaceEnvironment = applyDirenvExport(baseEnvironment, exported);

    // Explicit provider-instance values remain authoritative over project
    // values. Provider internals (for example CODEX_HOME and MCP tokens) are
    // applied by their adapters after this resolver returns.
    return mergeProviderInstanceEnvironment(options.providerEnvironment, workspaceEnvironment);
  });

  const inspect = Effect.fn("WorkspaceEnvironmentManager.inspect")(function* (cwd: string) {
    return yield* resolve(cwd).pipe(
      Effect.as({ _tag: "ready" as const }),
      Effect.catchTag("WorkspaceEnvironmentApprovalRequired", (error) =>
        Effect.succeed({
          _tag: "approvalRequired" as const,
          envrcPath: error.envrcPath,
        }),
      ),
    );
  });

  const allowEnvrc = Effect.fn("WorkspaceEnvironmentManager.allowEnvrc")(function* (
    cwd: string,
    envrcPath: string,
  ) {
    const output = yield* options
      .run({
        command: direnvCommand,
        args: ["allow", envrcPath],
        cwd,
        env: baseEnvironment,
        maxOutputBytes: DIRENV_EXPORT_MAX_OUTPUT_BYTES,
        timeout: DIRENV_EXPORT_TIMEOUT,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceEnvironmentError({
              cwd,
              detail: "direnv could not approve the workspace .envrc.",
              cause,
            }),
        ),
      );
    if (output.code !== 0) {
      return yield* new WorkspaceEnvironmentError({
        cwd,
        detail: `direnv allow failed${output.code === null ? "" : ` with exit code ${output.code}`}.`,
      });
    }
  });

  const allow = Effect.fn("WorkspaceEnvironmentManager.allow")(function* (cwd: string) {
    const status = yield* inspect(cwd);
    if (status._tag !== "approvalRequired") return status;
    yield* allowEnvrc(cwd, status.envrcPath);
    const confirmed = yield* inspect(cwd);
    if (confirmed._tag === "approvalRequired") {
      return yield* new WorkspaceEnvironmentError({
        cwd,
        detail: "direnv still reports the workspace .envrc as blocked after approval.",
      });
    }
    return confirmed;
  });

  const inheritApproval = Effect.fn("WorkspaceEnvironmentManager.inheritApproval")(
    function* (input: { readonly sourceCwd: string; readonly targetCwd: string }) {
      const sourceStatus = yield* inspect(input.sourceCwd);
      if (sourceStatus._tag !== "ready") return false;

      const sourceEnvrcPath = NodePath.join(input.sourceCwd, ".envrc");
      const targetEnvrcPath = NodePath.join(input.targetCwd, ".envrc");
      const [sourceEnvrc, targetEnvrc] = yield* Effect.all([
        Effect.tryPromise(() => readFile(sourceEnvrcPath)).pipe(Effect.option),
        Effect.tryPromise(() => readFile(targetEnvrcPath)).pipe(Effect.option),
      ]);
      if (Option.isNone(sourceEnvrc) || Option.isNone(targetEnvrc)) return false;
      if (!Buffer.from(sourceEnvrc.value).equals(Buffer.from(targetEnvrc.value))) return false;

      yield* allowEnvrc(input.targetCwd, targetEnvrcPath);
      const targetStatus = yield* inspect(input.targetCwd);
      if (targetStatus._tag !== "ready") {
        return yield* new WorkspaceEnvironmentError({
          cwd: input.targetCwd,
          detail: "The matching worktree .envrc could not be approved.",
        });
      }
      return true;
    },
  );

  return { resolve, inspect, allow, inheritApproval };
}

export function makeWorkspaceEnvironmentResolverWithRunner(
  options: WorkspaceEnvironmentRunnerOptions,
): WorkspaceEnvironmentResolver {
  return makeWorkspaceEnvironmentManagerWithRunner(options).resolve;
}

export const makeWorkspaceEnvironmentManager = Effect.fn("makeWorkspaceEnvironmentManager")(
  function* (options: WorkspaceEnvironmentResolverOptions = {}) {
    const baseEnvironment = { ...(options.baseEnvironment ?? process.env) };
    const resolvedCommand = yield* resolveCommandPath("direnv", {
      // direnv is server infrastructure, not a provider binary. Discover it
      // from the server environment so an instance-specific PATH cannot
      // accidentally disable workspace environment loading.
      env: baseEnvironment,
    }).pipe(Effect.option);
    const processRunner = yield* ProcessRunner.make();

    return makeWorkspaceEnvironmentManagerWithRunner({
      ...options,
      baseEnvironment,
      direnvCommand: Option.getOrNull(resolvedCommand),
      run: processRunner.run,
    });
  },
);

export const makeWorkspaceEnvironmentResolver = Effect.fn("makeWorkspaceEnvironmentResolver")(
  function* (options: WorkspaceEnvironmentResolverOptions = {}) {
    return (yield* makeWorkspaceEnvironmentManager(options)).resolve;
  },
);

export function makeProviderSessionEnvironmentWithResolver(options: {
  readonly processEnvironment: NodeJS.ProcessEnv;
  readonly resolveWorkspaceEnvironment: WorkspaceEnvironmentResolver;
}): ProviderSessionEnvironment {
  return {
    processEnvironment: options.processEnvironment,
    resolve: Effect.fn("ProviderSessionEnvironment.resolve")(function* (input) {
      const environment = yield* options.resolveWorkspaceEnvironment(input.cwd).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterProcessError({
              provider: input.provider,
              threadId: input.threadId,
              detail: cause.message,
              cause,
            }),
        ),
      );
      return restoreProtectedVariables(
        environment,
        options.processEnvironment,
        input.protectedVariables,
      );
    }),
  };
}

export const makeProviderSessionEnvironment = Effect.fn("makeProviderSessionEnvironment")(
  function* (options: WorkspaceEnvironmentResolverOptions = {}) {
    const processEnvironment = mergeProviderInstanceEnvironment(
      options.providerEnvironment,
      options.baseEnvironment,
    );
    const resolveWorkspaceEnvironment = yield* makeWorkspaceEnvironmentResolver(options);
    return makeProviderSessionEnvironmentWithResolver({
      processEnvironment,
      resolveWorkspaceEnvironment,
    });
  },
);

export const resolveProviderSessionEnvironment = Effect.fn("resolveProviderSessionEnvironment")(
  function* (input: {
    readonly sessionEnvironment?: ProviderSessionEnvironment | undefined;
    readonly cwd: string;
    readonly provider: ProviderDriverKind;
    readonly threadId: ThreadId;
    readonly protectedVariables?: ReadonlyArray<string>;
  }) {
    if (input.sessionEnvironment === undefined) {
      return undefined;
    }
    return yield* input.sessionEnvironment.resolve(input);
  },
);
