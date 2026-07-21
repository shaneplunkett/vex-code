import { EDITORS, EditorId, EnvironmentId } from "@t3tools/contracts";
import {
  mapAtomCommandResult,
  type AtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "./hooks/useLocalStorage";
import { useCallback, useMemo } from "react";
import { shellEnvironment } from "./state/shell";
import { useAtomCommand } from "./state/use-atom-command";
import { isTerminalBackedEditor } from "./editorLaunch";

const LAST_EDITOR_KEY = "t3code:last-editor";

export function resolvePickerPreferredEditor(
  availableEditors: ReadonlyArray<EditorId>,
  lastEditor: EditorId | null,
): EditorId | null {
  if (lastEditor && availableEditors.includes(lastEditor)) return lastEditor;
  if (availableEditors.includes("file-manager")) return "file-manager";
  return availableEditors.length === 1 ? (availableEditors[0] ?? null) : null;
}

export function resolveExternalPreferredEditor(
  availableEditors: ReadonlyArray<EditorId>,
  lastEditor: EditorId | null,
): EditorId | null {
  const externalEditors = new Set(
    availableEditors.filter((editor) => !isTerminalBackedEditor(editor)),
  );
  if (lastEditor && externalEditors.has(lastEditor)) return lastEditor;
  if (externalEditors.has("file-manager")) return "file-manager";
  return EDITORS.find((editor) => externalEditors.has(editor.id))?.id ?? null;
}

export class PreferredEditorEnvironmentRequiredError extends Schema.TaggedErrorClass<PreferredEditorEnvironmentRequiredError>()(
  "PreferredEditorEnvironmentRequiredError",
  {
    targetPath: Schema.String,
  },
) {
  override get message(): string {
    return `Cannot open ${this.targetPath} because no environment is selected.`;
  }
}

export class PreferredEditorUnavailableError extends Schema.TaggedErrorClass<PreferredEditorUnavailableError>()(
  "PreferredEditorUnavailableError",
  {
    environmentId: EnvironmentId,
    targetPath: Schema.String,
    availableEditorIds: Schema.Array(EditorId),
  },
) {
  override get message(): string {
    return `No available editor can open ${this.targetPath} in environment ${this.environmentId}.`;
  }
}

export function usePreferredEditor(availableEditors: ReadonlyArray<EditorId>) {
  const [lastEditor, setLastEditor] = useLocalStorage(LAST_EDITOR_KEY, null, EditorId);

  const effectiveEditor = useMemo(
    () => resolvePickerPreferredEditor(availableEditors, lastEditor),
    [lastEditor, availableEditors],
  );

  return [effectiveEditor, setLastEditor] as const;
}

export function resolveAndPersistPreferredEditor(
  availableEditors: readonly EditorId[],
): EditorId | null {
  const availableEditorIds = new Set(availableEditors);
  const stored = getLocalStorageItem(LAST_EDITOR_KEY, EditorId);
  const editor = resolveExternalPreferredEditor(availableEditors, stored);
  const storedTerminalEditorIsAvailable = Boolean(
    stored && availableEditorIds.has(stored) && isTerminalBackedEditor(stored),
  );
  if (editor && !storedTerminalEditorIsAvailable) {
    setLocalStorageItem(LAST_EDITOR_KEY, editor, EditorId);
  }
  return editor ?? null;
}

export function useOpenInPreferredEditor(
  environmentId: EnvironmentId | null,
  availableEditors: readonly EditorId[],
) {
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, {
    reportFailure: false,
  });
  type OpenInEditorError = AtomCommandFailure<Awaited<ReturnType<typeof openInEditor>>>;

  return useCallback(
    async (
      targetPath: string,
    ): Promise<
      AtomCommandResult<
        EditorId,
        | OpenInEditorError
        | PreferredEditorEnvironmentRequiredError
        | PreferredEditorUnavailableError
      >
    > => {
      if (environmentId === null) {
        return AsyncResult.failure(
          Cause.fail(
            new PreferredEditorEnvironmentRequiredError({
              targetPath,
            }),
          ),
        );
      }
      const editor = resolveAndPersistPreferredEditor(availableEditors);
      if (!editor) {
        return AsyncResult.failure(
          Cause.fail(
            new PreferredEditorUnavailableError({
              environmentId,
              targetPath,
              availableEditorIds: availableEditors,
            }),
          ),
        );
      }
      const result = await openInEditor({
        environmentId,
        input: {
          cwd: targetPath,
          editor,
        },
      });
      return mapAtomCommandResult(result, () => editor);
    },
    [availableEditors, environmentId, openInEditor],
  );
}
