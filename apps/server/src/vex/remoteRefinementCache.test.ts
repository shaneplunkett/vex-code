import { SourceControlProviderKind } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { TestClock } from "effect/testing";
import type { SourceControlProviderContext } from "@t3tools/source-control-core/server/SourceControlProvider";

import { makeRemoteRefinementCache } from "./remoteRefinementCache.ts";

const forgeRemote: SourceControlProviderContext = {
  provider: {
    kind: SourceControlProviderKind.make("unknown"),
    name: "forge",
    baseUrl: "https://forge",
  },
  remoteName: "origin",
  remoteUrl: "forgejo@forge:shane/homelab.git",
};

const countingRefine = (claimedBy: "forgejo" | null) => {
  let probes = 0;
  const refine = (input: { readonly context: SourceControlProviderContext }) =>
    Effect.sync(() => {
      probes++;
      return claimedBy === null
        ? input.context
        : {
            ...input.context,
            provider: {
              kind: SourceControlProviderKind.make(claimedBy),
              name: "Forgejo / Gitea",
              baseUrl: "https://git.example.test",
            },
          };
    });
  return { refine, probes: () => probes };
};

it.effect("probes a claimed remote once a minute rather than on every poll", () =>
  Effect.gen(function* () {
    const { refine, probes } = countingRefine("forgejo");
    const refineRemote = yield* makeRemoteRefinementCache(refine);
    const input = { cwd: "/repo", context: forgeRemote };

    const first = yield* refineRemote(input);
    yield* refineRemote(input);
    yield* TestClock.adjust(Duration.seconds(59));
    yield* refineRemote(input);
    assert.strictEqual(first?.provider.kind, "forgejo");
    assert.strictEqual(probes(), 1);

    yield* TestClock.adjust(Duration.seconds(2));
    yield* refineRemote(input);
    assert.strictEqual(probes(), 2);
  }),
);

it.effect("asks again within seconds when no host claimed the remote", () =>
  Effect.gen(function* () {
    const { refine, probes } = countingRefine(null);
    const refineRemote = yield* makeRemoteRefinementCache(refine);
    const input = { cwd: "/repo", context: forgeRemote };

    yield* refineRemote(input);
    yield* refineRemote(input);
    assert.strictEqual(probes(), 1);

    yield* TestClock.adjust(Duration.seconds(6));
    yield* refineRemote(input);
    assert.strictEqual(probes(), 2);
  }),
);
