import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";

import * as ForgejoCli from "../ForgejoCli.ts";
import * as ForgejoPullRequestProvider from "../ForgejoPullRequestProvider.ts";

it.effect("lists each Forgejo reviewer candidate once from a single assignees read", () => {
  const paths: string[] = [];
  return Effect.gen(function* () {
    const provider = yield* ForgejoPullRequestProvider.make;
    const list = provider.listReviewerCandidates;
    if (list === undefined) return yield* Effect.die("reviewer candidates missing");
    const result = yield* list({
      cwd: "/repo",
      repository: "acme/web",
      host: "forgejo.test",
      number: 1,
    });
    assert.deepStrictEqual(
      result.candidates.map((candidate) => [candidate.id, candidate.isRequested]),
      [
        ["vex", true],
        ["maria", false],
      ],
    );
    assert.isFalse(result.truncated);
    assert.deepStrictEqual(paths.toSorted(), [
      "repos/acme/web/assignees",
      "repos/acme/web/pulls/1",
    ]);
  }).pipe(
    Effect.provide(
      Layer.mock(ForgejoCli.ForgejoCli)({
        api: (input) => {
          paths.push(input.path);
          return Effect.succeed(
            TestSourceControlHost.processOutput(
              input.path.endsWith("pulls/1")
                ? `{"number":1,"title":"Reviewers","body":"","html_url":"https://forgejo.test/acme/web/pulls/1","user":{"login":"author"},"state":"open","merged":false,
            "head":{"ref":"feature","sha":"head","repo":null},"base":{"ref":"main","sha":"base","repo":null},
            "created_at":"2026-10-16T00:00:00Z","updated_at":"2026-10-16T00:00:00Z","closed_at":null,"merged_at":null,"labels":[],
            "requested_reviewers":[{"login":"vex"}]}`
                : `[{"login":"vex"},{"login":"author"},{"login":"maria"},{"login":"vex"}]`,
            ),
          );
        },
      }),
    ),
  );
});
