"use client";

import { useEffect, useState } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import { Button } from "@/components/ui/button";
import { useNativeShell } from "@/hooks/useNativeShell";
import { CONSENT_REVISION, consentConfig } from "@/libs/consentConfig";
import { isNativeUserAgent } from "@/libs/native/userAgent";

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

let initialization: Promise<void> | undefined;
const changeStorageKey = "tnr-consent-change";
const receiptEndpoint = "/api/consent-receipts";

/** One initialization per document, including StrictMode and shell remounts. */
const initializeConsent = () => {
  initialization ??= CookieConsent.run({
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
  }).then(() => {
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
  try {
    localStorage.setItem("tnr-consent-receipt", body);
  } catch {
    /* A choice still applies when browser storage is restricted. */
  }
  try {
    // A receipt quota failure must not prevent other tabs from applying withdrawal.
    localStorage.setItem(changeStorageKey, String(Date.now()));
  } catch {
    /* Receipt delivery remains available when the change signal cannot be stored. */
  }
  deliverReceipt(body);
};

const deliverPendingReceipt = () => {
  try {
    const body = localStorage.getItem("tnr-consent-receipt");
    if (body && body.length <= 2048) deliverReceipt(body);
  } catch {
    /* Optional tracking remains independent of receipt availability. */
  }
};

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
      try {
        if (localStorage.getItem("tnr-consent-receipt") === body)
          localStorage.removeItem("tnr-consent-receipt");
      } catch {
        /* Delivery succeeded even if storage became unavailable. */
      }
    })
    .catch(() => {});
};
