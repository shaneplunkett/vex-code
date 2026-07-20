import type { ITheme } from "@xterm/xterm";

export function vexTerminalTheme(input: {
  readonly isDark: boolean;
  readonly background: string;
  readonly foreground: string;
}): ITheme {
  if (input.isDark) {
    return {
      background: input.background,
      foreground: input.foreground,
      cursor: "#b4befe",
      selectionBackground: "#585b7066",
      scrollbarSliderBackground: "#6c70864d",
      scrollbarSliderHoverBackground: "#7f849c66",
      scrollbarSliderActiveBackground: "#9399b280",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#94e2d5",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#f5c2e7",
      brightCyan: "#94e2d5",
      brightWhite: "#a6adc8",
    };
  }

  return {
    background: input.background,
    foreground: input.foreground,
    cursor: "#7287fd",
    selectionBackground: "#9ca0b066",
    scrollbarSliderBackground: "#9ca0b04d",
    scrollbarSliderHoverBackground: "#8c8fa166",
    scrollbarSliderActiveBackground: "#7c7f9380",
    black: "#5c5f77",
    red: "#d20f39",
    green: "#40a02b",
    yellow: "#df8e1d",
    blue: "#1e66f5",
    magenta: "#ea76cb",
    cyan: "#179299",
    white: "#acb0be",
    brightBlack: "#6c6f85",
    brightRed: "#d20f39",
    brightGreen: "#40a02b",
    brightYellow: "#df8e1d",
    brightBlue: "#1e66f5",
    brightMagenta: "#ea76cb",
    brightCyan: "#179299",
    brightWhite: "#bcc0cc",
  };
}
