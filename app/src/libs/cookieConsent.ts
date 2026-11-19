/**
 * Consent snapshot published by the bundled manager for application consumers.
 * Missing consent fails closed in SSR, the native shell and when initialization fails.
 */

export type ConsentCategory = "preferences" | "statistics" | "marketing";

interface ConsentSnapshot {
  consent?: Partial<Record<ConsentCategory, boolean>>;
  hasResponse?: boolean;
  renew?: () => void;
}

declare global {
  interface Window {
    tnrConsent?: ConsentSnapshot;
  }
}

/** Emitted once the stored choice is known and whenever the visitor changes it. */
export const CONSENT_CHANGE_EVENT = "tnr:consent-change";

export const hasCookieConsent = (category: ConsentCategory): boolean => {
  if (typeof window === "undefined") return false;
  return window.tnrConsent?.consent?.[category] === true;
};

/**
 * Whether the visitor has answered the consent dialog without opting into the category.
 * Unlike `!hasCookieConsent`, this is false while the manager is still loading or absent.
 */
export const hasDeclinedCookieConsent = (category: ConsentCategory): boolean => {
  if (typeof window === "undefined") return false;
  const snapshot = window.tnrConsent;
  return snapshot?.hasResponse === true && snapshot.consent?.[category] !== true;
};

/** Whether the consent manager has loaded and the visitor's stored choice, if any, is known. */
export const isCookieConsentKnown = (): boolean =>
  typeof window !== "undefined" && window.tnrConsent?.consent !== undefined;

export const subscribeToCookieConsent = (onChange: () => void): (() => void) => {
  window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
  };
};

/**
 * Reopens the consent dialog. Returns false when the manager is not loaded, so the caller
 * can send the visitor to the /consent page instead.
 */
export const openCookieConsentDialog = (): boolean => {
  if (typeof window === "undefined" || !window.tnrConsent?.renew) return false;
  window.tnrConsent.renew();
  return true;
};
