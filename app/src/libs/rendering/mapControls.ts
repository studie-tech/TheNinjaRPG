import type { GameRenderer } from "@/libs/rendering/runtime";

/**
 * Scene-owned gestures report taps/pointers in renderer pixels (Y downward), with
 * client coordinates retained for DOM overlays. Pan receives renderer-pixel deltas;
 * zoom receives a multiplicative factor. Omitting zoom leaves wheel scrolling available.
 * Drags/pinches suppress taps, including the final finger left after a pinch.
 */
export const createMapControls = (
  game: GameRenderer,
  options: {
    enabled: () => boolean;
    zoom?: (factor: number) => void;
    pan?: (dx: number, dy: number) => void;
    tap: (x: number, y: number) => void;
  },
) => {
  const contacts = new Map<
    number,
    { x: number; y: number; startX: number; startY: number; moved: boolean }
  >();
  let pointer: { x: number; y: number; clientX: number; clientY: number } | null = null;
  let multi = false;
  let revision = 0;
  const point = (event: PointerEvent) => {
    const bounds = game.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) * game.renderer.width) / bounds.width,
      y: ((event.clientY - bounds.top) * game.renderer.height) / bounds.height,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  };
  const distance = () => {
    const [a, b] = [...contacts.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  game.listen("pointerdown", (event) => {
    if (!options.enabled() || event.button !== 0) return;
    if (!contacts.size) multi = false;
    const p = point(event);
    pointer = p;
    revision++;
    contacts.set(event.pointerId, {
      ...p,
      startX: p.x,
      startY: p.y,
      moved: false,
    });
    if (contacts.size > 1) multi = true;
    if (event.isTrusted) game.canvas.setPointerCapture(event.pointerId);
  });
  game.listen("pointermove", (event) => {
    const p = point(event);
    pointer = p;
    revision++;
    const contact = contacts.get(event.pointerId);
    if (!contact) return;
    const panX = contact.moved ? contact.x : contact.startX,
      panY = contact.moved ? contact.y : contact.startY;
    const before = distance();
    contact.x = p.x;
    contact.y = p.y;
    contact.moved ||= Math.hypot(p.x - contact.startX, p.y - contact.startY) > 10;
    const after = distance();
    if (options.enabled() && contacts.size > 1 && before > 1 && after > 1)
      options.zoom?.(after / before);
    else if (options.enabled() && !multi && contact.moved)
      options.pan?.(p.x - panX, p.y - panY);
  });
  game.listen("pointerup", (event) => {
    const contact = contacts.get(event.pointerId),
      p = point(event);
    contacts.delete(event.pointerId);
    if (
      options.enabled() &&
      contact &&
      !contact.moved &&
      !multi &&
      Math.hypot(p.x - contact.startX, p.y - contact.startY) <= 10
    )
      options.tap(p.x, p.y);
  });
  const cancel = (event: PointerEvent) => {
    contacts.delete(event.pointerId);
    multi = true;
  };
  game.listen("pointercancel", cancel);
  game.listen("lostpointercapture", cancel);
  game.listen("pointerleave", () => {
    pointer = null;
    revision++;
  });
  game.listen("wheel", (event) => {
    if (!options.enabled() || !options.zoom) return;
    event.preventDefault();
    const delta =
      event.deltaY *
      (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? game.renderer.height : 1);
    options.zoom(Math.exp(Math.max(-1, Math.min(1, -delta * 0.0012))));
  });
  return {
    pointer: () => pointer,
    revision: () => revision,
    dragging: () =>
      contacts.size > 0 &&
      (multi || [...contacts.values()].some((contact) => contact.moved)),
  };
};
