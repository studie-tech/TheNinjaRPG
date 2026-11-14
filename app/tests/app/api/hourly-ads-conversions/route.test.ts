import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { GET } from "@/app/api/hourly-ads-conversions/route";
import * as settings from "@/libs/gamesettings";
import * as queries from "@/queries/adConversions";
import * as dataManager from "@/server/utils/googleDataManager";
import { timerClaimFixture } from "../../../setup/gameTimers";
import { resetServerModuleStubs, stubCronAuth } from "../../../setup/serverModules";

const request = () => new Request("https://example.com/api/hourly-ads-conversions");
const destinations = {
  customerId: "5015832988",
  conversionActionIds: { register: "111", tutorialComplete: "222" },
};
const upload = (id: string, eventIndex: number, adClickId: string, action: string) => ({
  id,
  requestId: "request-1",
  eventIndex,
  adClickId,
  action,
  createdAt: new Date(),
});
const row = (adClickId: string, convertedAt: Date) => ({
  adClickId,
  clickId: `Cj0KCQiA-${adClickId}`,
  clickIdType: "gclid" as const,
  consent: "unanswered" as const,
  convertedAt,
});

beforeEach(() => {
  stubCronAuth(() => null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Sentry, "captureException").mockReturnValue("test-event");
  vi.spyOn(Sentry, "flush").mockResolvedValue(true);
  vi.spyOn(settings, "lockWithHourlyTimer").mockResolvedValue({
    ...timerClaimFixture(),
    release: vi.fn(async () => true),
    isNewHour: true,
    prevTime: new Date(0),
    response: Response.json(null),
  });
  vi.spyOn(dataManager, "getAdConversionDestinations").mockReturnValue(destinations);
  vi.spyOn(dataManager, "getDataManagerToken").mockResolvedValue("token");
  vi.spyOn(dataManager, "ingestAdConversions").mockResolvedValue({
    requestId: "request-2",
  });
  vi.spyOn(dataManager, "retrieveAdConversionStatus").mockResolvedValue({
    requestStatusPerDestination: [
      { destination: { reference: "sign-up" }, requestStatus: "SUCCESS" },
      {
        destination: { reference: "tutorial-complete" },
        requestStatus: "PARTIAL_SUCCESS",
        errorInfo: {
          errorCounts: [
            {
              reason: "PROCESSING_ERROR_REASON_TOO_RECENT_CLICK",
              recordIndices: ["1"],
            },
          ],
        },
      },
    ],
  });
  vi.spyOn(queries, "markAdConversionsReported").mockResolvedValue({} as never);
  vi.spyOn(queries, "deleteAdConversionUploads").mockResolvedValue({} as never);
  vi.spyOn(queries, "insertAdConversionUploads").mockResolvedValue({} as never);
  vi.spyOn(queries, "selectAdConversionUploads").mockResolvedValue([] as never);
  vi.spyOn(queries, "selectPendingRegisterAdConversions").mockResolvedValue([
    row("click-1", new Date("2026-11-12T08:41:01Z")),
  ] as never);
  vi.spyOn(queries, "selectPendingTutorialAdConversions").mockResolvedValue([
    row("click-2", new Date("2026-11-13T04:11:11Z")),
  ] as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetServerModuleStubs();
});

describe("GET /api/hourly-ads-conversions", () => {
  it("waits without credentials until Google Ads is configured", async () => {
    vi.spyOn(dataManager, "getAdConversionDestinations").mockReturnValue(null);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(settings.lockWithHourlyTimer).not.toHaveBeenCalled();
    expect(dataManager.ingestAdConversions).not.toHaveBeenCalled();
  });

  it("sends pending conversions and records each one as awaiting its status", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const calls = (dataManager.ingestAdConversions as ReturnType<typeof vi.fn>).mock
      .calls;
    const body = calls[0]?.[1] as { events: { transactionId: string }[] };
    expect(body.events.map((event) => event.transactionId)).toEqual([
      "sign-up:click-1",
      "tutorial-complete:click-2",
    ]);
    const inserted =
      (queries.insertAdConversionUploads as ReturnType<typeof vi.fn>).mock.calls[0] ??
      [];
    expect(inserted[1]).toBe("request-2");
    expect(
      (inserted[2] as { adClickId: string; action: string }[]).map((event) => [
        event.adClickId,
        event.action,
      ]),
    ).toEqual([
      ["click-1", "register"],
      ["click-2", "tutorialComplete"],
    ]);
    // Nothing is settled until Google reports how it processed the request.
    expect(queries.markAdConversionsReported).not.toHaveBeenCalled();
  });

  it("settles processed events and frees transient failures for resending", async () => {
    vi.spyOn(queries, "selectPendingRegisterAdConversions").mockResolvedValue(
      [] as never,
    );
    vi.spyOn(queries, "selectPendingTutorialAdConversions").mockResolvedValue(
      [] as never,
    );
    vi.spyOn(queries, "selectAdConversionUploads").mockResolvedValue([
      upload("upload-a", 0, "click-1", "register"),
      upload("upload-b", 1, "click-2", "tutorialComplete"),
    ] as never);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(dataManager.ingestAdConversions).not.toHaveBeenCalled();
    expect(
      (queries.markAdConversionsReported as ReturnType<typeof vi.fn>).mock.calls,
    ).toEqual([[expect.anything(), "register", ["click-1"]]]);
    expect(
      (queries.deleteAdConversionUploads as ReturnType<typeof vi.fn>).mock.calls,
    ).toEqual([[expect.anything(), ["upload-a", "upload-b"]]]);
  });

  it("waits while Google is still processing a recent upload", async () => {
    vi.spyOn(queries, "selectPendingRegisterAdConversions").mockResolvedValue(
      [] as never,
    );
    vi.spyOn(queries, "selectPendingTutorialAdConversions").mockResolvedValue(
      [] as never,
    );
    vi.spyOn(queries, "selectAdConversionUploads").mockResolvedValue([
      upload("upload-a", 0, "click-1", "register"),
    ] as never);
    vi.spyOn(dataManager, "retrieveAdConversionStatus").mockResolvedValue({
      requestStatusPerDestination: [{ requestStatus: "PROCESSING" }],
    });
    await GET(request());
    expect(queries.markAdConversionsReported).not.toHaveBeenCalled();
    expect(queries.deleteAdConversionUploads).not.toHaveBeenCalled();
  });

  it("saves settlement before sending, even when the send fails", async () => {
    vi.spyOn(queries, "selectAdConversionUploads").mockResolvedValue([
      upload("upload-a", 0, "click-1", "register"),
    ] as never);
    vi.spyOn(dataManager, "ingestAdConversions").mockRejectedValue(
      new Error("Data Manager request failed: 503"),
    );
    vi.spyOn(dataManager, "retrieveAdConversionStatus").mockResolvedValue({
      requestStatusPerDestination: [
        {
          destination: { reference: "sign-up" },
          requestStatus: "FAILED",
          errorInfo: {
            errorCounts: [
              { reason: "PROCESSING_ERROR_REASON_EXPIRED_CLICK", recordIndices: [0] },
            ],
          },
        },
      ],
    });
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(
      (queries.markAdConversionsReported as ReturnType<typeof vi.fn>).mock.calls,
    ).toEqual([[expect.anything(), "register", ["click-1"]]]);
    // The earlier rejection is reported even though the new send failed.
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Google Ads rejected ad click conversions" }),
      expect.objectContaining({
        extra: { rejections: { PROCESSING_ERROR_REASON_EXPIRED_CLICK: 1 } },
      }),
    );
  });

  it("settles events Google refuses as invalid so the rest can be sent", async () => {
    vi.spyOn(dataManager, "ingestAdConversions").mockResolvedValue({
      invalidEventIndices: [1],
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(
      (queries.markAdConversionsReported as ReturnType<typeof vi.fn>).mock.calls,
    ).toEqual([[expect.anything(), "tutorialComplete", ["click-2"]]]);
    expect(queries.insertAdConversionUploads).not.toHaveBeenCalled();
  });

  it("leaves conversions pending when Google rejects the upload", async () => {
    vi.spyOn(dataManager, "ingestAdConversions").mockRejectedValue(
      new Error("Data Manager ingest failed: 400"),
    );
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(queries.markAdConversionsReported).not.toHaveBeenCalled();
  });
});
