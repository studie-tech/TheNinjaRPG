"use client";

import { useEffect, useState } from "react";
import type * as CookieConsentLibrary from "vanilla-cookieconsent";
import { Button } from "@/components/ui/button";
import { useNativeShell } from "@/hooks/useNativeShell";
import { CONSENT_REVISION, consentConfig } from "@/libs/consentConfig";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import {
  safeLocalStorageGetItem,
  safeLocalStorageRemoveItem,
  safeLocalStorageSetItem,
} from "@/utils/storage";

/** The manager is bundled with the game; optional integrations fail closed. */
export const CookieConsentManager = () => {
  const isNativeShell = useNativeShell();
  const [hasFailed, setHasFailed] = useState(false);
  useEffect(() => {
    if (isNativeShell !== false || isNativeUserAgent(navigator.userAgent)) return;
    initializeConsent().catch(() => setHasFailed(true));
  }, [isNativeShell]);
  if (!hasFailed) return null;
  return (
    <aside
      role="alert"
      className="border-border bg-card text-card-foreground fixed inset-x-3 bottom-3 z-[10000] mx-auto max-w-xl rounded-lg border p-4 shadow-xl"
    >
      <p>Cookie settings could not load. Optional tracking remains off.</p>
      <Button
        variant="outline"
        className="mt-2"
        onClick={() => window.location.reload()}
      >
        Reload cookie settings
      </Button>
    </aside>
  );
};

let CookieConsent: typeof CookieConsentLibrary;
let initialization: Promise<void> | undefined;
const changeStorageKey = "tnr-consent-change";
const receiptEndpoint = "/api/consent-receipts";

/** Load and initialize once per confirmed web document, including shell remounts. */
const initializeConsent = () => {
  initialization ??= import("vanilla-cookieconsent").then(async (library) => {
    CookieConsent = library;
    await CookieConsent.run({
      ...consentConfig,
      onConsent: synchronizeConsent,
      onFirstConsent: recordConsent,
      onChange: ({ changedCategories }) => {
        synchronizeConsent();
        recordConsent();
        // Reload terminates third-party scripts that cannot be unloaded after withdrawal.
        if (
          changedCategories.some(
            (category) =>
              (category === "statistics" || category === "marketing") &&
              !CookieConsent.acceptedCategory(category),
          )
        ) {
          window.setTimeout(() => window.location.reload(), 300);
        }
      },
    });
    // Saved choices already synchronize through onConsent.
    if (!CookieConsent.validConsent()) synchronizeConsent();
    deliverPendingReceipt();
    window.addEventListener("online", deliverPendingReceipt);
    window.addEventListener("storage", (event) => {
      if (event.key === changeStorageKey) window.location.reload();
    });
  });
  return initialization;
};

/** Publish current category choices to Google consent mode and the shared consent bridge. */
const synchronizeConsent = () => {
  const consent = {
    preferences: CookieConsent.acceptedCategory("preferences"),
    statistics: CookieConsent.acceptedCategory("statistics"),
    marketing: CookieConsent.acceptedCategory("marketing"),
  };
  // GTM's existing TikTok tag reads this API and events. No Cookiebot code is loaded.
  window.Cookiebot = {
    consent,
    hasResponse: CookieConsent.validConsent(),
    renew: CookieConsent.showPreferences,
  };
  const gtag = window.gtag;
  gtag?.("consent", "update", {
    analytics_storage: consent.statistics ? "granted" : "denied",
    ad_storage: consent.marketing ? "granted" : "denied",
    ad_user_data: consent.marketing ? "granted" : "denied",
    ad_personalization: consent.marketing ? "granted" : "denied",
    functionality_storage: consent.preferences ? "granted" : "denied",
    personalization_storage: consent.preferences ? "granted" : "denied",
    security_storage: "granted",
  });
  window.dispatchEvent(new Event("CookiebotOnConsentReady"));
  window.dispatchEvent(
    new Event(consent.marketing ? "CookiebotOnAccept" : "CookiebotOnDecline"),
  );
};

/** Queue a minimal anonymous receipt and notify other tabs independently of delivery. */
const recordConsent = () => {
  const cookie = CookieConsent.getCookie();
  if (!cookie.consentId) return;
  const body = JSON.stringify({
    consentId: cookie.consentId,
    revision: CONSENT_REVISION,
    categories: cookie.categories,
    consentTimestamp: cookie.lastConsentTimestamp ?? cookie.consentTimestamp,
    language: "en",
  });
  safeLocalStorageSetItem("tnr-consent-receipt", body);
  // A receipt quota failure must not prevent other tabs from applying withdrawal.
  safeLocalStorageSetItem(changeStorageKey, String(Date.now()));
  deliverReceipt(body);
};

/** Retry the latest bounded receipt after initialization or a restored connection. */
const deliverPendingReceipt = () => {
  const body = safeLocalStorageGetItem("tnr-consent-receipt");
  if (body && body.length <= 2048) deliverReceipt(body);
};

/** Clear a delivered receipt only when a newer choice has not replaced it. */
const deliverReceipt = (body: string) => {
  void fetch(receiptEndpoint, {
    method: "POST",
    mode: "same-origin",
    credentials: "same-origin",
    referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  })
    .then((response) => {
      if (!response.ok) return;
      if (safeLocalStorageGetItem("tnr-consent-receipt") === body)
        safeLocalStorageRemoveItem("tnr-consent-receipt");
    })
    .catch(() => {});
};
