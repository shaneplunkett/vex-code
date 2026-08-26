import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";

import {
  rejectUnsupportedSkillInvocations,
  resolveClaudeSkillInvocations,
  resolveCodexSkillInvocations,
} from "./skillInvocations.ts";

const canonical = "ok, now $implement all the tickets";
const invocation = {
  name: "implement",
  start: canonical.indexOf("$implement"),
  end: canonical.indexOf("$implement") + "$implement".length,
};
const threadId = ThreadId.make("thread-1");

describe("provider skill invocation lowering", () => {
  it("keeps Codex's native canonical skill syntax", () => {
    expect(
      resolveCodexSkillInvocations({
        threadId,
        input: canonical,
        skillInvocations: [invocation],
      }),
    ).toEqual({ ok: true, input: canonical });
  });

  it("lowers one inline canonical skill to Claude's leading slash invocation", () => {
    expect(
      resolveClaudeSkillInvocations({
        threadId,
        input: canonical,
        skillInvocations: [invocation],
      }),
    ).toEqual({ ok: true, input: "/implement ok, now all the tickets" });
  });

  it("rejects Claude combinations that its command expansion cannot preserve", () => {
    expect(
      resolveClaudeSkillInvocations({
        threadId,
        input: "$one then $two",
        skillInvocations: [
          { name: "one", start: 0, end: 4 },
          { name: "two", start: 10, end: 14 },
        ],
      }),
    ).toMatchObject({ ok: false, detail: expect.stringContaining("only one skill") });

    expect(
      resolveClaudeSkillInvocations({
        threadId,
        input: canonical,
        attachments: [
          {
            type: "image",
            id: "attachment-1",
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 1,
          },
        ],
        skillInvocations: [invocation],
      }),
    ).toMatchObject({ ok: false, detail: expect.stringContaining("with attachments") });
  });

  it("rejects stale ranges and unsupported providers instead of sending inert text", () => {
    expect(
      resolveCodexSkillInvocations({
        threadId,
        input: canonical,
        skillInvocations: [{ ...invocation, start: 0 }],
      }),
    ).toMatchObject({ ok: false, detail: expect.stringContaining("no longer matches") });

    expect(
      rejectUnsupportedSkillInvocations(
        { threadId, input: canonical, skillInvocations: [invocation] },
        "OpenCode",
      ),
    ).toMatchObject({ ok: false, detail: expect.stringContaining("does not support") });
  });
});
