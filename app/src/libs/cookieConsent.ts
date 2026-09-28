/**
 * Read-only bridge to the Cookiebot consent manager, which Google Tag Manager loads on
 * the production web build. Cookiebot is absent in development, in the native shell and
 * wherever a blocker stops it, and every reader then treats optional categories as
 * declined: tracking stays off and embeds fall back to their click-to-load placeholder.
 */

export type ConsentCategory = "preferences" | "statistics" | "marketing";

interface CookiebotApi {
  consent?: Partial<Record<ConsentCategory, boolean>>;
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
