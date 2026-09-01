import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NativeStore from "@/components/native/NativeStore";
import type { StorePackage } from "@/libs/native/purchases";
import { ensureDom } from "../setup-dom.mjs";

type AsyncMock = ReturnType<
  typeof vi.fn<(...args: unknown[]) => Promise<unknown>>
>;
type SyncMock = ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
type NativeStoreMocks = {
  bind: AsyncMock;
  getCustomerInfo: AsyncMock;
  purchase: AsyncMock;
  syncCustomerInfo: AsyncMock;
  refetchRecent: AsyncMock;
  fetchRecent: AsyncMock;
  invalidateRecent: AsyncMock;
  invalidateProfile: AsyncMock;
  toast: SyncMock;
};

const storePackage = {
  identifier: "reputation-package",
  product: {
    identifier: "tnr_reps_tier1",
    priceString: "$0.99",
    title: "Reputation",
    description: "Reputation",
  },
} as StorePackage;

function testMocks(): NativeStoreMocks {
  const globals = globalThis as typeof globalThis & {
    __nativeStoreMocks?: NativeStoreMocks;
  };
  globals.__nativeStoreMocks ??= {
    bind: vi.fn(),
    getCustomerInfo: vi.fn(),
    purchase: vi.fn(),
    syncCustomerInfo: vi.fn(),
    refetchRecent: vi.fn(),
    fetchRecent: vi.fn(),
    invalidateRecent: vi.fn(),
    invalidateProfile: vi.fn(),
    toast: vi.fn(),
  };
  return globals.__nativeStoreMocks;
}

vi.mock("@/app/_trpc/client", () => ({
  api: {
    useUtils: () => ({
      purchases: {
        recent: {
          invalidate: testMocks().invalidateRecent,
          fetch: testMocks().fetchRecent,
        },
      },
      profile: { getUser: { invalidate: testMocks().invalidateProfile } },
    }),
    purchases: {
      catalogue: {
        useQuery: () => ({
          data: {
            isConfigured: true,
            reputation: [
              { productId: "tnr_reps_tier1", reputationPoints: 8, usd: 0.99 },
            ],
            federal: [],
          },
        }),
      },
      recent: {
        useQuery: () => ({
          data: [],
          refetch: testMocks().refetchRecent,
          isFetching: false,
        }),
      },
    },
  },
}));

vi.mock("@/hooks/useNativeShell", () => ({ useNativeShell: () => true }));

vi.mock("@/utils/UserContext", () => ({
  useUserData: () => ({
    userId: "player-1",
    data: { userId: "player-1", reputationPoints: 10 },
  }),
}));

vi.mock("@/env/client.mjs", () => ({
  env: {
    NEXT_PUBLIC_REVENUECAT_IOS_KEY: "ios-key",
    NEXT_PUBLIC_REVENUECAT_ANDROID_KEY: "android-key",
  },
}));

vi.mock("@/libs/native", () => ({
  platform: () => "ios",
  purchases: {
    bind: (...args: unknown[]) => testMocks().bind(...args),
    getCustomerInfo: (...args: unknown[]) => testMocks().getCustomerInfo(...args),
    purchase: (...args: unknown[]) => testMocks().purchase(...args),
    syncCustomerInfo: (...args: unknown[]) => testMocks().syncCustomerInfo(...args),
    productIdForPackage: (entry: StorePackage) => entry.product.identifier,
    restore: vi.fn(),
  },
}));

vi.mock("@/libs/toast", () => ({
  showMutationToast: (value: unknown) => testMocks().toast(value),
}));

vi.mock("@/layout/ContentBox", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/layout/Loader", () => ({
  default: ({ explanation }: { explanation: string }) => <span>{explanation}</span>,
}));

ensureDom();

const STORAGE_KEY = "tnr:unsettled-store-purchases";

beforeEach(() => {
  window.localStorage.clear();
  const mocks = testMocks();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.bind.mockResolvedValue([storePackage]);
  mocks.getCustomerInfo.mockResolvedValue({
    activeEntitlements: [],
    activeSubscriptions: [],
    originalAppUserId: "player-1",
    transactions: [],
  });
  mocks.syncCustomerInfo.mockResolvedValue({
    activeEntitlements: [],
    activeSubscriptions: [],
    originalAppUserId: "player-1",
    transactions: [],
  });
  mocks.refetchRecent.mockResolvedValue({ data: [], error: null });
  mocks.fetchRecent.mockResolvedValue([]);
  mocks.invalidateRecent.mockResolvedValue(undefined);
  mocks.invalidateProfile.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NativeStore purchase recovery", () => {
  it("persists the fresh baseline before awaiting the native purchase sheet", async () => {
    let finishPurchase: ((value: { status: "cancelled" }) => void) | undefined;
    testMocks().purchase.mockImplementation(
      async () =>
        await new Promise<{ status: "cancelled" }>((resolve) => {
          finishPurchase = resolve;
        }),
    );
    const view = render(<NativeStore />);

    const buy = await view.findByRole("button", { name: "Buy" });
    await waitFor(() => expect((buy as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(buy);
    await waitFor(() => expect(testMocks().purchase).toHaveBeenCalledTimes(1));

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([
      expect.objectContaining({
        accountId: "player-1",
        attempt: expect.objectContaining({
          productId: "tnr_reps_tier1",
          baselineReceiptIds: [],
          baselineNativeTransactionIds: [],
          phase: "sheet-open",
        }),
      }),
    ]);

    await act(async () => finishPurchase?.({ status: "cancelled" }));
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([]),
    );
  });

  it("safely abandons a killed sheet only after synced history shows no charge", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          accountId: "player-1",
          attempt: {
            productId: "tnr_reps_tier1",
            baselineReceiptIds: [],
            baselineNativeTransactionIds: ["before"],
            phase: "sheet-open",
            startedAt: "2026-09-01T12:00:00.000Z",
          },
        },
      ]),
    );
    testMocks().syncCustomerInfo.mockResolvedValue({
      activeEntitlements: [],
      activeSubscriptions: [],
      originalAppUserId: "player-1",
      transactions: [{ transactionId: "before", productId: "tnr_reps_tier1" }],
    });
    const view = render(<NativeStore />);

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([]),
    );
    const buy = await view.findByRole("button", { name: "Buy" });
    expect((buy as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps an ambiguous StoreProblem locked instead of allowing a retry charge", async () => {
    testMocks().purchase.mockResolvedValue({
      status: "error",
      code: "2",
      message: "Store temporarily unavailable",
      mayHaveCharged: true,
    });
    const view = render(<NativeStore />);
    const buy = await view.findByRole("button", { name: "Buy" });
    await waitFor(() => expect((buy as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(buy);

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(STORAGE_KEY) ?? "[]",
      ) as Array<{ attempt: { phase: string } }>;
      expect(stored).toHaveLength(1);
      expect(stored[0]?.attempt.phase).toBe("charged-or-pending");
    });
    expect(testMocks().toast).toHaveBeenCalledWith({
      success: false,
      message:
        "Store temporarily unavailable The store outcome is being reconciled before another charge is allowed.",
    });
    expect((buy as HTMLButtonElement).disabled).toBe(true);
  });

  it("retains a failed recovery lock and shows manual verification errors", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          accountId: "player-1",
          attempt: {
            productId: "tnr_reps_tier1",
            baselineReceiptIds: ["before"],
          },
        },
      ]),
    );
    testMocks().fetchRecent.mockRejectedValue(new Error("verification offline"));
    const view = render(<NativeStore />);

    const retry = await view.findByRole("button", { name: "Retry verification" });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toHaveLength(1);
    expect(testMocks().toast).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(retry);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(testMocks().toast).toHaveBeenCalledWith({
      success: false,
      message: "verification offline",
    });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toHaveLength(1);
    expect((retry as HTMLButtonElement).disabled).toBe(false);
  });
});
