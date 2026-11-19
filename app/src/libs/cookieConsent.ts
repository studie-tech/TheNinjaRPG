/**
 * Consent snapshot published by the bundled manager. The Cookiebot-shaped API and event
 * names also support the existing GTM TikTok tag; they do not load a hosted CMP.
 * Missing consent fails closed in SSR, the native shell and when initialization fails.
 */

export type ConsentCategory = "preferences" | "statistics" | "marketing";

interface CookiebotApi {
  consent?: Partial<Record<ConsentCategory, boolean>>;
  hasResponse?: boolean;
  renew?: () => void;
}

declare global {
  interface Window {
    Cookiebot?: CookiebotApi;
  }
}

// Cookiebot dispatches these on window once the stored consent is known and whenever the
// visitor changes it.
const CONSENT_EVENTS = [
  "CookiebotOnConsentReady",
  "CookiebotOnAccept",
  "CookiebotOnDecline",
] as const;

export const hasCookieConsent = (category: ConsentCategory): boolean => {
  if (typeof window === "undefined") return false;
  return window.Cookiebot?.consent?.[category] === true;
};

/**
 * Whether the visitor has answered the consent dialog without opting into the category.
 * Unlike `!hasCookieConsent`, this is false while Cookiebot is still loading or absent.
 */
export const hasDeclinedCookieConsent = (category: ConsentCategory): boolean => {
  if (typeof window === "undefined") return false;
  const cookiebot = window.Cookiebot;
  return cookiebot?.hasResponse === true && cookiebot.consent?.[category] !== true;
};

/** Whether Cookiebot has loaded and the visitor's stored choice, if any, is known. */
export const isCookieConsentKnown = (): boolean =>
  typeof window !== "undefined" && window.Cookiebot?.consent !== undefined;

export const subscribeToCookieConsent = (onChange: () => void): (() => void) => {
  for (const event of CONSENT_EVENTS) window.addEventListener(event, onChange);
  return () => {
    for (const event of CONSENT_EVENTS) window.removeEventListener(event, onChange);
  };
};

/**
 * Reopens the consent dialog. Returns false when Cookiebot is not loaded, so the caller
 * can send the visitor to the /consent page instead.
 */
export const openCookieConsentDialog = (): boolean => {
  if (typeof window === "undefined" || !window.Cookiebot?.renew) return false;
  window.Cookiebot.renew();
  return true;
};
