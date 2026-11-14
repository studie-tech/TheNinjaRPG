import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { UnclaimedSeasonRewards } from "@/layout/UnclaimedSeasonRewards";
import * as toast from "@/libs/toast";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";
import { mockUserContextValue } from "../setup/userContext";

let queryClient: QueryClient;
let claim: ReturnType<typeof vi.fn>;
let updateUser: ReturnType<typeof vi.fn>;

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  claim = vi.fn(() => ({ success: false, message: "Season rewards already claimed" }));
  updateUser = vi.fn().mockResolvedValue(undefined);
  Object.assign(vi.spyOn(client, "api" as never), {
    pvpRank: testApi.pvpRank,
    useUtils: testApi.useUtils,
  });
  mockUserContextValue(() => ({ prepareUserUpdate: () => 1, updateUser }) as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(toast, "showRewardToast").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

const mount = () => {
  const trpcClient = fakeTrpcClient(async (path) => {
    if (path === "pvpRank.getUnclaimedUserSeasonRewards")
      return [
        {
          id: "reward",
          seasonName: "Spring",
          division: "Gold",
          seasonRewards: {},
          claimed: false,
        },
      ];
    if (path === "pvpRank.claimSeasonRewards") return claim();
    throw new Error(`Unexpected procedure ${path}`);
  });
  return render(
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <UnclaimedSeasonRewards />
    </TrpcTestProviders>,
  );
};

it("reports a rejected claim and keeps the claim button usable", async () => {
  const view = mount();
  expect(await view.findByText("Unclaimed")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Claim" }));
  await waitFor(() =>
    expect(toast.showMutationToast).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Season rewards already claimed",
      }),
    ),
  );
  expect(toast.showRewardToast).not.toHaveBeenCalled();
  expect(updateUser).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(
      (view.getByRole("button", { name: "Claim" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
});
