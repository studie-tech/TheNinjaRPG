/**
 * iPadOS desktop-class browsing uses a Macintosh user agent but still exposes multiple
 * touch points. The explicit platform check keeps touch-screen laptops out.
 */
export const isIOSInstallDevice = (
  browser: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">,
): boolean =>
  /iPad|iPhone|iPod/.test(browser.userAgent) ||
  (browser.platform === "MacIntel" && browser.maxTouchPoints > 1);
