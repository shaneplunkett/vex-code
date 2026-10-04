import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const WorkspaceEnvironmentInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type WorkspaceEnvironmentInput = typeof WorkspaceEnvironmentInput.Type;

/**
 * Whether a directory's direnv `.envrc` reaches the agents, terminals and
 * scripts started there. `inactive` means no `.envrc` applies.
 */
export const WorkspaceEnvironmentStatus = Schema.Union([
  Schema.TaggedStruct("inactive", {}),
  Schema.TaggedStruct("ready", { envrcPath: TrimmedNonEmptyString }),
  Schema.TaggedStruct("blocked", { envrcPath: TrimmedNonEmptyString }),
  Schema.TaggedStruct("failed", { envrcPath: TrimmedNonEmptyString, detail: Schema.String }),
  Schema.TaggedStruct("direnvMissing", { envrcPath: TrimmedNonEmptyString }),
]);
export type WorkspaceEnvironmentStatus = typeof WorkspaceEnvironmentStatus.Type;

export class WorkspaceEnvironmentRequestError extends Schema.TaggedError<WorkspaceEnvironmentRequestError>()(
  "WorkspaceEnvironmentRequestError",
  {
    cwd: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
