import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as String from "effect/String";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { requiresMobileLint, selectLatestNightlyTag, syncUpstream } from "./sync-upstream.ts";

const git = Effect.fn("git")(function* (cwd: string, args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner
    .string(ChildProcess.make("git", args, { cwd }))
    .pipe(Effect.map(String.trim));
});

const configureGitIdentity = Effect.fn("configureGitIdentity")(function* (cwd: string) {
  yield* git(cwd, ["config", "user.name", "Vex Code Test"]);
  yield* git(cwd, ["config", "user.email", "vex-code-test@example.invalid"]);
});

it("selects the first version-sorted nightly tag", () => {
  assert.equal(
    selectLatestNightlyTag("v0.0.29-nightly.20260720.856\nv0.0.29-nightly.20260720.853\n"),
    "v0.0.29-nightly.20260720.856",
  );
  assert.isUndefined(selectLatestNightlyTag("\n"));
});

it("only requests native lint for mobile native changes", () => {
  assert.isTrue(requiresMobileLint(["apps/mobile/modules/editor/ios/Editor.swift"]));
  assert.isTrue(requiresMobileLint(["apps/mobile/modules/terminal/android/Terminal.kt"]));
  assert.isFalse(requiresMobileLint(["apps/mobile/src/components/Composer.tsx"]));
  assert.isFalse(requiresMobileLint(["apps/web/src/components/Sidebar.tsx"]));
});

it.layer(NodeServices.layer)("sync-upstream", (it) => {
  it.effect("merges the newest upstream nightly locally without pushing the fork", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "sync-upstream-" });
      const upstreamWork = path.join(root, "upstream-work");
      const upstreamBare = path.join(root, "upstream.git");
      const originBare = path.join(root, "origin.git");
      const fork = path.join(root, "fork");

      yield* fs.makeDirectory(upstreamWork);
      yield* git(upstreamWork, ["init", "--initial-branch=main"]);
      yield* configureGitIdentity(upstreamWork);
      yield* fs.writeFileString(path.join(upstreamWork, "shared.txt"), "base\n");
      yield* git(upstreamWork, ["add", "shared.txt"]);
      yield* git(upstreamWork, ["commit", "-m", "base"]);
      yield* git(upstreamWork, ["update-ref", "refs/tags/v0.0.29-nightly.20260719.851", "HEAD"]);

      yield* git(root, ["init", "--bare", upstreamBare]);
      yield* git(root, ["init", "--bare", originBare]);
      yield* git(upstreamWork, ["remote", "add", "upstream", upstreamBare]);
      yield* git(upstreamWork, ["remote", "add", "origin", originBare]);
      yield* git(upstreamWork, ["push", "upstream", "main", "--tags"]);
      yield* git(upstreamWork, ["push", "origin", "main"]);
      yield* git(root, ["clone", originBare, fork]);
      yield* configureGitIdentity(fork);
      yield* git(fork, ["remote", "add", "upstream", upstreamBare]);

      yield* fs.writeFileString(path.join(upstreamWork, "upstream.txt"), "nightly\n");
      yield* git(upstreamWork, ["add", "upstream.txt"]);
      yield* git(upstreamWork, ["commit", "-m", "new nightly"]);
      yield* git(upstreamWork, ["update-ref", "refs/tags/v0.0.29-nightly.20260720.856", "HEAD"]);
      yield* git(upstreamWork, ["push", "upstream", "main", "--tags"]);

      yield* fs.writeFileString(path.join(fork, "vex.txt"), "personal fork\n");
      yield* git(fork, ["add", "vex.txt"]);
      yield* git(fork, ["commit", "-m", "vex change"]);

      const result = yield* syncUpstream({ rootDir: fork, skipChecks: true });

      assert.deepStrictEqual(result, {
        status: "merged",
        targetTag: "v0.0.29-nightly.20260720.856",
        incomingCommitCount: 1,
        ranMobileLint: false,
      });
      assert.equal(
        yield* git(fork, ["show", "-s", "--format=%s", "HEAD"]),
        "chore: sync upstream v0.0.29-nightly.20260720.856",
      );
      assert.equal((yield* git(fork, ["show", "-s", "--format=%P", "HEAD"])).split(" ").length, 2);
      assert.equal(yield* git(fork, ["rev-list", "--count", "origin/main..HEAD"]), "3");
      assert.equal(yield* git(root, ["--git-dir", originBare, "rev-list", "--count", "main"]), "1");
      assert.equal(yield* git(fork, ["remote", "get-url", "--push", "upstream"]), "DISABLED");
    }),
  );
});
