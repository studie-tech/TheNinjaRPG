import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import type { ComponentProps } from "react";
import * as client from "@/app/_trpc/client";
import { ClanOrders } from "@/layout/clan/ClanOrders";
import * as groupOrders from "@/layout/GroupOrders";
import * as toast from "@/libs/toast";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";
import { mockUserContextValue } from "../setup/userContext";

let queryClient: QueryClient;
let fallback: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fallback = vi.fn();
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false, onError: fallback },
    },
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    clan: testApi.clan,
    useUtils: testApi.useUtils,
  });
  mockUserContextValue(
    () => ({ data: { userId: "leader", isOutlaw: false } }) as never,
  );
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(groupOrders, "GroupOrders").mockImplementation((({
    onSubmit,
  }: ComponentProps<typeof groupOrders.GroupOrders>) => (
    <button
      type="button"
      onClick={() =>
        void onSubmit({ content: "Gather at dawn" } as never).catch(() => undefined)
      }
    >
      Post orders
    </button>
  )) as never);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

it("leaves a failed clan mutation to the shared error handler", async () => {
  const failure = new TRPCClientError("Clan service unavailable");
  const trpcClient = fakeTrpcClient(async (path) => {
    if (path === "clan.upsertNotice") throw failure;
    throw new Error(`Unexpected procedure ${path}`);
  });
  const view = render(
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <ClanOrders clanId="clan" order={null} canPost />
    </TrpcTestProviders>,
  );
  fireEvent.click(view.getByRole("button", { name: "Post orders" }));
  await waitFor(() => expect(fallback).toHaveBeenCalledTimes(1));
  expect(fallback.mock.calls[0]?.[0]).toBeInstanceOf(TRPCClientError);
  expect(toast.showMutationToast).not.toHaveBeenCalled();
});
