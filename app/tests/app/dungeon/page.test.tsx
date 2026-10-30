import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import type { RouterOutputs } from "@/app/_trpc/client";
import DungeonPage from "@/app/[shell]/dungeon/page";
import * as ContentBox from "@/layout/ContentBox";
import * as Countdown from "@/layout/Countdown";
import * as Loader from "@/layout/Loader";
import * as UserContext from "@/utils/UserContext";
import type { UserDeltaResponse } from "@/validators/userCache";
import { ensureDom } from "../../setup/dom.mjs";
import { dungeonContent } from "../../setup/dungeon";

type PartyState = RouterOutputs["coop"]["dungeon"]["getState"];
type RunStatus = PartyState["runs"][number]["status"];
type Available = RouterOutputs["coop"]["dungeon"]["getAvailable"];
type ClaimCallbacks = { onSuccess: (response: UserDeltaResponse, input: { id: string }, revision: number | undefined) => Promise<void> };
const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((queryClient) => queryClient.clear());
  vi.restoreAllMocks();
});

/** Build a three-player run with readiness appropriate to its phase. */
const party = (status: RunStatus): PartyState["runs"][number] => ({
  id: "run", dungeonId: "definition", leaderId: "a", content: dungeonContent(),
  status, version: 1, battleId: null, createdAt: new Date(),
  expiresAt: new Date(Date.now() + 1800000),
  state: { memberIds: ["a", "b", "c"], invitedIds: [], readyIds: status === "BETWEEN" ? ["a", "b", "c"] : [], floor: 1, clearedFloors: [0], message: "" },
});
/** Build a state response with the party identities and server time displayed by the page. */
const partyState = (status: RunStatus | null): PartyState => ({
  runs: status ? [party(status)] : [],
  users: ["a", "b", "c"].map((userId) => ({ userId, username: userId, status: "AWAKE", isBanned: false })),
  members: [], serverTime: new Date(),
});

/** Exercise the page with real query lifecycles while keeping account and mutation I/O local. */
const mount = (status: RunStatus | null, availableFn: () => Promise<Available>, stateFn = async () => partyState(status), seed?: Available) => {
  ensureDom();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.push(queryClient);
  if (seed) queryClient.setQueryData(["available"], seed);
  const actCall = vi.fn();
  const createCall = vi.fn();
  const claimCall = vi.fn();
  const updateUser = vi.fn(async () => {});
  let claimCallbacks: ClaimCallbacks;
  const stateQuery = vi.fn(stateFn);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ profile: { getUser: { invalidate: vi.fn(async () => undefined) } } }),
    pets: { getCollection: { useQuery: () => ({ data: { pets: [] }, isPending: false }) } },
    coop: { dungeon: {
      getAvailable: { useQuery: (_input: unknown, options: object) => useQuery({ ...options, queryKey: ["available"], queryFn: availableFn }) },
      getState: { useQuery: (_input: unknown, options: object) => useQuery({ ...options, queryKey: ["state"], queryFn: stateQuery }) },
      create: { useMutation: () => ({ isPending: false, mutate: createCall }) },
      act: { useMutation: () => ({ isPending: false, mutate: actCall }) },
      claim: { useMutation: (options: ClaimCallbacks) => { claimCallbacks = options; return { isPending: false, mutate: claimCall }; } },
    } },
  });
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({ data: { userId: "a", sector: 1 }, timeDiff: 1234, updateUser, prepareUserUpdate: () => 42 } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }: { children: ReactNode }) => <div>{children}</div>);
  vi.spyOn(Loader, "default").mockImplementation(({ explanation }: { explanation?: string }) => <div>{explanation}</div>);
  const countdown = vi.spyOn(Countdown, "default").mockImplementation(() => <span>30 minutes</span>);
  const view = render(<QueryClientProvider client={queryClient}><DungeonPage /></QueryClientProvider>);
  return { view, queryClient, stateQuery, actCall, createCall, claimCall, countdown, updateUser,
    respondToClaim: (response: UserDeltaResponse) => claimCallbacks.onSuccess(response, { id: "run" }, 42) };
};

const scenarios = [
  { status: "LOBBY", label: "Ready", command: "ready" },
  { status: "BETWEEN", label: "Enter next floor", command: "start" },
  { status: "PAUSED", label: "Resume and ready up", command: "resume" },
] as const;

it("forwards confirmed achievement progress with the claim's captured profile revision", async () => {
  const { view, updateUser, respondToClaim } = mount("COMPLETED", async () => []);
  await waitFor(() => expect(view.getByRole("button", { name: "Claim completion rewards" })).toBeDefined());
  const response = { success: true, message: "Completion rewards delivered.", userPatch: { medicalExperience: 1 }, achievementProgress: [] };
  await act(async () => respondToClaim(response));
  expect(updateUser).toHaveBeenCalledWith(expect.any(Function), { revision: 42, achievementProgress: response.achievementProgress });
});

it("does not show an older ended run beside a newer completion", async () => {
  const data = partyState("COMPLETED");
  data.runs = [...data.runs, { ...party("ENDED"), id: "old", state: { ...party("ENDED").state, message: "Old abandonment" } }];
  const { view } = mount(null, async () => [], async () => data);
  await waitFor(() => expect(view.getByRole("button", { name: "Claim completion rewards" })).toBeDefined());
  expect(view.queryByText(/Old abandonment/)).toBeNull();
});

it("uses the shared account clock across dungeon response updates", async () => {
  const { view, queryClient, countdown } = mount("PAUSED", async () => []);
  await waitFor(() => expect(view.getByRole("button", { name: "Resume and ready up" })).toBeDefined());
  expect(countdown.mock.calls.at(-1)?.[0].timeDiff).toBe(1234);
  await act(async () => { queryClient.setQueryData(["state"], { ...partyState("PAUSED"), serverTime: new Date(Date.now() - 60000) }); });
  expect(countdown.mock.calls.at(-1)?.[0].timeDiff).toBe(1234);
});

for (const scenario of scenarios) {
  it(`keeps ${scenario.status} controls usable when entrance lookup fails`, async () => {
    const { view, queryClient, actCall } = mount(scenario.status, async () => { throw new Error("Entrance lookup failed"); });
    await waitFor(() => expect(queryClient.getQueryState(["available"])?.status).toBe("error"));
    await waitFor(() => expect(view.getByRole("button", { name: scenario.label })).toBeDefined());
    expect(view.queryByRole("alert")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: scenario.label }));
    expect(actCall).toHaveBeenCalledWith({ id: "run", action: scenario.command, userId: undefined });
  });

  it(`keeps ${scenario.status} controls usable while entrance lookup is pending`, async () => {
    let resolveEntrance!: (value: Available) => void;
    const { view, queryClient, actCall } = mount(scenario.status, () => new Promise((resolve) => { resolveEntrance = resolve; }));
    await waitFor(() => expect(view.getByRole("button", { name: scenario.label })).toBeDefined());
    expect(queryClient.getQueryState(["available"])?.status).toBe("pending");
    expect(view.queryByText("Loading dungeon parties")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: scenario.label }));
    expect(actCall).toHaveBeenCalledWith({ id: "run", action: scenario.command, userId: undefined });
    await act(async () => resolveEntrance([]));
    await waitFor(() => expect(queryClient.getQueryState(["available"])?.status).toBe("success"));
    expect(view.getByRole("button", { name: scenario.label })).toBeDefined();
  });
}

it("keeps the party usable after a failed entrance refresh with retained cached data", async () => {
  const cached: Available = [{ id: "definition", content: dungeonContent(), admission: { requirements: dungeonContent().requirements, error: null, attempts: [], completions: [] }, updatedAt: new Date() }];
  const { view, queryClient, actCall } = mount("PAUSED", async () => { throw new Error("Entrance refetch failed"); }, undefined, cached);
  await waitFor(() => expect(view.getByRole("button", { name: "Resume and ready up" })).toBeDefined());
  await act(async () => { await queryClient.refetchQueries({ queryKey: ["available"] }); });
  await waitFor(() => expect(queryClient.getQueryState(["available"])?.status).toBe("error"));
  expect(queryClient.getQueryData<Available>(["available"])).toEqual(cached);
  fireEvent.click(view.getByRole("button", { name: "Resume and ready up" }));
  expect(actCall).toHaveBeenCalledWith({ id: "run", action: "resume", userId: undefined });
});

it("recovers entrances locally while invitations and completion claims remain usable", async () => {
  let entranceFails = true;
  const data = partyState("COMPLETED");
  data.runs = [...data.runs, { ...party("LOBBY"), id: "invite", leaderId: "b", state: { ...party("LOBBY").state, memberIds: ["b"], invitedIds: ["a"] } }];
  const { view, stateQuery, actCall, claimCall, createCall } = mount(null, async () => {
    if (entranceFails) throw new Error("Entrance lookup failed");
    return [{ id: "definition", content: dungeonContent(), admission: { requirements: dungeonContent().requirements, error: null, attempts: [], completions: [] }, updatedAt: new Date() }];
  }, async () => data);
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Entrance lookup failed"));
  fireEvent.click(view.getByRole("button", { name: "Accept invitation" }));
  expect(actCall).toHaveBeenCalledWith({ id: "invite", action: "accept", userId: undefined });
  fireEvent.click(view.getByRole("button", { name: "Claim completion rewards" }));
  expect(claimCall).toHaveBeenCalledWith({ id: "run" });
  entranceFails = false;
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(view.getByRole("button", { name: "Create lobby" })).toBeDefined());
  expect(view.queryByRole("alert")).toBeNull();
  expect(stateQuery).toHaveBeenCalledTimes(1);
  fireEvent.click(view.getByRole("button", { name: "Create lobby" }));
  expect(createCall).toHaveBeenCalledWith({ id: "definition" });
});

it("shows entrance loading locally before the empty sector result", async () => {
  let resolveEntrance!: (value: Available) => void;
  const { view } = mount(null, () => new Promise((resolve) => { resolveEntrance = resolve; }));
  await waitFor(() => expect(view.getByText("Loading dungeon entrances")).toBeDefined());
  expect(view.getByRole("heading", { name: "Dungeons in your sector" })).toBeDefined();
  expect(view.queryByText("Loading dungeon parties")).toBeNull();
  expect(view.queryByText(/No dungeon entrances are available here/)).toBeNull();
  await act(async () => resolveEntrance([]));
  await waitFor(() => expect(view.getByText(/No dungeon entrances are available here/)).toBeDefined());
  expect(view.queryByText("Loading dungeon entrances")).toBeNull();
});

it("recovers a party lookup failure even while entrance lookup stays pending", async () => {
  let stateFails = true;
  const { view, stateQuery } = mount("LOBBY", () => new Promise(() => {}), async () => {
    if (stateFails) throw new Error("Party lookup failed");
    return partyState("LOBBY");
  });
  await waitFor(() => expect(view.getByRole("alert").textContent).toBe("Party lookup failed"));
  expect(view.queryByRole("button", { name: "Ready" })).toBeNull();
  stateFails = false;
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(view.getByRole("button", { name: "Ready" })).toBeDefined());
  expect(view.queryByRole("alert")).toBeNull();
  expect(stateQuery).toHaveBeenCalledTimes(2);
});
