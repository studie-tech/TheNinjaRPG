import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A stage that fills the screen. Where the browser allows it, the stage element enters
 * fullscreen, which hides the browser and every piece of the site's own chrome; portaled
 * UI follows it through `PortalContainerContext`, which the caller provides from `element`
 * while `isFullscreen`. Where it does not (iPhones), the stage is laid out over the
 * viewport above the site's chrome instead. Leaving browser fullscreen (Escape, the system
 * back gesture) leaves the stage too.
 */
export const useFullscreenStage = <T extends HTMLElement = HTMLDivElement>() => {
  /** The stage element, attached through `setStageElement`. */
  const [element, setStageElement] = useState<T | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** Whether this stage put its element into browser fullscreen. */
  const ownsFullscreen = useRef(false);
  /**
   * Whether the stage still wants the screen. A fullscreen request settles later; one that
   * lands after the player left, or after the stage unmounted, is handed straight back.
   */
  const wantsFullscreen = useRef(false);

  const exit = useCallback(() => {
    wantsFullscreen.current = false;
    setIsFullscreen(false);
    if (ownsFullscreen.current && document.fullscreenElement)
      void document.exitFullscreen().catch(() => undefined);
    ownsFullscreen.current = false;
  }, []);

  const enter = useCallback(() => {
    wantsFullscreen.current = true;
    setIsFullscreen(true);
    if (element?.requestFullscreen && !document.fullscreenElement)
      element
        .requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          if (wantsFullscreen.current) ownsFullscreen.current = true;
          else if (document.fullscreenElement === element)
            void document.exitFullscreen().catch(() => undefined);
        })
        .catch(() => undefined);
  }, [element]);

  const toggle = useCallback(
    () => (isFullscreen ? exit() : enter()),
    [enter, exit, isFullscreen],
  );

  useEffect(() => {
    if (!isFullscreen) return;
    const onFullscreenChange = () => {
      if (ownsFullscreen.current && !document.fullscreenElement) {
        ownsFullscreen.current = false;
        wantsFullscreen.current = false;
        setIsFullscreen(false);
      }
    };
    // Without browser fullscreen, Escape is still the way out.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.fullscreenElement) return;
      wantsFullscreen.current = false;
      setIsFullscreen(false);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const restoreAncestors = lowerConfiningAncestors(element);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      restoreAncestors();
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("keydown", onKey);
    };
  }, [element, isFullscreen]);

  // A stage that unmounts while full also hands the screen back.
  useEffect(
    () => () => {
      wantsFullscreen.current = false;
      if (ownsFullscreen.current && document.fullscreenElement)
        void document.exitFullscreen().catch(() => undefined);
    },
    [],
  );

  return { setStageElement, element, isFullscreen, toggle, exit };
};

/**
 * Laid over the viewport, a stage stays beneath the site's header while a positioned
 * ancestor with a z-index confines it; those ancestors stand down until the returned
 * function restores them.
 */
const lowerConfiningAncestors = (stage: HTMLElement | null) => {
  const lowered: { element: HTMLElement; zIndex: string }[] = [];
  for (let node = stage?.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.position === "static" || style.zIndex === "auto") continue;
    lowered.push({ element: node, zIndex: node.style.zIndex });
    node.style.zIndex = "auto";
  }
  return () => {
    for (const { element, zIndex } of lowered) element.style.zIndex = zIndex;
  };
};
