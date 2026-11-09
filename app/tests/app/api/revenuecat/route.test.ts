import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import * as nextHeaders from "next/headers";
import { POST } from "@/app/api/webhooks/revenuecat/route";
import { env } from "@/env/server.mjs";
import * as grants from "@/server/utils/purchases/grant";

interface RevenueCatRouteMocks {
  captureException: ReturnType<typeof vi.fn>;
  transferStorePurchases: ReturnType<typeof vi.fn>;
}

const mocks: RevenueCatRouteMocks = {
  captureException: vi.fn(),
  transferStorePurchases: vi.fn(),
};

const transferRequest = (environment?: string) =>
  new Request("https://example.test/api/webhooks/revenuecat", {
    method: "POST",
    body: JSON.stringify({
      event: {
        type: "TRANSFER",
        id: "transfer-event",
        app_id: "ios-app",
        event_timestamp_ms: 1_700_000_000_000,
        transferred_from: ["account-a"],
        transferred_to: ["account-b"],
        ...(environment === undefined ? {} : { environment }),
      },
    }),
  });

let originalConfiguration: Pick<
  typeof env,
  "REVENUECAT_ANDROID_APP_ID" | "REVENUECAT_IOS_APP_ID" | "REVENUECAT_WEBHOOK_SECRET"
>;
beforeEach(() => {
  originalConfiguration = {
    REVENUECAT_ANDROID_APP_ID: env.REVENUECAT_ANDROID_APP_ID,
    REVENUECAT_IOS_APP_ID: env.REVENUECAT_IOS_APP_ID,
    REVENUECAT_WEBHOOK_SECRET: env.REVENUECAT_WEBHOOK_SECRET,
  };
  Object.assign(env, {
    REVENUECAT_ANDROID_APP_ID: "android-app",
    REVENUECAT_IOS_APP_ID: "ios-app",
    REVENUECAT_WEBHOOK_SECRET: "webhook-secret",
  });
  vi.spyOn(Sentry, "captureException").mockImplementation(mocks.captureException);
  vi.spyOn(nextHeaders, "headers").mockResolvedValue(
    new Headers({ authorization: "webhook-secret" }) as never,
  );
  vi.spyOn(grants, "transferStorePurchases").mockImplementation(
    mocks.transferStorePurchases,
  );
  mocks.captureException.mockReset();
  mocks.transferStorePurchases
    .mockReset()
    .mockResolvedValue({ destinationUserId: "account-b", rowsAffected: 1 });
});

afterEach(() => {
  Object.assign(env, originalConfiguration);
  vi.restoreAllMocks();
});

describe("RevenueCat TRANSFER environment scoping", () => {
  it("applies a valid environment-less transfer to both isolated histories", async () => {
    const response = await POST(transferRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      handled: "transferred",
      destinationUserId: "account-b",
      rowsAffected: 2,
    });
    expect(mocks.transferStorePurchases).toHaveBeenCalledTimes(2);
    expect(
      mocks.transferStorePurchases.mock.calls.map(([, transfer]) => transfer),
    ).toEqual([
      expect.objectContaining({ eventId: "transfer-event", isSandbox: false }),
      expect.objectContaining({ eventId: "transfer-event", isSandbox: true }),
    ]);
  });

  it("keeps an explicit sandbox transfer scoped to sandbox history", async () => {
    const response = await POST(transferRequest("SANDBOX"));

    expect(response.status).toBe(200);
    expect(mocks.transferStorePurchases).toHaveBeenCalledTimes(1);
    expect(mocks.transferStorePurchases).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isSandbox: true }),
    );
  });
});
