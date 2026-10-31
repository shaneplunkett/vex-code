/**
 * Puts Forgejo commit statuses oldest first for `dedupeChecks`. Forgejo lists newest first at
 * one-second resolution, so a fast pending-to-success leaves a tie the dedupe would settle on the
 * stale pending row. Ids only grow, so id order fixes it; rows without an id keep their place.
 */
export const oldestStatusFirst = <Status extends { readonly id?: number | undefined }>(
  statuses: ReadonlyArray<Status>,
): ReadonlyArray<Status> => statuses.toSorted((a, b) => (a.id ?? 0) - (b.id ?? 0));
