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
