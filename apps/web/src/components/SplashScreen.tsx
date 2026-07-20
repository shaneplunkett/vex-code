import { VEX_APP_BASE_NAME, VEX_APP_ICON_PATH } from "../vex/branding";

export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="flex size-24 items-center justify-center"
        aria-label={`${VEX_APP_BASE_NAME} splash screen`}
      >
        <img alt={VEX_APP_BASE_NAME} className="size-16 object-contain" src={VEX_APP_ICON_PATH} />
      </div>
    </div>
  );
}
