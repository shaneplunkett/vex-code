import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";

import * as ForgejoCli from "../ForgejoCli.ts";
import * as ForgejoPullRequestProvider from "../ForgejoPullRequestProvider.ts";

const pull = (number: number, title: string) =>
  `{"number":${number},"title":${JSON.stringify(title)},"body":"","html_url":"https://forge.test/acme/web/pulls/${number}","user":{"login":"maria"},
  "state":"open","merged":false,"head":{"ref":"feature","sha":"head","repo":null},"base":{"ref":"main","sha":"base","repo":null},
  "created_at":"2026-10-16T00:00:00Z","updated_at":"2026-10-16T00:00:00Z","closed_at":null,"merged_at":null,"labels":[]}`;

const forge = (title: string, calls: Array<ForgejoCli.ForgejoApiInput>) =>
  Layer.mock(ForgejoCli.ForgejoCli)({
    api: (input) => {
      calls.push(input);
      return Effect.succeed(
        TestSourceControlHost.processOutput(
          input.path.startsWith("repos/acme/web/issues?")
            ? input.path.includes("page=1")
              ? `[{"number":5,"title":"SHA-207 follow-up"}]`
              : "[]"
            : input.path === "repos/acme/web/pulls/5"
              ? pull(5, title)
              : "{}",
        ),
      );
    },
  });
const repo = { cwd: "/repo", repository: "acme/web", host: "forge.test" };

describe("Forgejo search and draft", () => {
  it.effect("searches pull requests through the issues search", () => {
    const calls: Array<ForgejoCli.ForgejoApiInput> = [];
    return Effect.gen(function* () {
      const provider = yield* ForgejoPullRequestProvider.make;
      assert.isTrue(provider.capabilities.search);
      const page = yield* provider.listChangeRequests({
        ...repo,
        state: "open",
        involvement: "all",
        viewer: "maria",
        limit: 10,
        query: " SHA-207 ",
      });
      assert.deepStrictEqual(
        page.items.map((item) => item.number),
        [5],
      );
      assert.strictEqual(
        calls[0]?.path,
        "repos/acme/web/issues?type=pulls&state=open&q=SHA-207&limit=50&page=1",
      );
    }).pipe(Effect.provide(forge("SHA-207 follow-up", calls)));
  });

  it.effect.each([
    ["draft", "Add search", "WIP: Add search"],
    ["draft", "[WIP] Add search", "[WIP] Add search"],
    ["ready", "WIP: Add search", "Add search"],
    ["ready", "[WIP] wip: Add search", "Add search"],
  ] as const)("%s turns %j into %j", ([action, title, expected]) => {
    const calls: Array<ForgejoCli.ForgejoApiInput> = [];
    return Effect.gen(function* () {
      const provider = yield* ForgejoPullRequestProvider.make;
      yield* provider.runAction({ ...repo, number: 5, action });
      const patch = calls.find((call) => call.method === "PATCH");
      assert.strictEqual(patch?.path, "repos/acme/web/pulls/5");
      assert.deepStrictEqual(patch?.body, { title: expected });
    }).pipe(Effect.provide(forge(title, calls)));
  });
});
