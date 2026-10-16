import type {
  PullRequestCheck,
  PullRequestChecksState,
  PullRequestReviewDecision,
} from "@t3tools/contracts";

/**
 * Makes Forgejo check links absolute. Forgejo Actions reports root-relative links that already
 * include any sub-path, so resolving them against the pull request's own page gives the full URL.
 */
export const absoluteCheckUrls = (
  checks: ReadonlyArray<PullRequestCheck>,
  pageUrl: string,
): ReadonlyArray<PullRequestCheck> =>
  checks.map((check) =>
    check.url !== null && URL.canParse(check.url, pageUrl)
      ? { ...check, url: new URL(check.url, pageUrl).href }
      : check,
  );

/** The one-word verdict over a pull request's checks, or null when it has none that count. */
export const checksState = (
  checks: ReadonlyArray<PullRequestCheck>,
): PullRequestChecksState | null => {
  const statuses = checks.map((check) => check.status);
  if (statuses.includes("failure") || statuses.includes("cancelled")) return "failing";
  if (statuses.includes("pending") || statuses.includes("action-required")) return "pending";
  return statuses.includes("success") ? "passing" : null;
};

interface ForgejoReviewVerdict {
  readonly id: number;
  readonly user: { readonly login: string } | null;
  readonly state: string;
  readonly dismissed?: boolean | undefined;
}

/**
 * Where the review stands, from each reviewer's latest standing review. Forgejo has no summary
 * of its own, and branch protection is not readable by every collaborator, so an outstanding
 * request stands in for a required review.
 */
export const reviewDecision = (
  reviews: ReadonlyArray<ForgejoReviewVerdict>,
  requestedReviewers: number,
): PullRequestReviewDecision | null => {
  const latest = new Map<string, string>();
  // Ids only grow, so the last one seen per reviewer is their latest.
  for (const review of reviews.toSorted((a, b) => a.id - b.id)) {
    if (!review.user || review.dismissed) continue;
    if (review.state === "APPROVED" || review.state === "REQUEST_CHANGES")
      latest.set(review.user.login, review.state);
    // Asking again sets aside the reviewer's earlier verdict.
    else if (review.state === "REQUEST_REVIEW") latest.delete(review.user.login);
  }
  const verdicts = [...latest.values()];
  if (verdicts.includes("REQUEST_CHANGES")) return "changes-requested";
  if (verdicts.includes("APPROVED")) return "approved";
  return requestedReviewers > 0 ? "review-required" : null;
};
