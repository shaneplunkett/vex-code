import { cn } from "../lib/utils";
import { VEX_APP_BASE_NAME, VEX_APP_ICON_PATH } from "./branding";

export function VexSidebarWordmark({ onBackdrop = false }: { onBackdrop?: boolean }) {
  return (
    <span
      aria-label={VEX_APP_BASE_NAME}
      className="inline-flex min-w-0 items-center gap-1 text-sm tracking-tight"
    >
      <img
        alt=""
        aria-hidden="true"
        className="size-4 shrink-0 rounded-[4px]"
        src={VEX_APP_ICON_PATH}
      />
      <span className={cn("truncate font-semibold", onBackdrop ? "text-white" : "text-foreground")}>
        Vex
      </span>
      <span
        className={cn(
          "truncate font-medium",
          onBackdrop ? "text-white/70" : "text-muted-foreground",
        )}
      >
        Code
      </span>
    </span>
  );
}
