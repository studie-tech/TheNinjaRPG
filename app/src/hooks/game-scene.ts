import { type RefObject, useEffect, useRef, useState } from "react";
import {
  type RendererSurface,
  reportRendererFailure,
} from "@/libs/rendering/telemetry";

/**
 * Cancels initialization and disposes late results on reset/unmount. isReady means
 * the factory resolved; each factory defines its asset readiness. Changing create
 * alone does not recreate the scene: use resetKey for construction inputs and refs for live data.
 * Failures reach Sentry under surface; players see the caller's error state.
 */
export const useGameScene = <T extends { dispose: () => void }>(
  surface: RendererSurface,
  mount: RefObject<HTMLElement | null>,
  create: (
    mount: HTMLElement,
    signal: AbortSignal,
    onError: (error: unknown) => void,
  ) => Promise<T>,
  resetKey: unknown = null,
  enabled = true,
) => {
  const factory = useRef(create);
  factory.current = create;
  const scene = useRef<T | null>(null);
  const [error, setError] = useState(false);
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    setError(false);
    setIsReady(false);
    if (!mount.current || !enabled) return;
    const controller = new AbortController();
    const fail = (cause: unknown, phase: "init" | "frame") => {
      if (controller.signal.aborted) return;
      console.error("Game renderer failed", cause);
      reportRendererFailure(cause, { surface, phase });
      setError(true);
      setIsReady(false);
      controller.abort();
      scene.current?.dispose();
      scene.current = null;
    };
    const onError = (cause: unknown) => fail(cause, "frame");
    void factory.current(mount.current, controller.signal, onError).then(
      (instance) => {
        if (controller.signal.aborted) instance.dispose();
        else {
          scene.current = instance;
          setIsReady(true);
        }
      },
      (cause: unknown) => fail(cause, "init"),
    );
    return () => {
      controller.abort();
      scene.current?.dispose();
      scene.current = null;
    };
  }, [surface, mount, resetKey, enabled]);
  return { scene, error, isReady };
};
