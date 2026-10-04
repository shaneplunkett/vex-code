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
    file: "orchestration-v2/ProviderAdapter.ts",
    expects: ["environment: Schema.optional("],
    why: "runtime policy carries the .envrc diff",
  },
  {
    file: "orchestration-v2/ProviderTurnStartService.ts",
    expects: ["workspaceEnvironmentTurns.prepare("],
    why: "turn start loads the .envrc, refreshes sessions and posts warnings",
  },
  {
    file: "orchestration-v2/runtimeLayer.ts",
    expects: ["WorkspaceEnvironmentTurns.layer"],
    why: "without the layer the turn hook silently falls back to a no-op",
  },
  {
    file: "orchestration-v2/Adapters/ClaudeAdapterV2.ts",
    expects: ["withWorkspaceEnvironment("],
    why: "Claude query env",
  },
  {
    file: "orchestration-v2/Adapters/CodexAdapterV2.ts",
    expects: ["codexWorkspaceEnvironmentConfig("],
    why: "Codex per-thread shell environment config",
  },
  {
    file: "orchestration-v2/Adapters/AcpAdapterV2.ts",
    expects: ["workspaceEnvironment: input.runtimePolicy.environment"],
    why: "ACP flavors (Grok, Antigravity, registry) receive the diff",
  },
  {
    file: "provider/acp/AcpSessionRuntime.ts",
    expects: ["withWorkspaceEnvironmentSpawn("],
    why: "ACP spawn applies the diff",
  },
  {
    file: "orchestration-v2/Adapters/PiAdapterV2.ts",
    expects: ["withWorkspaceEnvironment("],
    why: "Pi launch env",
  },
  {
    file: "orchestration-v2/Adapters/OpenCodeAdapterV2.ts",
    expects: ["withWorkspaceEnvironment("],
    why: "OpenCode 1 server env",
  },
  {
    file: "terminal/Manager.ts",
    expects: ["resolveWorkspaceEnvironment(session.cwd)", "WorkspaceEnvironment.layer"],
    why: "terminals and setup scripts",
  },
  {
    file: "vcs/GitVcsDriver.ts",
    expects: ["withWorktreeEnvrc", "WorkspaceEnvironment.layer"],
    why: "gitignored .envrc copied into new worktrees",
  },
  {
    file: "ws.ts",
    expects: ["WorkspaceEnvironment.rpcHandlers("],
    why: "status, allow and revoke RPCs",
  },
];

const serverSrc = NodePath.resolve(import.meta.dirname, "..");

describe("workspace environment seams", () => {
  it.each(SEAMS)("$file: $why", (seam) => {
    const source = NodeFS.readFileSync(NodePath.join(serverSrc, seam.file), "utf8");
    for (const expected of seam.expects) {
      expect(source, `${seam.file} lost its direnv seam`).toContain(expected);
    }
  });
});
