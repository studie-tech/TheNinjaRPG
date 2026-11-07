export type DeviceType = "mobile" | "desktop" | "unknown";

/**
 * Determine the device type from user agent string.
 * Returns 'mobile', 'desktop', or 'unknown'
 *
 * @param userAgent - The user agent string to parse
 * @returns {String} - One of 'mobile', 'desktop', or 'unknown'
 */
export function getDeviceType(userAgent?: string): DeviceType {
  if (!userAgent) return "unknown";

  // Check for mobile devices first
  // Windows Phone must come first because its UA also contains "Android"
  if (/windows phone/i.test(userAgent)) {
    return "mobile";
  }

  if (/android/i.test(userAgent)) {
    return "mobile";
  }

  // iOS detection
  if (/iPad|iPhone|iPod/.test(userAgent)) {
    return "mobile";
  }

  // Check for known desktop/bot patterns
  // If it contains common desktop OS indicators, it's likely desktop
  if (
    /windows|macintosh|mac os x|linux|x11/i.test(userAgent) &&
    !/mobile|android|iphone|ipad|ipod/i.test(userAgent)
  ) {
    return "desktop";
  }

  // Default to unknown if we can't determine
  return "unknown";
}

/**
 * Detect if the current browser is mobile
 */
export const isMobile = (): boolean => {
  if (typeof window === "undefined") return false;

  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    window.navigator.userAgent,
  );
};

/**
 * iPadOS desktop-class browsing uses a Macintosh user agent but still exposes multiple
 * touch points. The explicit platform check keeps touch-screen laptops out.
 */
export const isIOSInstallDevice = (
  browser: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">,
): boolean =>
  /iPad|iPhone|iPod/.test(browser.userAgent) ||
  (browser.platform === "MacIntel" && browser.maxTouchPoints > 1);
