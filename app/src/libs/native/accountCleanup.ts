import * as liveActivity from "./liveActivity";
import * as purchases from "./purchases";
import * as widgets from "./widgetBridge";

export const shouldClearNativeAccountState = (state: {
  isClerkLoaded: boolean;
  status: string;
  userData: { userId: string } | undefined;
  userId: string | null | undefined;
}): boolean =>
  state.isClerkLoaded &&
  (!state.userId || (state.status === "success" && !state.userData));

/** Decide whether the shared widget container may receive this profile identity. */
export const nativeWidgetAccountAction = (state: {
  isClerkLoaded: boolean;
  userData: { userId: string } | undefined;
  userId: string | null | undefined;
}): "clear" | "idle" | "sync" => {
  if (!state.isClerkLoaded) return "idle";
  if (state.userId && state.userData?.userId !== state.userId) return "clear";
  if (state.userId && state.userData?.userId === state.userId) return "sync";
  return "idle";
};

/** Clear every device-local surface which can retain the previous game account. */
export const clearNativeAccountState = async (
  unregister: () => Promise<void>,
): Promise<void> => {
  await Promise.allSettled([
    unregister(),
    widgets.clear(),
    purchases.logOut(),
    liveActivity.endAll(),
  ]);
};
