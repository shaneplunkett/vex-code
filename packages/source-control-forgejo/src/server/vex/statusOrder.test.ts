import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ForgejoStatus, forgejoChecks } from "../forgejoPullRequestJson.ts";

// Decoded through the real schema, so a sync that drops either the `id` field or the sort fails here.
const decodeStatuses = Schema.decodeUnknownSync(Schema.Array(ForgejoStatus));
const row = (id: number, status: string, updatedAt: string) => ({
  id,
  context: "/ hosts (pull_request)",
  status,
  description: null,
  target_url: null,
  updated_at: updatedAt,
});

it("settles a same-second status change on the newer row", () => {
  // Newest first, as Forgejo lists them with `sort=recentupdate`.
  const statuses = decodeStatuses([
    row(7, "success", "2026-10-12T01:46:23Z"),
    row(5, "pending", "2026-10-12T01:46:23Z"),
    row(3, "pending", "2026-10-12T01:46:22Z"),
  ]);
  assert.deepStrictEqual(
    forgejoChecks(statuses).map((check) => check.status),
    ["success"],
  );
});
