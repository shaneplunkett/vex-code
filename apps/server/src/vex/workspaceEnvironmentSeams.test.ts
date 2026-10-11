// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

/**
 * Upstream merges guard. The sync script only checks that each vex module has
 * some importer; direnv reaches each provider through its own small seam, and
 * resolving a conflict toward upstream drops one without breaking the build.
 * When this fails, reattach the named seam rather than deleting the entry.
 */
const SEAMS: ReadonlyArray<{
  readonly file: string;
  readonly expects: ReadonlyArray<string>;
  readonly why: string;
}> = [
  {
    file: "packages/provider-core/src/server/ProviderAdapter.ts",
    expects: ["environment: Schema.optional("],
    why: "runtime policy carries the .envrc diff",
  },
  {
    file: "apps/server/src/orchestration-v2/ProviderTurnStartService.ts",
    expects: ["workspaceEnvironmentTurns.prepare("],
    why: "turn start loads the .envrc, refreshes sessions and posts warnings",
  },
  {
    file: "apps/server/src/orchestration-v2/runtimeLayer.ts",
    expects: ["WorkspaceEnvironmentTurns.layer"],
    why: "without the layer the turn hook silently falls back to a no-op",
  },
  {
    file: "apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts",
    expects: ["withWorkspaceEnvironment("],
    why: "Claude query env",
  },
  {
    file: "apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts",
    expects: ["codexWorkspaceEnvironmentConfig("],
    why: "Codex per-thread shell environment config",
  },
  {
    file: "packages/provider-acp/src/server/adapter.ts",
    expects: ["workspaceEnvironment: input.runtimePolicy.environment"],
    why: "ACP flavors (Grok, Antigravity, registry) receive the diff",
  },
  {
    file: "packages/provider-acp/src/server/AcpSessionRuntime.ts",
    expects: ["withWorkspaceEnvironmentSpawn("],
    why: "ACP spawn applies the diff",
  },
  {
    file: "packages/provider-pi/src/server/adapter.ts",
    expects: ["withWorkspaceEnvironment("],
    why: "Pi launch env",
  },
  {
    file: "packages/provider-muse/src/server/adapter.ts",
    expects: ["withWorkspaceEnvironment("],
    why: "Muse host env",
  },
  {
    file: "packages/provider-opencode/src/server/adapter.ts",
    expects: ["withWorkspaceEnvironment("],
    why: "OpenCode 1 server env",
  },
  {
    file: "apps/server/src/terminal/Manager.ts",
    expects: ["resolveWorkspaceEnvironment(session.cwd)", "WorkspaceEnvironment.layer"],
    why: "terminals and setup scripts",
  },
  {
    file: "apps/server/src/vcs/GitVcsDriver.ts",
    expects: ["withWorktreeEnvrc", "WorkspaceEnvironment.layer"],
    why: "gitignored .envrc copied into new worktrees",
  },
  {
    file: "apps/server/src/ws.ts",
    expects: ["WorkspaceEnvironment.rpcHandlers("],
    why: "status, allow and revoke RPCs",
  },
];

const repoRoot = NodePath.resolve(import.meta.dirname, "../../../..");

describe("workspace environment seams", () => {
  it.each(SEAMS)("$file: $why", (seam) => {
    const source = NodeFS.readFileSync(NodePath.join(repoRoot, seam.file), "utf8");
    for (const expected of seam.expects) {
      expect(source, `${seam.file} lost its direnv seam`).toContain(expected);
    }
  });
});
