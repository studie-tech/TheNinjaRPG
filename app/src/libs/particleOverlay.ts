/**
 * tsParticles inserts a <canvas> that defaults to 300×150 in normal flow, so
 * inserting it into the #tsparticles or #confetti host shifts the layout (CLS).
 * Hosts must be taken out of flow with
 * inline styles *before* they are appended, so the first painted frame cannot
 * shift the document.
 */

export const PARTICLES_OVERLAY_ID = "tsparticles";
export const CONFETTI_OVERLAY_ID = "confetti";
export const PARTICLES_OVERLAY_Z_INDEX = 0;
export const CONFETTI_OVERLAY_Z_INDEX = 50;

export const particleOverlayStyle = (zIndex: number) =>
  ({
    position: "fixed",
    inset: "0px",
    width: "100%",
    height: "100%",
    margin: "0px",
    padding: "0px",
    pointerEvents: "none",
    overflow: "hidden",
    contain: "strict",
    display: "block",
    zIndex,
  }) as const;

/** Apply shared decorative-overlay positioning and hide the overlay from assistive technology. */
export const applyParticleOverlayStyle = (
  element: HTMLElement,
  zIndex: number,
): void => {
  Object.assign(element.style, {
    ...particleOverlayStyle(zIndex),
    zIndex: String(zIndex),
  });
  element.setAttribute("aria-hidden", "true");
};

/**
 * Returns a canvas the confetti helper can paint into. Styles are applied
 * before the node is inserted so the default 300×150 canvas box never lands
 * in document flow.
 */
export const ensureParticleOverlayCanvas = (
  id: string,
  zIndex: number,
): HTMLCanvasElement | null => {
  if (typeof document === "undefined") {
    return null;
  }

  const existing = document.getElementById(id);
  if (existing instanceof HTMLCanvasElement) {
    applyParticleOverlayStyle(existing, zIndex);
    return existing;
  }

  if (existing) {
    applyParticleOverlayStyle(existing, zIndex);
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.id = id;
  applyParticleOverlayStyle(canvas, zIndex);
  document.body.appendChild(canvas);
  return canvas;
};
