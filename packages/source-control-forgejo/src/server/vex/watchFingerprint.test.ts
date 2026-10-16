import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";

import * as ForgejoCli from "../ForgejoCli.ts";
import * as ForgejoPullRequestProvider from "../ForgejoPullRequestProvider.ts";

interface Host {
  comments: number;
  checks: Record<string, string>;
  reviews: Array<{ id: number; state: string; comments_count: number }>;
}

const forge = (host: Host) =>
  Layer.mock(ForgejoCli.ForgejoCli)({
    api: (input) =>
      Effect.succeed(
        TestSourceControlHost.processOutput(
          input.path === "repos/acme/web/pulls/1"
            ? JSON.stringify({
                number: 1,
                title: "Watched",
                body: "",
                html_url: "https://forge.test/acme/web/pulls/1",
                user: { login: "maria" },
                state: "open",
                merged: false,
                comments: host.comments,
                head: { ref: "feature", sha: "head", repo: null },
                base: { ref: "main", sha: "base", repo: null },
                created_at: "2026-10-16T00:00:00Z",
                updated_at: "2026-10-16T00:00:00Z",
                closed_at: null,
                merged_at: null,
                labels: [],
              })
            : !input.path.includes("page=1")
              ? "[]"
              : input.path.includes("/statuses/")
                ? JSON.stringify(
                    Object.entries(host.checks).map(([context, status], index) => ({
                      id: index + 1,
                      context,
                      status,
                      description: null,
                      target_url: null,
                      updated_at: "2026-10-16T00:00:00Z",
                    })),
                  )
                : JSON.stringify(
                    host.reviews.map((review) => ({
                      ...review,
                      body: "",
                      user: { login: "vex" },
                      submitted_at: "2026-10-16T00:00:00Z",
                    })),
                  ),
        ),
      ),
  });

it.effect("a forge watch fingerprint moves with each check and each remark", () =>
  Effect.gen(function* () {
    const host: Host = {
      comments: 0,
      checks: { lint: "failure", test: "pending" },
      reviews: [],
    };
    const read = Effect.gen(function* () {
      const provider = yield* ForgejoPullRequestProvider.make;
      const fingerprint = provider.getChangeRequestWatchFingerprint;
      if (fingerprint === undefined) return yield* Effect.die("fingerprint missing");
      const result = yield* fingerprint({
        cwd: "/repo",
        repository: "acme/web",
        host: "forge.test",
        number: 1,
      });
      if (result === null) return yield* Effect.die("no fingerprint");
      return result;
    }).pipe(Effect.provide(forge(host)));

    const first = yield* read;
    assert.deepStrictEqual(yield* read, first);

    // A second check fails while the rollup was already failing.
    host.checks = { lint: "failure", test: "failure" };
    const secondFailure = yield* read;
    assert.notStrictEqual(secondFailure.status, first.status);
    assert.strictEqual(secondFailure.remarks, first.remarks);

    host.comments = 1;
    const commented = yield* read;
    assert.notStrictEqual(commented.remarks, secondFailure.remarks);
    assert.strictEqual(commented.status, secondFailure.status);

    host.reviews = [{ id: 7, state: "COMMENT", comments_count: 1 }];
    const reviewed = yield* read;
    assert.notStrictEqual(reviewed.remarks, commented.remarks);

    host.reviews = [{ id: 7, state: "COMMENT", comments_count: 2 }];
    assert.notStrictEqual((yield* read).remarks, reviewed.remarks);
  }),
);
