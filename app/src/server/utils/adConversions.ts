import type {
  AdClickConsent,
  AdClickIdType,
  AdConversionAction,
} from "@/drizzle/constants";

/**
 * Google Ads click conversions reported by the server, so a registration or tutorial
 * completion is counted even when the browser never sent the GA4 event (declined
 * analytics cookies, a broken GA4 session, a tutorial finished days later). The hourly
 * /api/hourly-ads-conversions cron sends them through the Google Data Manager API, which
 * matches each one to its ad click.
 */

/** Conversion actions; each is an "Import from clicks" action in Google Ads. */
export const AD_CONVERSION_ACTIONS = {
  register: { reference: "sign-up", valueDkk: 2 },
  tutorialComplete: { reference: "tutorial-complete", valueDkk: 20 },
} as const satisfies Record<
  AdConversionAction,
  { reference: string; valueDkk: number }
>;

/**
 * Google accepts conversions up to 90 days after their click, so a click is kept that long
 * for a visitor who registers weeks after clicking the ad.
 */
export const AD_CLICK_RETENTION_DAYS = 90;

/**
 * A registration without the click stored on its device is credited to a click from the
 * same IP hash only within this window. Beyond it, the IP has likely been reassigned, and an
 * organic registration on a shared IP (carrier NAT, campus, household) would take an older
 * stranger's click.
 */
export const AD_CLICK_IP_LINK_DAYS = 7;

/** Conversions sent per Data Manager request; Google accepts up to 2,000 events. */
export const AD_CONVERSION_BATCH_SIZE = 2_000;

/**
 * An upload whose status Google cannot report after this many days is sent again; its
 * transaction IDs make a conversion that did land a duplicate Google skips.
 */
export const AD_CONVERSION_UPLOAD_STALE_DAYS = 3;

/** Google click identifiers are URL-safe base64; anything else is not stored. */
export const AD_CLICK_ID_PATTERN = /^[A-Za-z0-9_-]{10,191}$/;

// EEA, United Kingdom and Switzerland, where Google requires consent before ad data is
// shared with it (EU user consent policy). Vercel reports EU territories outside
// continental Europe (outermost regions and Aland) under their own country codes.
const CONSENT_REQUIRED_COUNTRIES = new Set(
  (
    "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE " +
    "GF GP MQ RE YT MF AX IS LI NO GB CH"
  ).split(" "),
);

/**
 * The consent to record with an ad click, or null when the click must not be kept or
 * linked: the visitor declined marketing cookies, or has not answered where consent is
 * required. An unknown country is treated as one that requires consent.
 */
export const adClickConsentFor = (
  marketingConsent: AdClickConsent | "declined",
  country: string | undefined,
): AdClickConsent | null => {
  if (marketingConsent === "granted") return "granted";
  if (marketingConsent === "declined") return null;
  if (!country || CONSENT_REQUIRED_COUNTRIES.has(country)) return null;
  return "unanswered";
};

/** One conversion of an ad click, ready to report to Google. */
export interface AdConversion {
  adClickId: string;
  clickId: string;
  clickIdType: AdClickIdType;
  action: AdConversionAction;
  convertedAt: Date;
  consent: AdClickConsent;
}

/** The Google Ads customer and the conversion action ID for each reported action. */
export interface AdConversionDestinations {
  customerId: string;
  conversionActionIds: Record<AdConversionAction, string>;
}

/**
 * Build a Data Manager `events:ingest` request. Each event names its conversion action
 * through a destination reference, and its transaction ID makes a repeated upload of the
 * same conversion a no-op. An unanswered consent leaves the event's consent unset.
 */
export const buildAdConversionIngestRequest = (
  conversions: AdConversion[],
  destinations: AdConversionDestinations,
) => {
  const account = { accountType: "GOOGLE_ADS", accountId: destinations.customerId };
  return {
    destinations: (Object.keys(AD_CONVERSION_ACTIONS) as AdConversionAction[]).map(
      (action) => ({
        reference: AD_CONVERSION_ACTIONS[action].reference,
        operatingAccount: account,
        loginAccount: account,
        productDestinationId: destinations.conversionActionIds[action],
      }),
    ),
    events: conversions.map((conversion) => {
      const action = AD_CONVERSION_ACTIONS[conversion.action];
      return {
        destinationReferences: [action.reference],
        adIdentifiers: { [conversion.clickIdType]: conversion.clickId },
        eventTimestamp: conversion.convertedAt.toISOString(),
        eventSource: "WEB",
        transactionId: `${action.reference}:${conversion.adClickId}`,
        conversionValue: action.valueDkk,
        currency: "DKK",
        ...(conversion.consent === "granted" && {
          consent: {
            adUserData: "CONSENT_GRANTED",
            adPersonalization: "CONSENT_GRANTED",
          },
        }),
      };
    }),
    validateOnly: false,
  };
};

/**
 * Processing errors that can succeed when the same conversion is sent again later. An
 * unspecified reason is treated the same way, since nothing says it is final.
 */
const RETRYABLE_REASONS = new Set([
  "PROCESSING_ERROR_REASON_UNSPECIFIED",
  "PROCESSING_ERROR_REASON_INTERNAL_ERROR",
  "PROCESSING_ERROR_REASON_TOO_RECENT_CLICK",
  "PROCESSING_ERROR_REASON_DESTINATION_TOO_RECENTLY_CREATED",
]);

/** The conversion already landed; nothing is wrong with it. */
const DUPLICATE_REASON = "PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID";

/** A Data Manager `requestStatus:retrieve` response, reduced to what settling reads. */
export interface AdConversionRequestStatus {
  requestStatusPerDestination?: {
    requestStatus?: string;
    destination?: { reference?: string };
    errorInfo?: {
      errorCounts?: {
        reason?: string;
        recordCount?: number | string;
        recordIndices?: (number | string)[];
      }[];
    };
  }[];
}

/** How one upload's events settle from Google's request status. */
export interface AdConversionUploadSettlement<T> {
  /** Google has not finished processing; check again on the next run. */
  isProcessing: boolean;
  /** Events Google processed or rejected for good. */
  settled: T[];
  /** Permanent rejections, for monitoring. */
  rejections: { reason: string; count: number }[];
}

/**
 * Settle the events of one upload from its request status, destination by destination:
 * each event went only to the destination of its conversion action. Errors that name
 * their events settle or resend those events by reason. A destination's unnamed events
 * are settled when it succeeded or every unnamed error is final, and sent again otherwise
 * (an unnamed transient error, or a failure without any reason); transaction IDs dedupe
 * the ones that landed.
 */
export const settleAdConversionUpload = <
  T extends { eventIndex: number; action: AdConversionAction },
>(
  status: AdConversionRequestStatus,
  events: T[],
): AdConversionUploadSettlement<T> => {
  const destinations = status.requestStatusPerDestination ?? [];
  const isProcessing =
    destinations.length === 0 ||
    destinations.some((destination) => destination.requestStatus === "PROCESSING");
  if (isProcessing) {
    return { isProcessing, settled: [], rejections: [] };
  }
  const retry = new Set<number>();
  const rejections: { reason: string; count: number }[] = [];
  const reject = (reason: string, count: number) => {
    if (reason !== DUPLICATE_REASON) rejections.push({ reason, count });
  };
  for (const destination of destinations) {
    const reference = destination.destination?.reference;
    const ownEvents = events.filter(
      (event) =>
        !reference || AD_CONVERSION_ACTIONS[event.action].reference === reference,
    );
    const ownIndices = new Set(ownEvents.map((event) => event.eventIndex));
    const errorCounts = destination.errorInfo?.errorCounts ?? [];
    const named = new Set<number>();
    const unnamed: { reason: string; count: number }[] = [];
    for (const count of errorCounts) {
      const reason = count.reason ?? "PROCESSING_ERROR_REASON_UNSPECIFIED";
      const indices = (count.recordIndices ?? []).map(Number);
      if (indices.length === 0) {
        unnamed.push({ reason, count: Number(count.recordCount ?? 0) });
        continue;
      }
      for (const index of indices) {
        if (!ownIndices.has(index)) continue;
        named.add(index);
        if (RETRYABLE_REASONS.has(reason)) retry.add(index);
        else reject(reason, 1);
      }
    }
    // A partial success that named its failures succeeded for the rest.
    const isUnnamedFinal =
      destination.requestStatus === "SUCCESS" ||
      (unnamed.length === 0 &&
        named.size > 0 &&
        destination.requestStatus === "PARTIAL_SUCCESS") ||
      (unnamed.length > 0 &&
        unnamed.every(({ reason }) => !RETRYABLE_REASONS.has(reason)));
    if (isUnnamedFinal) {
      for (const { reason, count } of unnamed) reject(reason, count);
      continue;
    }
    for (const event of ownEvents) {
      if (!named.has(event.eventIndex)) retry.add(event.eventIndex);
    }
  }
  return {
    isProcessing,
    settled: events.filter((event) => !retry.has(event.eventIndex)),
    rejections,
  };
};
