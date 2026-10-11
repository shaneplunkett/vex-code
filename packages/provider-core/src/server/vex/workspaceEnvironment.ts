/**
 * The provider half of the fork's direnv support: how an adapter applies a
 * turn's `.envrc` diff to the process it launches. Loading, caching and
 * allowing the `.envrc` live in apps/server/src/vex/workspaceEnvironment.ts.
 */

/**
 * Variables an `.envrc` exports or unsets, as `direnv export json` reports
 * them. `null` unsets the variable.
 */
export type WorkspaceEnvironmentDiff = Readonly<Record<string, string | null>>;

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
