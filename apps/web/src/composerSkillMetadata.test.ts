import type { ServerProviderSkill } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { reconcileComposerSkillMetadata } from "./composerSkillMetadata";

function skill(name: string, overrides: Partial<ServerProviderSkill> = {}): ServerProviderSkill {
  return {
    name,
    path: `/skills/${name}/SKILL.md`,
    enabled: true,
    ...overrides,
  };
}

describe("reconcileComposerSkillMetadata", () => {
  it("keeps presentation metadata for a selected skill after discovery removes it", () => {
    const previousMetadata = reconcileComposerSkillMetadata({
      skills: [skill("handoff", { displayName: "Session handoff", description: "Hand work over" })],
    });

    expect(
      reconcileComposerSkillMetadata({
        skills: [],
        selectedInvocations: [{ name: "handoff", start: 6, end: 14 }],
        previousMetadata,
      }).get("handoff"),
    ).toEqual({
      label: "Session handoff",
      description: "Hand work over",
    });
  });

  it("does not retain metadata for an unavailable skill that is not selected", () => {
    const previousMetadata = reconcileComposerSkillMetadata({
      skills: [skill("handoff")],
    });

    expect(
      reconcileComposerSkillMetadata({
        skills: [],
        selectedInvocations: [],
        previousMetadata,
      }).has("handoff"),
    ).toBe(false);
  });
});
