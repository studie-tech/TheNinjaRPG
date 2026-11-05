/**
 * Save a Blob through a temporary anchor click. The object URL is revoked afterwards so the
 * blob memory can be released. Browser only.
 */
export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

/**
 * Scroll behavior honoring the visitor's motion preference. An explicit "smooth" overrides
 * the stylesheet's reduced-motion rules, so scripted scrolls must ask here. Browser only.
 */
export const getScrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
