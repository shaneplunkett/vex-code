import type { ProviderDriverKind, ProviderInstanceEnvironment, ThreadId } from "@t3tools/contracts";
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

export type WorkspaceEnvironmentResolver = (
  cwd: string,
) => Effect.Effect<NodeJS.ProcessEnv, WorkspaceEnvironmentError>;

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

function direnvFailureDetail(stderr: string, code: number | null): string {
  const normalized = stderr.toLowerCase();
  if (normalized.includes("is blocked") || normalized.includes("not allowed")) {
    return "The workspace .envrc is blocked. Run 'direnv allow' in the workspace, then retry the session.";
  }
  return `direnv export failed${code === null ? "" : ` with exit code ${code}`}. Run 'direnv export json' in the workspace for details.`;
}

export function makeWorkspaceEnvironmentResolverWithRunner(
  options: WorkspaceEnvironmentRunnerOptions,
): WorkspaceEnvironmentResolver {
  const baseEnvironment = { ...(options.baseEnvironment ?? process.env) };
  const fallbackEnvironment = mergeProviderInstanceEnvironment(
    options.providerEnvironment,
    baseEnvironment,
  );

  const direnvCommand = options.direnvCommand;
  if (direnvCommand === null) {
    return Effect.fn("WorkspaceEnvironmentResolver.fallback")(() =>
      Effect.succeed({ ...fallbackEnvironment }),
    );
  }

  return Effect.fn("WorkspaceEnvironmentResolver.resolve")(function* (cwd: string) {
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
      return yield* new WorkspaceEnvironmentError({
        cwd,
        detail: direnvFailureDetail(output.stderr, output.code),
      });
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
}

export const makeWorkspaceEnvironmentResolver = Effect.fn("makeWorkspaceEnvironmentResolver")(
  function* (options: WorkspaceEnvironmentResolverOptions = {}) {
    const baseEnvironment = { ...(options.baseEnvironment ?? process.env) };
    const resolvedCommand = yield* resolveCommandPath("direnv", {
      // direnv is server infrastructure, not a provider binary. Discover it
      // from the server environment so an instance-specific PATH cannot
      // accidentally disable workspace environment loading.
      env: baseEnvironment,
    }).pipe(Effect.option);
    const processRunner = yield* ProcessRunner.make();

    return makeWorkspaceEnvironmentResolverWithRunner({
      ...options,
      baseEnvironment,
      direnvCommand: Option.getOrNull(resolvedCommand),
      run: processRunner.run,
    });
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
