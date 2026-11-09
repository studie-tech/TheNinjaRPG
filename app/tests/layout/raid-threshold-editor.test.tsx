import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { RaidThresholdEditor } from "@/layout/RaidThresholdEditor";
import * as rewardDialog from "@/layout/RewardDialog";
import * as toast from "@/libs/toast";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

let queryClient: QueryClient;
let create: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true, scrollIntoView: true });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  create = vi.fn(() => ({ success: false, message: "Threshold already exists" }));
  remove = vi.fn(() => ({ success: true, message: "Deleted" }));
  Object.assign(vi.spyOn(client, "api" as never), {
    raids: testApi.raids,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(rewardDialog, "useRewardDialogFormData").mockImplementation(
    () => ({}) as never,
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
    if (path === "raids.getQuestThresholds")
      return {
        thresholds: [
          {
            id: "tier",
            damageRequired: 5000,
            sortOrder: 0,
            effects: [],
            effectDurationMinutes: 60,
            rewards: {},
          },
        ],
      };
    if (path === "raids.createDamageThreshold") return create(input);
    if (path === "raids.deleteDamageThreshold") return remove(input);
    throw new Error(`Unexpected procedure ${path}`);
  });
  return render(
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <RaidThresholdEditor questId="raid" />
    </TrpcTestProviders>,
  );
};

it("deletes a threshold only after confirmation", async () => {
  const view = mount();
  await view.findByText("Tier 1: 5,000 damage");
  fireEvent.click(view.getByRole("button", { name: "Delete tier 1" }));
  const dialog = await view.findByRole("dialog", { name: "Delete Threshold" });
  expect(dialog.textContent).toContain(
    "Are you sure you want to delete this threshold?",
  );
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith({ thresholdId: "tier" }));
});

it("keeps the threshold editor open when the server rejects a save", async () => {
  const view = mount();
  await view.findByText("Tier 1: 5,000 damage");
  fireEvent.click(view.getByRole("button", { name: "Add Damage Threshold" }));
  const dialog = await view.findByRole("dialog", { name: "Add Damage Threshold" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ questId: "raid", damageRequired: 1000, sortOrder: 1 }),
    ),
  );
  await waitFor(() =>
    expect(toast.showMutationToast).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    ),
  );
  expect(view.getByRole("dialog", { name: "Add Damage Threshold" })).toBe(dialog);
  await waitFor(() =>
    expect(
      (within(dialog).getByRole("button", { name: "Save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
});
