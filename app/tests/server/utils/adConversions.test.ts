import { describe, expect, it } from "bun:test";
import {
  AD_CLICK_ID_PATTERN,
  adClickConsentFor,
  buildAdConversionIngestRequest,
  settleAdConversionUpload,
} from "@/server/utils/adConversions";

describe("adClickConsentFor", () => {
  it("keeps a consented click in every country", () => {
    expect(adClickConsentFor("granted", "GB")).toBe("granted");
    expect(adClickConsentFor("granted", undefined)).toBe("granted");
  });

  it("never keeps a click after the visitor declined", () => {
    expect(adClickConsentFor("declined", "US")).toBeNull();
  });

  it("keeps an unanswered click only where Google does not require consent", () => {
    expect(adClickConsentFor("unanswered", "US")).toBe("unanswered");
    expect(adClickConsentFor("unanswered", "AU")).toBe("unanswered");
    expect(adClickConsentFor("unanswered", "GB")).toBeNull();
    expect(adClickConsentFor("unanswered", "DE")).toBeNull();
    expect(adClickConsentFor("unanswered", "CH")).toBeNull();
    expect(adClickConsentFor("unanswered", "RE")).toBeNull();
    expect(adClickConsentFor("unanswered", undefined)).toBeNull();
  });
});

describe("buildAdConversionIngestRequest", () => {
  it("sends each conversion to its action with its click identifier and consent", () => {
    const request = buildAdConversionIngestRequest(
      [
        {
          adClickId: "click-1",
          clickId: "Cj0KCQiA-abc_123",
          clickIdType: "gclid",
          action: "register",
          convertedAt: new Date("2026-11-12T08:41:01.844Z"),
          consent: "granted",
        },
        {
          adClickId: "click-2",
          clickId: "0AAAAA-def_456",
          clickIdType: "wbraid",
          action: "tutorialComplete",
          convertedAt: new Date("2026-11-13T04:11:11.652Z"),
          consent: "unanswered",
        },
      ],
      {
        customerId: "5015832988",
        conversionActionIds: { register: "111", tutorialComplete: "222" },
      },
    );
    const account = { accountType: "GOOGLE_ADS", accountId: "5015832988" };
    expect(request).toEqual({
      destinations: [
        {
          reference: "sign-up",
          operatingAccount: account,
          loginAccount: account,
          productDestinationId: "111",
        },
        {
          reference: "tutorial-complete",
          operatingAccount: account,
          loginAccount: account,
          productDestinationId: "222",
        },
      ],
      events: [
        {
          destinationReferences: ["sign-up"],
          adIdentifiers: { gclid: "Cj0KCQiA-abc_123" },
          eventTimestamp: "2026-11-12T08:41:01.844Z",
          eventSource: "WEB",
          transactionId: "sign-up:click-1",
          conversionValue: 2,
          currency: "DKK",
          consent: {
            adUserData: "CONSENT_GRANTED",
            adPersonalization: "CONSENT_GRANTED",
          },
        },
        {
          destinationReferences: ["tutorial-complete"],
          adIdentifiers: { wbraid: "0AAAAA-def_456" },
          eventTimestamp: "2026-11-13T04:11:11.652Z",
          eventSource: "WEB",
          transactionId: "tutorial-complete:click-2",
          conversionValue: 20,
          currency: "DKK",
        },
      ],
      validateOnly: false,
    });
  });
});

describe("AD_CLICK_ID_PATTERN", () => {
  it("accepts URL-safe click IDs and rejects anything else", () => {
    expect(AD_CLICK_ID_PATTERN.test("EAIaIQobChMI8-ab_CD")).toBe(true);
    expect(AD_CLICK_ID_PATTERN.test("abc,def,ghij")).toBe(false);
    expect(AD_CLICK_ID_PATTERN.test("short")).toBe(false);
  });
});

describe("settleAdConversionUpload", () => {
  // Events 0 and 1 went to the sign-up destination, 2 and 3 to the tutorial one.
  const events = [
    { eventIndex: 0, action: "register" as const },
    { eventIndex: 1, action: "register" as const },
    { eventIndex: 2, action: "tutorialComplete" as const },
    { eventIndex: 3, action: "tutorialComplete" as const },
  ];
  const signUp = { destination: { reference: "sign-up" } };
  const tutorial = { destination: { reference: "tutorial-complete" } };

  it("waits while any destination is still processing", () => {
    const settlement = settleAdConversionUpload(
      {
        requestStatusPerDestination: [
          { ...signUp, requestStatus: "SUCCESS" },
          { ...tutorial, requestStatus: "PROCESSING" },
        ],
      },
      events,
    );
    expect(settlement.isProcessing).toBe(true);
    expect(settlement.settled.map((event) => event.eventIndex)).toEqual([]);
  });

  it("resends named transient failures and settles the rest, counting rejections", () => {
    const settlement = settleAdConversionUpload(
      {
        requestStatusPerDestination: [
          {
            ...signUp,
            requestStatus: "PARTIAL_SUCCESS",
            errorInfo: {
              errorCounts: [
                {
                  reason: "PROCESSING_ERROR_REASON_INTERNAL_ERROR",
                  recordIndices: ["1"],
                },
              ],
            },
          },
          {
            ...tutorial,
            requestStatus: "PARTIAL_SUCCESS",
            errorInfo: {
              errorCounts: [
                { reason: "PROCESSING_ERROR_REASON_EXPIRED_CLICK", recordIndices: [2] },
                {
                  reason: "PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID",
                  recordIndices: [3],
                },
              ],
            },
          },
        ],
      },
      events,
    );
    expect(settlement).toEqual({
      isProcessing: false,
      settled: events.filter((event) => event.eventIndex !== 1),
      rejections: [{ reason: "PROCESSING_ERROR_REASON_EXPIRED_CLICK", count: 1 }],
    });
  });

  it("resends only the events of a destination that failed without naming them", () => {
    const settlement = settleAdConversionUpload(
      {
        requestStatusPerDestination: [
          { ...signUp, requestStatus: "SUCCESS" },
          { ...tutorial, requestStatus: "FAILED" },
        ],
      },
      events,
    );
    expect(settlement.settled.map((event) => event.eventIndex)).toEqual([0, 1]);
  });

  it("resends a partial success that does not name its failed events", () => {
    const settlement = settleAdConversionUpload(
      {
        requestStatusPerDestination: [
          { ...signUp, requestStatus: "PARTIAL_SUCCESS" },
          { ...tutorial, requestStatus: "SUCCESS" },
        ],
      },
      events,
    );
    expect(settlement.settled.map((event) => event.eventIndex)).toEqual([2, 3]);
  });

  it("settles a destination whose unnamed errors are all final", () => {
    const settlement = settleAdConversionUpload(
      {
        requestStatusPerDestination: [
          { ...signUp, requestStatus: "SUCCESS" },
          {
            ...tutorial,
            requestStatus: "FAILED",
            errorInfo: {
              errorCounts: [
                { reason: "PROCESSING_ERROR_REASON_EXPIRED_CLICK", recordCount: "2" },
              ],
            },
          },
        ],
      },
      events,
    );
    expect(settlement.settled.map((event) => event.eventIndex)).toEqual([0, 1, 2, 3]);
    expect(settlement.rejections).toEqual([
      { reason: "PROCESSING_ERROR_REASON_EXPIRED_CLICK", count: 2 },
    ]);
  });

  it("resends a destination whose unnamed errors include a transient one", () => {
    const settlement = settleAdConversionUpload(
      {
        requestStatusPerDestination: [
          {
            ...tutorial,
            requestStatus: "FAILED",
            errorInfo: {
              errorCounts: [
                { reason: "PROCESSING_ERROR_REASON_EXPIRED_CLICK", recordCount: "1" },
                { reason: "PROCESSING_ERROR_REASON_INTERNAL_ERROR", recordCount: "1" },
              ],
            },
          },
          { ...signUp, requestStatus: "SUCCESS" },
        ],
      },
      events,
    );
    expect(settlement.settled.map((event) => event.eventIndex)).toEqual([0, 1]);
    expect(settlement.rejections).toEqual([]);
  });
});
