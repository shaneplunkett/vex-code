import type { PullRequestCheck } from "@t3tools/contracts";
import type { ProviderChangeRequestWatchFingerprint } from "@t3tools/source-control-core/server/PullRequestProvider";

interface FingerprintPull {
  readonly state: string;
  readonly merged: boolean;
  readonly mergeable?: boolean | null | undefined;
  readonly draft?: boolean | null | undefined;
  readonly title: string;
  readonly head: { readonly sha: string };
  readonly comments?: number | undefined;
  readonly updated_at: string;
}

interface FingerprintReview {
  readonly id: number;
  readonly state: string;
  readonly comments_count: number;
}

/**
 * What a forge pull request watch compares between passes, built from the pull request, its
 * head's checks and its reviews. Each check keeps its own state, so a second check failing
 * moves `status` even while the rollup stays failing. `remarks` also carries `updated_at`, so
 * anything else that touches the pull request reads its activity too; an edit Forgejo does not
 * stamp there waits for the watch's periodic reread.
 */
export const watchFingerprint = (
  pr: FingerprintPull,
  checks: ReadonlyArray<PullRequestCheck>,
  reviews: ReadonlyArray<FingerprintReview>,
): ProviderChangeRequestWatchFingerprint => ({
  status: [
    pr.merged ? "merged" : pr.state,
    String(pr.mergeable ?? ""),
    String(pr.draft ?? ""),
    pr.title,
    pr.head.sha,
    ...checks.map((check) => `${check.name}=${check.status}`).toSorted(),
  ].join("\n"),
  remarks: [
    pr.comments ?? "",
    pr.updated_at,
    ...reviews.map((review) => `${review.id}=${review.state}:${review.comments_count}`).toSorted(),
  ].join("\n"),
});
