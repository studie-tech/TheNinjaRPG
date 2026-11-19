import { CONSENT_COOKIE, CONSENT_REVISION } from "@/libs/consentConfig";
import { hasCookieConsent, hasDeclinedCookieConsent } from "@/libs/cookieConsent";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import { metaConsentSchema, metaTrackingSchema } from "@/validators/metaTracking";

export const META_CONVERSION_EVENT = "tnr:meta-conversion";
export const META_READY_EVENT = "tnr:meta-ready";
const CLICK_STORAGE = "tnr_meta_click";

const storedClick = () => {
  try {
    return JSON.parse(localStorage.getItem(CLICK_STORAGE) ?? "null");
  } catch {
    return undefined;
  }
};

const cookie = (name: string) => {
  const value = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return value ? decodeURIComponent(value) : undefined;
};

/** Read only current explicit decisions; a missing/expired manager never grants tracking. */
export const readMetaConsent = () => {
  if (typeof window === "undefined" || isNativeUserAgent(navigator.userAgent))
    return undefined;
  try {
    const stored = JSON.parse(cookie(CONSENT_COOKIE) ?? "null");
    if (stored?.revision !== CONSENT_REVISION) return undefined;
    const granted = hasCookieConsent("marketing");
    if (!granted && !hasDeclinedCookieConsent("marketing")) return undefined;
    const parsed = metaConsentSchema.safeParse({
      revision: stored.revision,
      consentId: stored.consentId,
      decidedAt: stored.lastConsentTimestamp ?? stored.consentTimestamp,
      granted,
    });
    if (
      !parsed.success ||
      parsed.data.granted !== stored.categories?.includes("marketing")
    )
      return undefined;
    const decidedAt = Date.parse(parsed.data.decidedAt);
    if (decidedAt > Date.now() || decidedAt <= Date.now() - 180 * 86_400_000)
      return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
};

/** Capture a real Facebook click only after consent, with a bounded first-party lifetime. */
export const readMetaTracking = () => {
  const consent = readMetaConsent();
  if (!consent?.granted) return undefined;
  try {
    let fbc = cookie("_fbc");
    const fbp = cookie("_fbp");
    const click = new URL(window.location.href).searchParams.get("fbclid");
    if (click && /^[A-Za-z0-9_-]{1,450}$/.test(click)) {
      const stored = storedClick();
      const reused = stored?.click === click && stored.expiresAt > Date.now();
      // Preserve the original click time through route changes and repeated renders.
      fbc = reused ? stored.fbc : `fb.1.${Date.now()}.${click}`;
      try {
        localStorage.setItem(
          CLICK_STORAGE,
          JSON.stringify({
            click,
            fbc,
            expiresAt: reused ? stored.expiresAt : Date.now() + 90 * 86_400_000,
          }),
        );
      } catch {
        /* Cookie matching and this visit still work without local storage. */
      }
    } else if (!fbc) {
      const stored = storedClick();
      if (stored?.expiresAt > Date.now()) fbc = stored.fbc;
      else clearMetaClick();
    }
    const parsed = metaTrackingSchema.safeParse({ ...consent, fbc, fbp });
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** Remove consented click storage as soon as consent is withdrawn, independently of HTTP. */
export const clearMetaClick = () => {
  try {
    localStorage.removeItem(CLICK_STORAGE);
  } catch {
    /* Storage may be unavailable. */
  }
};
