export const VEX_APP_BASE_NAME = "Vex Code";

export function formatVexAppDisplayName(stageLabel: string): string {
  return `${VEX_APP_BASE_NAME} (${stageLabel})`;
}
