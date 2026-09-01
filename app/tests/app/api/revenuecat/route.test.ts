import { beforeEach, describe, expect, it, vi } from "vitest";

interface RevenueCatRouteMocks {
  captureException: ReturnType<typeof vi.fn>;
  transferStorePurchases: ReturnType<typeof vi.fn>;
}

const getMocks = (): RevenueCatRouteMocks => {
  const globals = globalThis as typeof globalThis & {
    __revenueCatRouteMocks?: RevenueCatRouteMocks;
  };
  globals.__revenueCatRouteMocks ??= {
    captureException: vi.fn(),
    transferStorePurchases: vi.fn(),
  };
  return globals.__revenueCatRouteMocks;
};

const mocks = getMocks();

vi.mock("@sentry/node", () => ({ captureException: getMocks().captureException }));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers({ authorization: "webhook-secret" })),
}));
vi.mock("@/env/server.mjs", () => ({
  env: {
    REVENUECAT_ANDROID_APP_ID: "android-app",
    REVENUECAT_IOS_APP_ID: "ios-app",
    REVENUECAT_WEBHOOK_SECRET: "webhook-secret",
  },
}));
vi.mock("@/server/db", () => ({ drizzleDB: { kind: "test-db" } }));
vi.mock("@/server/utils/purchases/grant", () => ({
  extendStoreSubscription: vi.fn(),
  grantStorePurchase: vi.fn(),
  revokeFederalStatus: vi.fn(),
  transferStorePurchases: getMocks().transferStorePurchases,
}));

import { POST } from "@/app/api/webhooks/revenuecat/route";

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

beforeEach(() => {
  mocks.captureException.mockReset();
  mocks.transferStorePurchases
    .mockReset()
    .mockResolvedValue({ destinationUserId: "account-b", rowsAffected: 1 });
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
    expect(mocks.transferStorePurchases.mock.calls.map(([, transfer]) => transfer)).toEqual([
      expect.objectContaining({ eventId: "transfer-event", isSandbox: false }),
      expect.objectContaining({ eventId: "transfer-event", isSandbox: true }),
    ]);
  });

  it("keeps an explicit sandbox transfer scoped to sandbox history", async () => {
    const response = await POST(transferRequest("SANDBOX"));

    expect(response.status).toBe(200);
    expect(mocks.transferStorePurchases).toHaveBeenCalledOnce();
    expect(mocks.transferStorePurchases).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isSandbox: true }),
    );
  });
});
