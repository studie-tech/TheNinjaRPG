import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as streaks from "@/hooks/useActivityStreaks";
import { ActivityStreakPanel } from "@/layout/ActivityStreakPanel";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { deferred } from "../setup/deferred";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

let queryClient: QueryClient;
let purchase: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  purchase = vi.fn(() => ({ success: false, message: "Not enough ryo" }));
  Object.assign(vi.spyOn(client, "api" as never), {
    activityStreak: testApi.activityStreak,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(UserContext, "useUserInfo").mockImplementation(
    () => ({ timeDiff: 0, prepareUserUpdate: () => 1, updateUser: vi.fn() }) as never,
  );
  vi.spyOn(streaks, "useActivityStreaks").mockImplementation(
    () =>
      ({
        data: { streaks: [], activeRecurringConfig: null },
        isLoading: false,
      }) as never,
  );
  vi.spyOn(streaks, "useClaimStreakDay").mockImplementation(
    () => ({ mutate: vi.fn(), isPending: false }) as never,
  );
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const mount = () => {
  const trpcClient = fakeTrpcClient(async (path, input) => {
    if (path === "activityStreak.getAvailablePasses")
      return [
        {
          id: "pass",
          name: "Summer Pass",
          image: null,
          totalDays: 7,
          ryoCost: 500,
          repsCost: 0,
          seichiSilverCost: 0,
          startDate: null,
          endDate: null,
        },
      ];
    if (path === "activityStreak.purchaseEventPass") return purchase(input);
    throw new Error(`Unexpected procedure ${path}`);
  });
  return render(
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <ActivityStreakPanel />
    </TrpcTestProviders>,
  );
};

const purchaseButton = async (view: ReturnType<typeof mount>, name = "Purchase") =>
  (await view.findAllByRole("button", { name })).find(
    (button) => button.tagName === "BUTTON",
  ) as HTMLButtonElement;

const openPurchase = async (view: ReturnType<typeof mount>) => {
  fireEvent.click(await purchaseButton(view));
  return view.findByRole("dialog", { name: "Purchase Summer Pass?" });
};

it("confirms the event pass cost and duration before purchasing", async () => {
  const view = mount();
  const dialog = await openPurchase(view);
  expect(dialog.textContent).toContain("This event pass costs 500 ryo.");
  expect(dialog.textContent).toContain(
    "You will be able to claim daily rewards for 7 days.",
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Purchase" }));
  await waitFor(() => expect(purchase).toHaveBeenCalledWith({ configId: "pass" }));
});

it("closes without purchasing when dismissed", async () => {
  const view = mount();
  const dialog = await openPurchase(view);
  const [close] = within(dialog)
    .getAllByRole("button", { name: "Close" })
    .filter((button) => button.textContent === "Close");
  fireEvent.click(close!);
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(purchase).not.toHaveBeenCalled();
});

it("disables the purchase trigger while a purchase is in flight", async () => {
  const pending = deferred<{ success: boolean; message: string }>();
  purchase.mockImplementation(() => pending.promise);
  const view = mount();
  const dialog = await openPurchase(view);
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Purchase" }));
  await waitFor(async () =>
    expect((await purchaseButton(view, "Purchasing...")).disabled).toBe(true),
  );
  pending.resolve({ success: false, message: "Not enough ryo" });
  await waitFor(async () => expect((await purchaseButton(view)).disabled).toBe(false));
});
