import type { GameRenderer } from "@/libs/rendering/runtime";
import type { GlobeCamera } from "@/libs/rendering/scenes/globeProjection";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

/** Persisted distance fraction in [0, 1], with zero selecting the closest limit. */
export const storedGlobeZoom = () => {
  try {
    const value: unknown = JSON.parse(safeLocalStorageGetItem("globalMapZoom") ?? "0");
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : 0;
  } catch {
    return 0;
  }
};

/**
 * Mutates the supplied camera; distance limits use render units and latitude is a
 * radian limit. Taps/pointers use renderer pixels (Y downward); zoom multiplies
 * distance. Listeners and deferred zoom persistence belong to game.
 */
export const createGlobeControls = (
  game: Pick<GameRenderer, "canvas" | "listen" | "own">,
  camera: GlobeCamera,
  limits: { min: number; max: number; latitude: number },
  onTap: (x: number, y: number) => void,
) => {
  const pointers = new Map<
    number,
    { x: number; y: number; startX: number; startY: number; moved: boolean }
  >();
  let pointer: { x: number; y: number } | null = null;
  let multiTouch = false;
  let rotationRevision = 0;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const save = () =>
    safeLocalStorageSetItem(
      "globalMapZoom",
      JSON.stringify((camera.distance - limits.min) / (limits.max - limits.min)),
    );
  const zoom = (factor: number) => {
    camera.distance = Math.max(
      limits.min,
      Math.min(limits.max, camera.distance * factor),
    );
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      save();
    }, 300);
  };
  const screenPoint = (event: PointerEvent) => {
    const rect = game.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * camera.width) / rect.width,
      y: ((event.clientY - rect.top) * camera.height) / rect.height,
    };
  };
  const separation = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  game.listen("pointerdown", (event) => {
    if (!pointers.size) multiTouch = false;
    const { x, y } = screenPoint(event);
    pointers.set(event.pointerId, {
      x,
      y,
      startX: x,
      startY: y,
      moved: event.button !== 0,
    });
    if (pointers.size > 1) multiTouch = true;
    if (event.pointerType !== "mouse") pointer = null;
    if (event.isTrusted) game.canvas.setPointerCapture(event.pointerId);
  });
  game.listen("pointermove", (event) => {
    const point = screenPoint(event);
    if (event.pointerType === "mouse") pointer = point;
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const before = separation();
    const dx = point.x - previous.x,
      dy = point.y - previous.y;
    previous.x = point.x;
    previous.y = point.y;
    previous.moved ||=
      Math.hypot(point.x - previous.startX, point.y - previous.startY) > 10;
    if (pointers.size > 1) {
      const after = separation();
      if (before > 1 && after > 1) zoom(before / after);
    } else {
      if (dx !== 0 || dy !== 0) rotationRevision++;
      camera.longitude += dx * 0.005;
      camera.latitude = Math.max(
        -limits.latitude,
        Math.min(limits.latitude, camera.latitude + dy * 0.005),
      );
    }
  });
  game.listen("pointerup", (event) => {
    const contact = pointers.get(event.pointerId);
    const { x, y } = screenPoint(event);
    pointers.delete(event.pointerId);
    if (
      contact &&
      !contact.moved &&
      !multiTouch &&
      Math.hypot(x - contact.startX, y - contact.startY) <= 10
    )
      onTap(x, y);
  });
  const cancel = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    multiTouch = true;
  };
  game.listen("pointercancel", cancel);
  game.listen("lostpointercapture", cancel);
  game.listen("pointerleave", () => {
    pointer = null;
  });
  game.listen("contextmenu", (event) => event.preventDefault());
  game.listen("wheel", (event) => {
    event.preventDefault();
    const delta =
      event.deltaY *
      (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? camera.height : 1);
    zoom(Math.exp(Math.max(-1, Math.min(1, delta * 0.0012))));
  });
  game.own(() => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    save();
  });
  return {
    zoom,
    isInteracting: () => pointers.size > 0,
    pointer: () => pointer,
    rotationRevision: () => rotationRevision,
  };
};
