/**
 * tsParticles inserts a <canvas> that defaults to 300×150 in normal flow. That
 * single insertion was the largest desktop CLS source on the site
 * (#tsparticles>canvas and #confetti). Hosts must be taken out of flow with
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

export const applyParticleOverlayStyle = (
  element: HTMLElement,
  zIndex: number,
): void => {
  const nextStyle = particleOverlayStyle(zIndex);
  element.style.position = nextStyle.position;
  element.style.inset = "0";
  element.style.width = nextStyle.width;
  element.style.height = nextStyle.height;
  element.style.margin = "0";
  element.style.padding = "0";
  element.style.pointerEvents = nextStyle.pointerEvents;
  element.style.overflow = nextStyle.overflow;
  element.style.contain = nextStyle.contain;
  element.style.display = nextStyle.display;
  element.style.zIndex = String(nextStyle.zIndex);
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
