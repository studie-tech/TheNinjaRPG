const visibleScenes = new Set<object>();
const listeners = new Set<() => void>();

/** Whether a game scene occupies the viewport. Free of Pixi so page decoration can read it. */
export const isGameSceneVisible = () => visibleScenes.size > 0;

/** Tracks one scene and notifies subscribers when the first appears or the last leaves. */
export const setGameSceneVisible = (scene: object, isVisible: boolean) => {
  const wasVisible = isGameSceneVisible();
  if (isVisible) visibleScenes.add(scene);
  else visibleScenes.delete(scene);
  if (wasVisible === isGameSceneVisible()) return;
  for (const listener of listeners) listener();
};

/** Returns the unsubscribe callback. */
export const subscribeGameSceneVisibility = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
