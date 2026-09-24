#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const EXPECTED_BRANCH = "main";
const FORK_REMOTE = "origin";
const UPSTREAM_REMOTE = "upstream";
const DISABLED_PUSH_URL = "DISABLED";
const NIGHTLY_TAG_PATTERN = "v*-nightly.*";

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export class UpstreamSyncProcessError extends Schema.TaggedError<UpstreamSyncProcessError>()(
  "UpstreamSyncProcessError",
  {
    operation: Schema.Literals(["spawn", "communicate"]),
    executable: Schema.String,
    argumentCount: NonNegativeInt,
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Upstream sync process operation "${this.operation}" failed for ${this.executable}.`;
  }
}

export class UpstreamSyncCommandError extends Schema.TaggedError<UpstreamSyncCommandError>()(
  "UpstreamSyncCommandError",
  {
    executable: Schema.String,
    argumentCount: NonNegativeInt,
    cwd: Schema.String,
    exitCode: Schema.Int,
    stdoutLength: NonNegativeInt,
    stderrLength: NonNegativeInt,
  },
) {
  override get message(): string {
    return `${this.executable} exited with code ${this.exitCode} during upstream sync.`;
  }
}

const UpstreamSyncGuardReason = Schema.Literals([
  "dirty-worktree",
  "dropped-vex-seam",
  "missing-nightly-tag",
  "remote-history-diverged",
  "target-not-in-upstream",
  "unexpected-branch",
  "unknown-target-tag",
]);
type UpstreamSyncGuardReason = typeof UpstreamSyncGuardReason.Type;

export class UpstreamSyncGuardError extends Schema.TaggedError<UpstreamSyncGuardError>()(
  "UpstreamSyncGuardError",
  {
    reason: UpstreamSyncGuardReason,
    detail: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "dirty-worktree":
        return "The worktree must be clean before syncing upstream.";
      case "dropped-vex-seam":
        return `The merge left these Vex modules with no importer outside their own directory: ${this.detail ?? "unknown"}. Reattach each one through its narrowest seam before completing the sync.`;
      case "missing-nightly-tag":
        return "No published upstream nightly tag was found.";
      case "remote-history-diverged":
        return "Local main does not contain origin/main; pull or reconcile the fork before syncing.";
      case "target-not-in-upstream":
        return `The requested tag${this.detail ? ` ${this.detail}` : ""} is not part of upstream/main.`;
      case "unexpected-branch":
        return `Upstream sync must run on ${EXPECTED_BRANCH}, not ${this.detail ?? "a detached HEAD"}.`;
      case "unknown-target-tag":
        return `The requested tag${this.detail ? ` ${this.detail}` : ""} does not exist locally after fetching upstream.`;
    }
  }
}

interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface RunProcessInput {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly inheritOutput?: boolean;
  readonly allowedExitCodes?: ReadonlyArray<number>;
}

export interface SyncUpstreamOptions {
  readonly rootDir?: string | undefined;
  readonly targetTag?: string | undefined;
  readonly dryRun?: boolean | undefined;
  /** Test-only escape hatch. The user-facing command always runs validation. */
  readonly skipChecks?: boolean | undefined;
}

export interface SyncUpstreamResult {
  readonly status: "merged" | "up-to-date" | "dry-run";
  readonly targetTag: string;
  readonly incomingCommitCount: number;
  readonly ranMobileLint: boolean;
}

const collectStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const runProcess = Effect.fn("runProcess")(function* (
  input: RunProcessInput,
): Effect.fn.Return<
  ProcessResult,
  UpstreamSyncProcessError | UpstreamSyncCommandError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const context = {
    executable: input.executable,
    argumentCount: input.args.length,
    cwd: input.cwd,
  } as const;
  const child = yield* spawner
    .spawn(
      ChildProcess.make(input.executable, input.args, {
        cwd: input.cwd,
        ...(input.inheritOutput ? { stdout: "inherit", stderr: "inherit" } : {}),
      }),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new UpstreamSyncProcessError({
            ...context,
            operation: "spawn",
            cause,
          }),
      ),
    );

  const [stdout, stderr, exitCode] = yield* (
    input.inheritOutput
      ? Effect.all([
          Effect.succeed(""),
          Effect.succeed(""),
          child.exitCode.pipe(Effect.map(Number)),
        ])
      : Effect.all(
          [
            collectStreamAsString(child.stdout),
            collectStreamAsString(child.stderr),
            child.exitCode.pipe(Effect.map(Number)),
          ],
          { concurrency: "unbounded" },
        )
  ).pipe(
    Effect.mapError(
      (cause) =>
        new UpstreamSyncProcessError({
          ...context,
          operation: "communicate",
          cause,
        }),
    ),
  );

  if (!(input.allowedExitCodes ?? [0]).includes(exitCode)) {
    return yield* new UpstreamSyncCommandError({
      ...context,
      exitCode,
      stdoutLength: stdout.length,
      stderrLength: stderr.length,
    });
  }

  return { stdout, stderr, exitCode };
});

const runGit = Effect.fn("runGit")(function* (
  cwd: string,
  args: ReadonlyArray<string>,
  options: Pick<RunProcessInput, "allowedExitCodes" | "inheritOutput"> = {},
) {
  return yield* runProcess({
    executable: "git",
    args,
    cwd,
    ...options,
  }).pipe(Effect.scoped);
});

const runVisibleCommand = Effect.fn("runVisibleCommand")(function* (
  cwd: string,
  executable: string,
  args: ReadonlyArray<string>,
) {
  yield* Console.log(`$ ${[executable, ...args].join(" ")}`);
  return yield* runProcess({ executable, args, cwd, inheritOutput: true }).pipe(Effect.scoped);
});

export function selectLatestNightlyTag(rawTags: string): string | undefined {
  return rawTags
    .split("\n")
    .map((tag) => tag.trim())
    .find((tag) => tag.length > 0);
}

/**
 * Import specifiers that would wire this Vex module into the rest of the app. TypeScript modules are
 * imported with or without their extension, other assets always carry theirs. The trailing quote keeps
 * `vex/theme` from matching an import of `vex/theme.css`.
 */
function vexImportSpecifiers(modulePath: string): ReadonlyArray<string> {
  const basename = modulePath.slice(modulePath.lastIndexOf("/") + 1);
  const scriptExtension = /\.tsx?$/.exec(basename);
  const candidates =
    scriptExtension === null ? [basename] : [basename, basename.slice(0, scriptExtension.index)];
  return candidates.flatMap((candidate) => [`vex/${candidate}"`, `vex/${candidate}'`]);
}

/**
 * Names Vex layer modules that nothing outside their own directory imports any more.
 *
 * Resolving a sync conflict toward upstream deletes the one-line import that wires a Vex module in, but
 * leaves the module itself on disk. The fork still typechecks and its tests still pass, so the only
 * symptom is upstream's behaviour quietly rendering in place of ours.
 */
export function findDroppedVexSeams(
  vexModulePaths: ReadonlyArray<string>,
  externalImportSources: string,
): ReadonlyArray<string> {
  return vexModulePaths.filter(
    (modulePath) =>
      !/\.test\.[cm]?tsx?$/.test(modulePath) &&
      !vexImportSpecifiers(modulePath).some((specifier) =>
        externalImportSources.includes(specifier),
      ),
  );
}

export function requiresMobileLint(paths: ReadonlyArray<string>): boolean {
  return paths.some(
    (path) =>
      path.startsWith("apps/mobile/") &&
      (path.includes("/ios/") ||
        path.includes("/android/") ||
        path.endsWith(".swift") ||
        path.endsWith(".kt") ||
        path.endsWith(".kts")),
  );
}

const ensureVexSeamsIntact = Effect.fn("ensureVexSeamsIntact")(function* (rootDir: string) {
  const vexModulePaths = (yield* runGit(rootDir, ["ls-files", "apps/*/src/vex/*"])).stdout
    .split("\n")
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
  if (vexModulePaths.length === 0) {
    return;
  }

  // git grep exits 1 when nothing matches, which is a real answer here rather than a failure.
  const externalImportSources = (yield* runGit(
    rootDir,
    [
      "grep",
      "-h",
      "-E",
      "vex/[A-Za-z0-9._-]+[\"']",
      "--",
      "apps",
      "packages",
      ":!*/vex/*",
      ":!*.md",
    ],
    { allowedExitCodes: [0, 1] },
  )).stdout;

  const droppedSeams = findDroppedVexSeams(vexModulePaths, externalImportSources);
  if (droppedSeams.length > 0) {
    return yield* new UpstreamSyncGuardError({
      reason: "dropped-vex-seam",
      detail: droppedSeams.join(", "),
    });
  }
  yield* Console.log(`Verified ${vexModulePaths.length} Vex layer modules are still wired in.`);
});

const ensureTargetTag = Effect.fn("ensureTargetTag")(function* (
  rootDir: string,
  requestedTag: string | undefined,
) {
  const targetTag =
    requestedTag ??
    selectLatestNightlyTag(
      (yield* runGit(rootDir, [
        "tag",
        `--merged=${UPSTREAM_REMOTE}/${EXPECTED_BRANCH}`,
        "--sort=-version:refname",
        "--list",
        NIGHTLY_TAG_PATTERN,
      ])).stdout,
    );

  if (!targetTag) {
    return yield* new UpstreamSyncGuardError({ reason: "missing-nightly-tag" });
  }

  const targetRef = `refs/tags/${targetTag}^{commit}`;
  const tagExists = yield* runGit(rootDir, ["rev-parse", "--quiet", "--verify", targetRef], {
    allowedExitCodes: [0, 1],
  });
  if (tagExists.exitCode !== 0) {
    return yield* new UpstreamSyncGuardError({
      reason: "unknown-target-tag",
      detail: targetTag,
    });
  }

  const belongsToUpstream = yield* runGit(
    rootDir,
    ["merge-base", "--is-ancestor", targetRef, `${UPSTREAM_REMOTE}/${EXPECTED_BRANCH}`],
    { allowedExitCodes: [0, 1] },
  );
  if (belongsToUpstream.exitCode !== 0) {
    return yield* new UpstreamSyncGuardError({
      reason: "target-not-in-upstream",
      detail: targetTag,
    });
  }

  return { targetTag, targetRef };
});

export const syncUpstream = Effect.fn("syncUpstream")(function* (
  options: SyncUpstreamOptions = {},
): Effect.fn.Return<
  SyncUpstreamResult,
  UpstreamSyncProcessError | UpstreamSyncCommandError | UpstreamSyncGuardError,
  ChildProcessSpawner.ChildProcessSpawner
> {
  const initialDirectory = options.rootDir ?? process.cwd();
  const rootDir = (yield* runGit(initialDirectory, ["rev-parse", "--show-toplevel"])).stdout.trim();
  yield* runGit(rootDir, ["remote", "set-url", "--push", UPSTREAM_REMOTE, DISABLED_PUSH_URL]);
  const status = (yield* runGit(rootDir, ["status", "--porcelain"])).stdout.trim();
  if (status.length > 0) {
    return yield* new UpstreamSyncGuardError({ reason: "dirty-worktree" });
  }

  const currentBranch = (yield* runGit(rootDir, ["branch", "--show-current"])).stdout.trim();
  if (currentBranch !== EXPECTED_BRANCH) {
    return yield* new UpstreamSyncGuardError({
      reason: "unexpected-branch",
      detail: currentBranch || undefined,
    });
  }

  yield* runVisibleCommand(rootDir, "git", ["fetch", FORK_REMOTE, EXPECTED_BRANCH]);
  const containsRemoteMain = yield* runGit(
    rootDir,
    ["merge-base", "--is-ancestor", `${FORK_REMOTE}/${EXPECTED_BRANCH}`, "HEAD"],
    { allowedExitCodes: [0, 1] },
  );
  if (containsRemoteMain.exitCode !== 0) {
    return yield* new UpstreamSyncGuardError({ reason: "remote-history-diverged" });
  }

  yield* runVisibleCommand(rootDir, "git", [
    "fetch",
    UPSTREAM_REMOTE,
    EXPECTED_BRANCH,
    "--tags",
    "--prune",
  ]);

  const { targetTag, targetRef } = yield* ensureTargetTag(rootDir, options.targetTag);
  const alreadyContainsTarget = yield* runGit(
    rootDir,
    ["merge-base", "--is-ancestor", targetRef, "HEAD"],
    { allowedExitCodes: [0, 1] },
  );
  if (alreadyContainsTarget.exitCode === 0) {
    yield* Console.log(`${targetTag} is already contained in ${EXPECTED_BRANCH}.`);
    return {
      status: "up-to-date",
      targetTag,
      incomingCommitCount: 0,
      ranMobileLint: false,
    };
  }

  const incomingCommitCount = Number(
    (yield* runGit(rootDir, ["rev-list", "--count", `HEAD..${targetRef}`])).stdout.trim(),
  );
  yield* Console.log(
    `Selected ${targetTag} with ${incomingCommitCount} incoming upstream commit${incomingCommitCount === 1 ? "" : "s"}.`,
  );

  if (options.dryRun ?? false) {
    yield* Console.log("Dry run complete; no merge was started.");
    return {
      status: "dry-run",
      targetTag,
      incomingCommitCount,
      ranMobileLint: false,
    };
  }

  return yield* Effect.gen(function* () {
    yield* runVisibleCommand(rootDir, "git", ["merge", "--no-ff", "--no-commit", targetRef]);
    yield* ensureVexSeamsIntact(rootDir);

    let ranMobileLint = false;
    if (!(options.skipChecks ?? false)) {
      yield* runVisibleCommand(rootDir, "pnpm", ["install", "--frozen-lockfile"]);
      yield* runVisibleCommand(rootDir, "vp", ["check"]);
      yield* runVisibleCommand(rootDir, "vp", ["run", "typecheck"]);

      const changedPaths = (yield* runGit(rootDir, ["diff", "--cached", "--name-only"])).stdout
        .split("\n")
        .map((path) => path.trim())
        .filter((path) => path.length > 0);
      ranMobileLint = requiresMobileLint(changedPaths);
      if (ranMobileLint) {
        yield* runVisibleCommand(rootDir, "vp", ["run", "lint:mobile"]);
      }
    }

    yield* runVisibleCommand(rootDir, "git", ["commit", "-m", `chore: sync upstream ${targetTag}`]);
    yield* Console.log(
      `Created the local ${targetTag} merge. Review it, then push ${EXPECTED_BRANCH} to ${FORK_REMOTE} when ready.`,
    );

    return {
      status: "merged",
      targetTag,
      incomingCommitCount,
      ranMobileLint,
    } satisfies SyncUpstreamResult;
  }).pipe(
    Effect.tapError(() =>
      Console.error(
        "The upstream merge is still local. Resolve and continue it, or run git merge --abort to return to the previous state.",
      ),
    ),
  );
});

export const syncUpstreamCommand = Command.make(
  "sync-upstream",
  {
    tag: Flag.String("tag").pipe(
      Flag.withDescription("Sync a specific fetched upstream tag instead of the latest nightly."),
      Flag.optional,
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Fetch and report the selected release without starting a merge."),
      Flag.withDefault(false),
    ),
  },
  ({ tag, dryRun }) =>
    syncUpstream({
      targetTag: Option.getOrUndefined(tag),
      dryRun,
    }),
).pipe(
  Command.withDescription(
    "Merge a published T3 Code nightly into local main, validate it, and stop before pushing.",
  ),
);

if (import.meta.main) {
  Command.run(syncUpstreamCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
