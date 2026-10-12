import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type { SourceControlProviderContext } from "@t3tools/source-control-core/server/SourceControlProvider";

interface RefinementInput {
  readonly cwd: string;
  readonly context: SourceControlProviderContext;
}

/**
 * Remembers which host an unrecognised remote belongs to.
 *
 * A remote whose URL names no known host, such as an SSH alias, is identified by asking every
 * host's CLI in turn. Callers that hand over the remote themselves bypass the registry's folder
 * cache, so every branch and pull request status poll re-ran every probe. A claimed remote is
 * remembered for a minute. One no host claimed is asked again sooner, so a fresh login shows up
 * quickly.
 */
export const makeRemoteRefinementCache = Effect.fn("makeRemoteRefinementCache")(function* (
  refine: (input: RefinementInput) => Effect.Effect<SourceControlProviderContext | null>,
) {
  const cache = yield* Cache.makeWith(
    (key: string) => {
      const [cwd, context] = JSON.parse(key) as [string, SourceControlProviderContext];
      return refine({ cwd, context });
    },
    {
      capacity: 256,
      timeToLive: (exit) =>
        Exit.isSuccess(exit) && exit.value !== null && exit.value.provider.kind !== "unknown"
          ? Duration.minutes(1)
          : Duration.seconds(5),
    },
  );
  return (input: RefinementInput) =>
    input.context.provider.kind === "unknown"
      ? Cache.get(cache, JSON.stringify([input.cwd, input.context]))
      : Effect.succeed(input.context);
});
