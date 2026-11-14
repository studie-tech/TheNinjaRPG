import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { StaffPlayerViewSwitch } from "@/layout/StaffPlayerViewSwitch";
import * as toast from "@/libs/toast";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";
import { mockUserContextValue } from "../setup/userContext";

let queryClient: QueryClient;
let requests: { path: string; input: unknown }[];
let success: boolean;
let updateUser: ReturnType<typeof vi.fn>;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  requests = [];
  success = true;
  updateUser = vi.fn(async () => {});
  Object.assign(vi.spyOn(client, "api" as never), { profile: testApi.profile });
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => {});
  mockUserContextValue({ data: { playsAsPlayer: false }, updateUser } as never);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

const mount = () =>
  render(
    <TrpcTestProviders
      client={fakeTrpcClient(async (path, input) => {
        requests.push({ path, input });
        return { success, message: success ? "Updated preferences" : "Failed" };
      })}
      queryClient={queryClient}
    >
      <StaffPlayerViewSwitch />
    </TrpcTestProviders>,
  );

it("saves the choice, patches the profile and reloads every other query", async () => {
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const view = mount();
  await act(async () => {
    fireEvent.click(view.getByRole("switch", { name: "Play as a regular player" }));
  });
  await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ playsAsPlayer: true }));
  expect(requests).toEqual([
    { path: "profile.updatePreferences", input: { playsAsPlayer: true } },
  ]);
  await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
  const { predicate } = invalidate.mock.calls[0]![0] as unknown as {
    predicate: (query: { queryKey: unknown[] }) => boolean;
  };
  const refreshed = (path: string[]) =>
    predicate({ queryKey: [path, { type: "query" }] });
  for (const path of [
    ["quests", "getAll"],
    ["skillTree", "getAll"],
    ["bloodright", "get"],
    ["jutsu", "getAll"],
    ["item", "getAll"],
    ["sageMode", "getAll"],
    ["data", "getSkillStats"],
    ["profile", "getDashboard"],
  ]) {
    expect(refreshed(path)).toBe(true);
  }
  expect(refreshed(["profile", "getUser"])).toBe(false);
});

it("keeps the profile unchanged when saving fails", async () => {
  success = false;
  const view = mount();
  await act(async () => {
    fireEvent.click(view.getByRole("switch", { name: "Play as a regular player" }));
  });
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(updateUser).not.toHaveBeenCalled();
});
