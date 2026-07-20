import { VEX_APP_BASE_NAME, VEX_APP_ICON_PATH } from "./branding";

export function VexSidebarWordmark() {
  return (
    <span className="inline-flex min-w-0 items-center gap-1" aria-label={VEX_APP_BASE_NAME}>
      <img
        alt=""
        aria-hidden="true"
        className="size-4 shrink-0 rounded-[4px]"
        src={VEX_APP_ICON_PATH}
      />
      <span className="truncate text-sm font-semibold tracking-tight text-foreground">Vex</span>
      <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
        Code
      </span>
    </span>
  );
}
