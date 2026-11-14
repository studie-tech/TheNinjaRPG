"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect } from "react";
import { api } from "@/app/_trpc/client";
import { useCookieConsentKnown, useMarketingConsent } from "@/hooks/useCookieConsent";
import {
  clearAdClick,
  hasWithdrawnAdClickFor,
  readStoredAdClick,
  recordAdClickWithdrawn,
} from "@/libs/campaignSource";

// One request per identity per decline: a failure is retried on the next visit rather
// than in a loop, and the device keeps its click until a withdrawal succeeds. Signing in
// on the page (the native shell activates sessions in place) gets its own attempt, which
// reaches the account's linked click, and granting consent again starts a new episode, so
// a later decline withdraws the click reported meanwhile.
const attemptedIdentities = new Set<string>();

/**
 * Forgets the visitor's Google Ads click once they decline marketing cookies: the click
 * this device kept for a later registration, and for a signed-in player the click linked
 * to their character, even when the click was made on another device. Each account is
 * withdrawn once per device, and again after a registration here links a new click.
 */
export const AdClickConsentWatcher = () => {
  const isConsentKnown = useCookieConsentKnown();
  const marketingConsent = useMarketingConsent();
  const { isLoaded, isSignedIn, user } = useUser();
  const userId = isSignedIn ? user?.id : undefined;
  // A transport failure stays silent: the device marker survives, so the next visit retries.
  const { mutate: withdraw } = api.misc.withdrawAdClickConsent.useMutation({
    meta: { handlesTransportError: true },
  });
  useEffect(() => {
    if (marketingConsent === "granted") attemptedIdentities.clear();
    if (!isConsentKnown || !isLoaded || marketingConsent !== "declined") return;
    const identity = userId ?? "signed-out";
    if (attemptedIdentities.has(identity)) return;
    const clickId = readStoredAdClick();
    // A linked click is found through the session, so a signed-out device waits for it.
    const needsAccountWithdrawal = Boolean(userId) && !hasWithdrawnAdClickFor(userId);
    if (!clickId && !needsAccountWithdrawal) return;
    attemptedIdentities.add(identity);
    withdraw(
      { clickId },
      {
        // Recorded for the identity the request was sent as.
        onSuccess: (result) => {
          if (!result.success) return;
          clearAdClick();
          if (userId) recordAdClickWithdrawn(userId);
        },
      },
    );
  }, [isConsentKnown, isLoaded, marketingConsent, userId, withdraw]);
  return null;
};
