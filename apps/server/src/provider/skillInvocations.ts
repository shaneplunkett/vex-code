import type { ProviderSendTurnInput, SkillInvocation } from "@t3tools/contracts";

export type SkillInvocationResolution =
  | { readonly ok: true; readonly input: string | undefined }
  | { readonly ok: false; readonly detail: string };

function validateCanonicalSkillInvocations(input: {
  readonly text: string | undefined;
  readonly skillInvocations: ReadonlyArray<SkillInvocation>;
}): string | null {
  if (input.skillInvocations.length === 0) return null;
  if (input.text === undefined) {
    return "Skill invocation metadata was provided without a text prompt.";
  }

  let previousEnd = 0;
  for (const invocation of input.skillInvocations) {
    const source = `$${invocation.name}`;
    if (invocation.start < previousEnd || invocation.end <= invocation.start) {
      return `Skill invocation '${source}' has an invalid or overlapping source range.`;
    }
    if (input.text.slice(invocation.start, invocation.end) !== source) {
      return `Skill invocation '${source}' no longer matches the canonical prompt at its source range.`;
    }
    previousEnd = invocation.end;
  }
  return null;
}

function resolveValidatedInput(
  input: ProviderSendTurnInput,
):
  | { readonly ok: true; readonly invocations: ReadonlyArray<SkillInvocation> }
  | { readonly ok: false; readonly detail: string } {
  const invocations = input.skillInvocations ?? [];
  const validationError = validateCanonicalSkillInvocations({
    text: input.input,
    skillInvocations: invocations,
  });
  return validationError === null
    ? { ok: true, invocations }
    : { ok: false, detail: validationError };
}

export function resolveCodexSkillInvocations(
  input: ProviderSendTurnInput,
): SkillInvocationResolution {
  const validated = resolveValidatedInput(input);
  if (!validated.ok) return validated;
  return { ok: true, input: input.input };
}

export function resolveClaudeSkillInvocations(
  input: ProviderSendTurnInput,
): SkillInvocationResolution {
  const validated = resolveValidatedInput(input);
  if (!validated.ok) return validated;
  if (validated.invocations.length === 0) return { ok: true, input: input.input };
  if (validated.invocations.length > 1) {
    return {
      ok: false,
      detail:
        "Claude can explicitly invoke only one skill per message. Remove the extra skill chips and send them in separate turns.",
    };
  }
  if ((input.attachments?.length ?? 0) > 0) {
    return {
      ok: false,
      detail:
        "Claude cannot explicitly invoke a skill in a message with attachments. Send the skill first, then attach the images in a follow-up turn.",
    };
  }

  const invocation = validated.invocations[0]!;
  const text = input.input!;
  const before = text.slice(0, invocation.start).trimEnd();
  const after = text.slice(invocation.end).trimStart();
  const argumentsText = before && after ? `${before} ${after}` : before || after;
  return {
    ok: true,
    input: argumentsText ? `/${invocation.name} ${argumentsText}` : `/${invocation.name}`,
  };
}

export function rejectUnsupportedSkillInvocations(
  input: ProviderSendTurnInput,
  providerLabel: string,
): SkillInvocationResolution {
  const validated = resolveValidatedInput(input);
  if (!validated.ok) return validated;
  if (validated.invocations.length === 0) return { ok: true, input: input.input };
  return {
    ok: false,
    detail: `${providerLabel} does not support explicit skill invocation yet. Remove the skill chip before sending.`,
  };
}
