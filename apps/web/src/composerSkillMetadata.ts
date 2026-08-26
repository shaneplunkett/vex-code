import { formatProviderSkillDisplayName } from "@t3tools/client-runtime/providerSkills";
import type { ServerProviderSkill, SkillInvocation } from "@t3tools/contracts";

export type ComposerSkillMetadata = {
  label: string;
  description: string | null;
};

function resolveSkillDescription(
  skill: Pick<ServerProviderSkill, "shortDescription" | "description">,
): string | null {
  const shortDescription = skill.shortDescription?.trim();
  if (shortDescription) {
    return shortDescription;
  }
  const description = skill.description?.trim();
  return description || null;
}

export function reconcileComposerSkillMetadata(input: {
  skills: ReadonlyArray<ServerProviderSkill>;
  selectedInvocations?: ReadonlyArray<SkillInvocation>;
  previousMetadata?: ReadonlyMap<string, ComposerSkillMetadata>;
}): ReadonlyMap<string, ComposerSkillMetadata> {
  const metadata = new Map(
    input.skills
      .filter((skill) => skill.enabled)
      .map(
        (skill) =>
          [
            skill.name,
            {
              label: formatProviderSkillDisplayName(skill),
              description: resolveSkillDescription(skill),
            },
          ] as const,
      ),
  );

  for (const invocation of input.selectedInvocations ?? []) {
    if (metadata.has(invocation.name)) {
      continue;
    }
    metadata.set(
      invocation.name,
      input.previousMetadata?.get(invocation.name) ?? {
        label: formatProviderSkillDisplayName({ name: invocation.name }),
        description: null,
      },
    );
  }

  return metadata;
}
