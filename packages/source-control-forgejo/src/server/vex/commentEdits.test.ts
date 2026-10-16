import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";

import * as ForgejoCli from "../ForgejoCli.ts";
import * as ForgejoPullRequestProvider from "../ForgejoPullRequestProvider.ts";

const responses: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /issues\/1\/comments$/,
    `[{"id":10,"body":"edited","user":{"login":"maria"},"created_at":"2026-10-16T00:00:00Z","updated_at":"2026-10-16T01:00:00Z"},
      {"id":11,"body":"untouched","user":{"login":"maria"},"created_at":"2026-10-16T00:00:00Z","updated_at":"2026-10-16T00:00:00Z"}]`,
  ],
  [
    /pulls\/1\/reviews\?/,
    `[{"id":5,"body":"","user":{"login":"maria"},"state":"COMMENT","submitted_at":"2026-10-16T00:00:00Z","comments_count":1}]`,
  ],
  [
    /reviews\/5\/comments$/,
    `[{"id":20,"body":"inline","user":{"login":"maria"},"created_at":"2026-10-16T00:00:00Z","updated_at":"2026-10-16T02:00:00Z",
      "path":"a.ts","position":3,"original_position":3,"commit_id":"head","original_commit_id":"head","resolver":null}]`,
  ],
  [/^user$/, `{"login":"vex"}`],
];

it.effect("carries Forgejo comment edits into editedAt", () =>
  Effect.gen(function* () {
    const provider = yield* ForgejoPullRequestProvider.make;
    const read = provider.getChangeRequestActivity;
    if (read === undefined) return yield* Effect.die("activity read missing");
    const activity = yield* read({
      cwd: "/repo",
      repository: "acme/web",
      host: "forgejo.test",
      number: 1,
    });
    const editedAt = Object.fromEntries(
      activity.comments.map((comment) => [comment.id, comment.editedAt]),
    );
    assert.strictEqual(editedAt["10"], "2026-10-16T01:00:00.000Z");
    assert.isNull(editedAt["11"]);
    assert.strictEqual(editedAt["20"], "2026-10-16T02:00:00.000Z");
    assert.strictEqual(
      activity.reviewThreads[0]?.comments[0]?.editedAt,
      "2026-10-16T02:00:00.000Z",
    );
  }).pipe(
    Effect.provide(
      Layer.mock(ForgejoCli.ForgejoCli)({
        api: (input) =>
          Effect.succeed(
            TestSourceControlHost.processOutput(
              responses.find(([pattern]) => pattern.test(input.path))?.[1] ?? "[]",
            ),
          ),
      }),
    ),
  ),
);
