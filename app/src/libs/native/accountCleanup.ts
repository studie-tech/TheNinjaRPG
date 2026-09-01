import * as liveActivity from "./liveActivity";
import * as purchases from "./purchases";

/** Last profile whose snapshot was successfully written to the shared widget container. */
export const NATIVE_WIDGET_SNAPSHOT_OWNER_KEY = "native-widget-snapshot-owner";

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
  snapshotOwnerUserId?: string | null;
  userData: { userId: string } | undefined;
  userId: string | null | undefined;
}): "clear" | "idle" | "sync" => {
  if (!state.isClerkLoaded) return "idle";
  if (!state.userId) return "idle";
  // An absent profile is normal while the query starts or transiently fails. Clear only
  // when either cached profile data or the persisted snapshot owner proves that the
  // shared container belongs to another identity.
  if (state.userData && state.userData.userId !== state.userId) return "clear";
  if (state.snapshotOwnerUserId && state.snapshotOwnerUserId !== state.userId) {
    return "clear";
  }
  if (state.userId && state.userData?.userId === state.userId) return "sync";
  return "idle";
};

/** Clear every device-local surface which can retain the previous game account. */
export const clearNativeAccountState = async (
  unregister: () => Promise<void>,
  clearWidgets: () => Promise<void>,
): Promise<void> => {
  await Promise.allSettled([
    unregister(),
    clearWidgets(),
    purchases.logOut(),
    liveActivity.endAll(),
  ]);
};
