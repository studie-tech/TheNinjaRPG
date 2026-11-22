"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/** Pointer travel, in CSS pixels, before a drag starts walking. */
export const JOYSTICK_DEADZONE = 10;
/** The drawn joystick's radius, in CSS pixels. */
export const JOYSTICK_RADIUS = 46;

const MOVE_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);

/** The nearest of the simulation's sixteen directions, counterclockwise from east (y up). */
export const directionIndex = (x: number, y: number) =>
  (Math.round(Math.atan2(y, x) / (Math.PI / 8)) + 16) % 16;

/** Where the drawn joystick sits in the field, and how far its knob is pushed. */
export type ChakraStormStickView = { x: number; y: number; dx: number; dy: number };

/**
 * How the hero walks in a Chakra Storm run: held WASD or arrow keys, or a drag that acts as
 * a joystick wherever it starts on the field.
 *
 * `steering` says whether the field's joystick layer is on screen. The layer leaves while a
 * draft is open, and an element that leaves mid-drag takes the pointer's release with it, so
 * a drag in progress then ends here: otherwise the hero would keep walking its last way and
 * the stale drag would block every new one.
 */
export const useChakraStormSteering = (props: {
  /** Whether the run is being played, so keys steer and pause it. */
  playing: boolean;
  /** Whether the joystick layer is on screen. */
  steering: boolean;
  paused: boolean;
  /** A direction index, or -1 to stand still. */
  setMove: (direction: number) => void;
  setPaused: (paused: boolean) => void;
}) => {
  const { playing, steering, paused, setMove, setPaused } = props;
  const keys = useRef(new Set<string>());
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const [stickView, setStickView] = useState<ChakraStormStickView | null>(null);

  const updateKeyMove = useCallback(() => {
    if (stick.current) return;
    const held = keys.current;
    const x =
      (held.has("d") || held.has("arrowright") ? 1 : 0) -
      (held.has("a") || held.has("arrowleft") ? 1 : 0);
    const y =
      (held.has("w") || held.has("arrowup") ? 1 : 0) -
      (held.has("s") || held.has("arrowdown") ? 1 : 0);
    setMove(x === 0 && y === 0 ? -1 : directionIndex(x, y));
  }, [setMove]);

  /** Drop the drag in progress; held keys take over again. */
  const releaseStick = useCallback(() => {
    if (!stick.current) return;
    stick.current = null;
    setStickView(null);
    updateKeyMove();
  }, [updateKeyMove]);

  useEffect(() => {
    if (!steering) releaseStick();
  }, [releaseStick, steering]);

  useEffect(() => {
    if (!playing) return;
    const held = keys.current;
    const onDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if (MOVE_KEYS.has(key)) {
        event.preventDefault();
        held.add(key);
        updateKeyMove();
      } else if ((key === "p" || key === "escape") && !event.repeat) setPaused(!paused);
    };
    const onUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!held.delete(key)) return;
      updateKeyMove();
    };
    // A hidden tab pauses the run, and loses track of keys and touches released meanwhile.
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      held.clear();
      releaseStick();
      updateKeyMove();
      setPaused(true);
    };
    const onBlur = () => {
      held.clear();
      releaseStick();
      updateKeyMove();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [paused, playing, releaseStick, setPaused, updateKeyMove]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const element = event.currentTarget;
    // A second finger does not take over, but a drag whose release never arrived does.
    if (stick.current && element.hasPointerCapture?.(stick.current.id)) return;
    // A drag steers; it must not start selecting the page.
    event.preventDefault();
    element.setPointerCapture?.(event.pointerId);
    const rect = element.getBoundingClientRect();
    stick.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setStickView({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      dx: 0,
      dy: 0,
    });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const origin = stick.current;
    if (!origin || origin.id !== event.pointerId) return;
    const dx = event.clientX - origin.x,
      dy = event.clientY - origin.y;
    const length = Math.hypot(dx, dy);
    setMove(length < JOYSTICK_DEADZONE ? -1 : directionIndex(dx, -dy));
    const reach = Math.min(1, JOYSTICK_RADIUS / Math.max(1, length));
    setStickView((view) => (view ? { ...view, dx: dx * reach, dy: dy * reach } : view));
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    if (stick.current?.id !== event.pointerId) return;
    releaseStick();
  };

  return {
    stickView,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onLostPointerCapture: onPointerEnd,
    },
  };
};
