import { describe, expect, it, vi } from "vite-plus/test";

import { launchTerminalEditor } from "./editorLaunch";

describe("launchTerminalEditor", () => {
  it("opens a PTY at the workspace and starts Neovim after the shell is ready", async () => {
    const openTerminal = vi.fn(async () => ({ _tag: "Success" as const }));
    const writeTerminal = vi.fn(async () => ({ _tag: "Success" as const }));

    const result = await launchTerminalEditor(
      {
        editor: "neovim",
        threadId: "thread-1",
        terminalId: "term-2",
        cwd: "/workspace with spaces",
        worktreePath: "/workspace with spaces",
        env: { T3CODE_WORKTREE_PATH: "/workspace with spaces" },
      },
      { openTerminal, writeTerminal },
    );

    expect(result).toEqual({ _tag: "Success" });
    expect(openTerminal).toHaveBeenCalledWith({
      threadId: "thread-1",
      terminalId: "term-2",
      cwd: "/workspace with spaces",
      worktreePath: "/workspace with spaces",
      env: { T3CODE_WORKTREE_PATH: "/workspace with spaces" },
    });
    expect(writeTerminal).toHaveBeenCalledWith({
      threadId: "thread-1",
      terminalId: "term-2",
      data: "nvim .\r",
    });
    expect(openTerminal.mock.invocationCallOrder[0]).toBeLessThan(
      writeTerminal.mock.invocationCallOrder[0]!,
    );
  });

  it("does not write into a terminal that failed to open", async () => {
    const failure = { _tag: "Failure" as const };
    const openTerminal = vi.fn(async () => failure);
    const writeTerminal = vi.fn(async () => ({ _tag: "Success" as const }));

    const result = await launchTerminalEditor(
      {
        editor: "neovim",
        threadId: "thread-1",
        terminalId: "term-2",
        cwd: "/workspace",
      },
      { openTerminal, writeTerminal },
    );

    expect(result).toBe(failure);
    expect(writeTerminal).not.toHaveBeenCalled();
  });
});
