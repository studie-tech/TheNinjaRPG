import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "bun:test";
import * as dynamic from "next/dynamic";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as preferences from "@/hooks/combat";
import * as tutorial from "@/hooks/tutorial";
import type { BattleState } from "@/libs/combat/types";
import * as userContext from "@/utils/UserContext";
import { ensureDom } from "../../setup/dom.mjs";
import { makeCompleteBattle, makeUser } from "../../libs/combat/helpers/battleScenario";
import { dungeonBattleState } from "../../setup/dungeon";

// Keep the real page and query lifecycles, substituting only its WebGL scene.
const loadingEvents: string[] = [];
const scene = vi.spyOn(dynamic, "default").mockReturnValue(
  (({ battleState }: { battleState: BattleState }) => {
    loadingEvents.push(`scene:${battleState.battle?.id}`);
    return <p>{battleState.result ? "Finished battle result" : `Active battle ${battleState.battle?.id}`}</p>;
  }) as never,
);
const { default: CombatPage } = await import("@/app/[shell]/combat/page");
scene.mockRestore();

type Response = RouterOutputs["combat"]["getBattle"];
const empty: Response = { battle: null, result: null };
const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((queryClient) => queryClient.clear());
  loadingEvents.length = 0;
  vi.restoreAllMocks();
});

const mount = (battleId: string | null, read: (id: string) => Promise<Response>) => {
  ensureDom();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.push(queryClient);
  let profile = { userId: "player", status: battleId ? "BATTLE" : "AWAKE", battleId, userQuests: [] };
  const refetchProfile = vi.fn(async () => undefined);
  const push = vi.fn();
  const prefetchAssets = vi.fn(async ({ ids }: { ids: string[] }) => {
    loadingEvents.push(`assets:${ids.join(",")}`);
  });
  const utils = {
    profile: { getUser: { invalidate: refetchProfile } },
    combat: { getBattle: { invalidate: vi.fn() } },
    misc: { getAllGameAssetNames: { prefetch: prefetchAssets } },
  };
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push } as never);
  vi.spyOn(userContext, "useRequiredUserData").mockImplementation(() => ({ data: profile }) as never);
  vi.spyOn(preferences, "useCombatPreferences").mockReturnValue({
    useTabs: false, layoutOrder: ["battlefield"], showTimeline: false, showBattleLog: false,
  } as never);
  vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({ handleNextStep: vi.fn() } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => utils,
    combat: {
      getBattle: { useQuery: (input: { battleId?: string | null }, options: object) => useQuery({
        ...options, queryKey: ["combat", input.battleId], queryFn: () => read(input.battleId!),
      }) },
      toggleAutoCombat: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  });
  const tree = () => <QueryClientProvider client={queryClient}><CombatPage /></QueryClientProvider>;
  const view = render(tree());
  return { view, refetchProfile, push, queryClient, prefetchAssets, changeBattle: (id: string | null) => {
    profile = { ...profile, battleId: id, status: id ? "BATTLE" : "AWAKE" };
    view.rerender(tree());
  } };
};

it("starts asset loading before mounting each new battle scene, preserving the query input order", async () => {
  const resolvers = new Map<string, (value: Response) => void>();
  const { view, changeBattle, prefetchAssets } = mount("a", (id) => new Promise((resolve) => {
    resolvers.set(id, resolve);
  }));
  expect(prefetchAssets).not.toHaveBeenCalled();

  for (const id of ["a", "b"]) {
    if (id === "b") changeBattle(id);
    const battle = makeCompleteBattle({
      id,
      usersState: [makeUser({ userId: "player" })],
    });
    const response = {
      battle: {
        ...battle,
        extraState: { ...battle.extraState, textureAssets: [`texture-${id}`, "shared"], sfxAssets: ["shared", `sfx-${id}`] },
      },
      result: null,
    } as unknown as Response;
    await act(async () => resolvers.get(id)!(response));
    await waitFor(() => expect(view.getByText(`Active battle ${id}`)).toBeDefined());
    expect(prefetchAssets).toHaveBeenLastCalledWith({
      ids: [`texture-${id}`, "shared", "shared", `sfx-${id}`],
    });
    const request = loadingEvents.indexOf(`assets:texture-${id},shared,shared,sfx-${id}`);
    expect(request).toBeGreaterThanOrEqual(0);
    expect(request).toBeLessThan(loadingEvents.indexOf(`scene:${id}`));
  }
});

it("recovers a settled battle missing behind a cached character ID", async () => {
  const { view, refetchProfile, push } = mount("settled", async () => empty);
  await waitFor(() => expect(view.getByText("You are not in an active battle.")).toBeDefined());
  expect(refetchProfile).toHaveBeenCalledTimes(1);
  expect(view.getByRole("link", { name: "Return to Profile" }).getAttribute("href")).toBe("/profile");
  expect(push).not.toHaveBeenCalled();
});

it("offers a return path when the character has no battle, without querying", () => {
  const read = vi.fn(async () => empty);
  const { view, refetchProfile } = mount(null, read);
  expect(view.getByRole("link", { name: "Return to Profile" })).toBeDefined();
  expect(read).not.toHaveBeenCalled();
  expect(refetchProfile).not.toHaveBeenCalled();
});

it("waits for a real response before declaring an active battle missing", async () => {
  let resolve!: (value: Response) => void;
  const { view, refetchProfile } = mount("pending", () => new Promise((r) => { resolve = r; }));
  expect(view.getByText("Loading Battle Data")).toBeDefined();
  expect(view.queryByRole("link", { name: "Return to Profile" })).toBeNull();
  expect(refetchProfile).not.toHaveBeenCalled();
  await act(async () => resolve(empty));
  await waitFor(() => expect(view.getByRole("link", { name: "Return to Profile" })).toBeDefined());
});

it("retries a failed lookup without treating the failure as a settled battle", async () => {
  let fails = true;
  const read = vi.fn(async () => { if (fails) throw new Error("Offline"); return empty; });
  const { view, refetchProfile } = mount("retry", read);
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Unable to load"));
  expect(refetchProfile).not.toHaveBeenCalled();
  expect(view.queryByText("You are not in an active battle.")).toBeNull();
  fails = false;
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(view.getByRole("link", { name: "Return to Profile" })).toBeDefined());
  expect(read).toHaveBeenCalledTimes(2);
});

it("does not let a late missing response for A replace a pending battle B", async () => {
  const resolvers = new Map<string, (value: Response) => void>();
  const { view, changeBattle, refetchProfile } = mount("a", (id) => new Promise((r) => { resolvers.set(id, r); }));
  changeBattle("b");
  await act(async () => resolvers.get("a")!(empty));
  expect(view.getByText("Loading Battle Data")).toBeDefined();
  expect(view.queryByText("You are not in an active battle.")).toBeNull();
  expect(refetchProfile).not.toHaveBeenCalled();
  await act(async () => resolvers.get("b")!(empty));
  await waitFor(() => expect(refetchProfile).toHaveBeenCalledTimes(1));
});

it("keeps an already displayed result when a later lookup or profile loses its battle", async () => {
  const battle = makeCompleteBattle({ id: "finished", usersState: [makeUser({ userId: "player" })] });
  const finished = { battle, result: { outcome: "Won" } } as unknown as Response;
  const { view, queryClient, changeBattle, refetchProfile } = mount("finished", async () => finished);
  await waitFor(() => expect(view.getByText("Finished battle result")).toBeDefined());
  await act(async () => queryClient.setQueryData(["combat", "finished"], empty));
  await waitFor(() => expect(refetchProfile).toHaveBeenCalledTimes(1));
  changeBattle(null);
  expect(view.getByText("Finished battle result")).toBeDefined();
  expect(view.queryByRole("link", { name: "Return to Profile" })).toBeNull();
});

it("preserves dungeon recovery when a different member settles its battle", async () => {
  const battle = makeCompleteBattle({
    id: "dungeon-battle", usersState: [makeUser({ userId: "player" })],
    extraState: { dungeon: dungeonBattleState() },
  });
  const active = { battle, result: null } as unknown as Response;
  const { view, queryClient, push, refetchProfile } = mount("dungeon-battle", async () => active);
  await waitFor(() => expect(view.getByText("Active battle dungeon-battle")).toBeDefined());
  expect(refetchProfile).not.toHaveBeenCalled();
  await act(async () => queryClient.setQueryData(["combat", "dungeon-battle"], empty));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dungeon"));
  expect(refetchProfile).toHaveBeenCalledTimes(1);
  expect(view.queryByText("Active battle dungeon-battle")).toBeNull();
});

it("does not route a missing newer battle through a retained dungeon battle", async () => {
  const battle = makeCompleteBattle({
    id: "dungeon-a", usersState: [makeUser({ userId: "player" })],
    extraState: { dungeon: dungeonBattleState() },
  });
  const { view, changeBattle, push, refetchProfile } = mount("dungeon-a", async (id) => (
    id === "dungeon-a" ? { battle, result: null } as unknown as Response : empty
  ));
  await waitFor(() => expect(view.getByText("Active battle dungeon-a")).toBeDefined());
  changeBattle("ordinary-b");
  await waitFor(() => expect(view.getByRole("link", { name: "Return to Profile" })).toBeDefined());
  expect(refetchProfile).toHaveBeenCalledTimes(1);
  expect(push).not.toHaveBeenCalled();
});
