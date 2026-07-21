import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const WorkspaceEnvironmentInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type WorkspaceEnvironmentInput = typeof WorkspaceEnvironmentInput.Type;

export const WorkspaceEnvironmentStatus = Schema.Union([
  Schema.TaggedStruct("inactive", {}),
  Schema.TaggedStruct("ready", {}),
  Schema.TaggedStruct("approvalRequired", {
    envrcPath: TrimmedNonEmptyString,
  }),
]);
export type WorkspaceEnvironmentStatus = typeof WorkspaceEnvironmentStatus.Type;

export class WorkspaceEnvironmentRequestError extends Schema.TaggedErrorClass<WorkspaceEnvironmentRequestError>()(
  "WorkspaceEnvironmentRequestError",
  {
    cwd: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
