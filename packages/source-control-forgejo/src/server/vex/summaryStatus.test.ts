import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";

import * as ForgejoCli from "../ForgejoCli.ts";
import * as ForgejoPullRequestProvider from "../ForgejoPullRequestProvider.ts";
import { reviewDecision } from "./summaryStatus.ts";

const pr = `{"number":1,"title":"Status","body":"","html_url":"https://forge.test/sub/acme/web/pulls/1","user":{"login":"author"},
  "state":"open","merged":false,"changed_files":3,"head":{"ref":"feature","sha":"head","repo":null},"base":{"ref":"main","sha":"base","repo":null},
  "created_at":"2026-10-16T00:00:00Z","updated_at":"2026-10-16T00:00:00Z","closed_at":null,"merged_at":null,"labels":[],
  "requested_reviewers":[{"login":"vex"}]}`;
const statuses = `[{"id":2,"context":"ci / test","status":"failure","description":null,"target_url":"/sub/acme/web/actions/runs/7/jobs/0","updated_at":"2026-10-16T00:00:00Z"},
  {"id":1,"context":"ci / lint","status":"success","description":null,"target_url":"https://ci.example/lint","updated_at":"2026-10-16T00:00:00Z"}]`;
const reviews = `[{"id":9,"body":"","user":{"login":"maria"},"state":"APPROVED","submitted_at":"2026-10-16T00:00:00Z","comments_count":0}]`;

const forge = Layer.mock(ForgejoCli.ForgejoCli)({
  api: (input) =>
    Effect.succeed(
      TestSourceControlHost.processOutput(
        input.path === "repos/acme/web/pulls/1"
          ? pr
          : input.path.includes("page=1")
            ? input.path.includes("/statuses/")
              ? statuses
              : reviews
            : "[]",
      ),
    ),
});
const input = { cwd: "/repo", repository: "acme/web", host: "forge.test", number: 1 };

describe("Forgejo summary status", () => {
  it.effect("summaries carry check state, review decision and changed files", () =>
    Effect.gen(function* () {
      const provider = yield* ForgejoPullRequestProvider.make;
      const read = provider.getChangeRequestSummary;
      if (read === undefined) return yield* Effect.die("summary read missing");
      const summary = yield* read(input);
      assert.strictEqual(summary.checksState, "failing");
      assert.strictEqual(summary.reviewDecision, "approved");
      assert.strictEqual(summary.changedFiles, 3);
    }).pipe(Effect.provide(forge)),
  );

  it.effect("check links resolve against the forge host", () =>
    Effect.gen(function* () {
      const provider = yield* ForgejoPullRequestProvider.make;
      const read = provider.getChangeRequestChecks;
      if (read === undefined) return yield* Effect.die("checks read missing");
      const { checks } = yield* read(input);
      assert.deepStrictEqual(checks.map((check) => check.url).toSorted(), [
        "https://ci.example/lint",
        "https://forge.test/sub/acme/web/actions/runs/7/jobs/0",
      ]);
    }).pipe(Effect.provide(forge)),
  );

  it("takes each reviewer's latest standing verdict", () => {
    const review = (id: number, login: string, state: string, dismissed = false) => ({
      id,
      user: { login },
      state,
      dismissed,
    });
    assert.strictEqual(
      reviewDecision([review(2, "maria", "APPROVED"), review(1, "maria", "REQUEST_CHANGES")], 0),
      "approved",
    );
    assert.strictEqual(
      reviewDecision([review(1, "maria", "APPROVED"), review(2, "vex", "REQUEST_CHANGES")], 0),
      "changes-requested",
    );
    assert.strictEqual(
      reviewDecision([review(1, "maria", "REQUEST_CHANGES", true)], 1),
      "review-required",
    );
    assert.strictEqual(
      reviewDecision([review(1, "maria", "APPROVED"), review(2, "maria", "REQUEST_REVIEW")], 1),
      "review-required",
    );
    assert.isNull(reviewDecision([review(1, "maria", "COMMENT")], 0));
  });
});
