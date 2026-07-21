import {
  EDITORS,
  type EditorId,
  type TerminalOpenInput,
  type TerminalWriteInput,
} from "@t3tools/contracts";

type TerminalCommandResult = {
  readonly _tag: "Success" | "Failure";
};

export function isTerminalBackedEditor(editorId: EditorId): boolean {
  const editor = EDITORS.find((candidate) => candidate.id === editorId);
  return Boolean(editor && "launchMode" in editor && editor.launchMode === "terminal");
}

function terminalEditorCommand(editor: EditorId): string {
  switch (editor) {
    case "neovim":
      return "nvim .\r";
    default:
      throw new Error(`Unsupported terminal-backed editor: ${editor}`);
  }
}

export async function launchTerminalEditor<
  OpenResult extends TerminalCommandResult,
  WriteResult extends TerminalCommandResult,
>(
  input: Omit<TerminalOpenInput, "cols" | "rows"> & { readonly editor: EditorId },
  operations: {
    readonly openTerminal: (input: TerminalOpenInput) => Promise<OpenResult>;
    readonly writeTerminal: (input: TerminalWriteInput) => Promise<WriteResult>;
  },
): Promise<OpenResult | WriteResult> {
  const { editor, ...terminalInput } = input;
  const openResult = await operations.openTerminal(terminalInput);
  if (openResult._tag === "Failure") return openResult;

  return operations.writeTerminal({
    threadId: terminalInput.threadId,
    terminalId: terminalInput.terminalId,
    data: terminalEditorCommand(editor),
  });
}
