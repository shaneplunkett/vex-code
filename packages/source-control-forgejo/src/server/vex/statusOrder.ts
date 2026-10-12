/**
 * Puts Forgejo commit statuses oldest first, ready for `dedupeChecks`.
 *
 * Forgejo keeps every status a job reports, stamps them to the second, and lists the newest
 * first. A job that goes from pending to success within one second leaves two rows with the same
 * time, and the dedupe settles a tie on the row listed last, which is the stale pending one. Ids
 * only grow, so ordering by id hands the dedupe the newest row last. Rows without an id keep
 * their place.
 */
export const oldestStatusFirst = <Status extends { readonly id?: number | undefined }>(
  statuses: ReadonlyArray<Status>,
): ReadonlyArray<Status> => statuses.toSorted((a, b) => (a.id ?? 0) - (b.id ?? 0));
