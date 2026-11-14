import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import * as dynamic from "next/dynamic";
import * as navigation from "next/navigation";
import { type ReactNode, Suspense } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import * as preferences from "@/hooks/combat";
import * as tutorial from "@/hooks/tutorial";
import * as battleHotkeys from "@/hooks/useBattleHotkeys";
import * as gameMenu from "@/hooks/useGameMenu";
import * as mediaQuery from "@/hooks/useMediaQuery";
import * as avatar from "@/layout/Avatar";
import MenuBoxProfile from "@/layout/MenuBoxProfile";
import * as statusBar from "@/layout/StatusBar";
import * as combatSettings from "@/layout/UserCombatSettings";
import { resolveHotkeys } from "@/libs/combat/hotkeys";
import type { BattleState } from "@/libs/combat/types";
import * as toast from "@/libs/toast";
import * as userContext from "@/utils/UserContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { makeCompleteBattle, makeEffect, makeUser } from "../../setup/combat";
import { dungeonBattleState } from "../../setup/dungeon";
import { mockUserContextValue } from "../../setup/userContext";

// Keep the real page and query lifecycles, substituting only its WebGL scene.
const loadingEvents: string[] = [];
let sceneCatalogLoader: (() => Promise<unknown>) | undefined;
let heldSceneCatalog: unknown;
const actualDynamic = dynamic.default;
const CombatScene = (({
  battleState,
  arenaActions,
  loadLpcCatalog,
  config,
}: {
  battleState: BattleState;
  arenaActions?: ReactNode;
  loadLpcCatalog: () => Promise<unknown>;
  config?: { showAggro?: boolean; resourceBarsVisibility?: string };
}) => {
  loadingEvents.push(`scene:${battleState.battle?.id}`);
  sceneCatalogLoader = loadLpcCatalog;
  return (
    <>
      <p>
        {battleState.result
          ? "Finished battle result"
          : `Active battle ${battleState.battle?.id}`}
      </p>
      <p>{`Scene aggro ${config?.showAggro} bars ${config?.resourceBarsVisibility}`}</p>
      {arenaActions}
    </>
  );
}) as never;
const scene = vi.spyOn(dynamic, "default").mockImplementation((loader, options) => {
  if (typeof loader === "function" && loader.name === "loadCombat") {
    return CombatScene;
  }
  return actualDynamic(loader, options);
});
const { default: CombatPage } = await import("@/app/[shell]/combat/page");
const { default: BattleLog } = await import("@/app/[shell]/battlelog/[battleid]/page");
scene.mockRestore();

type Response = RouterOutputs["combat"]["getBattle"];
const empty: Response = { battle: null, result: null };
const clients: QueryClient[] = [];

beforeEach(() => {
  installBrowserGlobals();
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  getDefaultStore().set(userContext.combatActionIdAtom, undefined);
  getDefaultStore().set(userContext.userBattleAtom, undefined);
  clients.splice(0).forEach((queryClient) => queryClient.clear());
  loadingEvents.length = 0;
  sceneCatalogLoader = undefined;
  heldSceneCatalog = undefined;
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const mount = (
  battleId: string | null,
  read: (id: string) => Promise<Response>,
  config: Partial<ReturnType<typeof preferences.useCombatPreferences>> = {},
  spectate = false,
  arena: {
    heal?: () => Promise<{ success: boolean; message: string }>;
    start?: () => Promise<{ success: boolean; message: string; battleId?: string }>;
  } = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(queryClient);
  let profile = {
    userId: "player",
    status: battleId ? "BATTLE" : "AWAKE",
    battleId,
    userQuests: [],
    money: 2000,
    curHealth: 50,
    curStamina: 50,
    curChakra: 50,
    maxHealth: 100,
    maxStamina: 100,
    maxChakra: 100,
  };
  const refetchProfile = vi.fn(async () => undefined);
  const push = vi.fn();
  const toggleAutoCombat = vi.fn();
  const heal = vi.fn(
    arena.heal ?? (async () => ({ success: false, message: "Unused heal" })),
  );
  const start = vi.fn(
    arena.start ??
      (async () => ({ success: false, message: "Daily arena limit reached" })),
  );
  const mutationToast = vi
    .spyOn(toast, "showMutationToast")
    .mockImplementation(() => undefined);
  const prefetchAssets = vi.fn(async ({ ids }: { ids: string[] }) => {
    loadingEvents.push(`assets:${ids.join(",")}`);
  });
  const sceneCatalog = { designs: {}, layouts: {} };
  const fetchSceneCatalog = vi.fn(async () => {
    loadingEvents.push("catalog");
    return sceneCatalog;
  });
  const utils = {
    gameAsset: {
      getLpcSceneCatalog: { fetch: fetchSceneCatalog, getData: () => heldSceneCatalog },
    },
    profile: { getUser: { invalidate: refetchProfile } },
    combat: {
      getBattle: {
        invalidate: vi.fn((input?: { battleId?: string }) =>
          queryClient.invalidateQueries({
            queryKey: input?.battleId ? ["combat", input.battleId] : ["combat"],
          }),
        ),
      },
    },
    misc: { getAllGameAssetNames: { prefetch: prefetchAssets } },
  };
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push } as never);
  mockUserContextValue(
    () =>
      ({
        data: profile,
        timeDiff: 0,
        prepareUserUpdate: () => 0,
        updateUser: async () => true,
      }) as never,
  );
  let combatConfig = {
    useTabs: false,
    layoutOrder: ["battlefield"],
    showTimeline: false,
    showBattleLog: false,
    ...config,
  };
  vi.spyOn(preferences, "useAutoCombatSetting").mockReturnValue([false, vi.fn()]);
  vi.spyOn(preferences, "useCombatPreferences").mockImplementation(
    () => combatConfig as never,
  );
  vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({
    handleNextStep: vi.fn(),
  } as never);
  vi.spyOn(battleHotkeys, "useBattleHotkeys").mockReturnValue({
    ...resolveHotkeys(null, null),
    hasJutsuLoadout: false,
    hasItemLoadout: false,
    setHotkey: vi.fn(),
    isSaving: false,
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => utils,
    combat: {
      getBattleEntries: { useQuery: () => ({ data: [], isFetching: false }) },
      getBattleHistoryEntry: { useQuery: () => ({ data: undefined }) },
      getBattle: {
        useQuery: (input: { battleId?: string | null }, options: object) =>
          useQuery({
            ...options,
            queryKey: ["combat", input.battleId],
            queryFn: () => read(input.battleId!),
          }),
      },
      battleArenaHeal: {
        useMutation: (options: object) => useMutation({ ...options, mutationFn: heal }),
      },
      startArenaBattle: {
        useMutation: (options: object) =>
          useMutation({ ...options, mutationFn: start }),
      },
      toggleAutoCombat: {
        useMutation: () => ({ mutate: toggleAutoCombat, isPending: false }),
      },
    },
  });
  const params = Promise.resolve({ battleid: battleId! });
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        {spectate ? <BattleLog params={params} /> : <CombatPage />}
      </Suspense>
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    view,
    heal,
    start,
    mutationToast,
    changeProfile: (values: Partial<typeof profile>) => {
      profile = { ...profile, ...values };
      view.rerender(tree());
    },
    refetchProfile,
    push,
    toggleAutoCombat,
    queryClient,
    prefetchAssets,
    fetchSceneCatalog,
    sceneCatalog,
    changeLayout: (next: Partial<typeof combatConfig>) => {
      combatConfig = { ...combatConfig, ...next };
      view.rerender(tree());
    },
    changeBattle: (id: string | null) => {
      profile = { ...profile, battleId: id, status: id ? "BATTLE" : "AWAKE" };
      view.rerender(tree());
    },
  };
};

it("retains the shared battle across focus and viewport layout changes and clears it on page exit", async () => {
  const viewport = vi.spyOn(mediaQuery, "useMediaQuery").mockReturnValue(true);
  vi.spyOn(combatSettings, "UserCombatSettings").mockReturnValue(null as never);
  const battle = makeCompleteBattle({
    id: "layout-switch",
    usersState: [makeUser({ userId: "player" })],
  });
  const read = vi.fn(async () => ({ battle, result: null }) as unknown as Response);
  const { view, changeLayout } = mount(battle.id, read, { battleFocus: true });
  const desktopScene = await view.findByText(`Active battle ${battle.id}`);
  const store = getDefaultStore();
  const shared = store.get(userContext.userBattleAtom);
  expect(shared?.id).toBe(battle.id);
  viewport.mockReturnValue(false);
  changeLayout({});
  const mobileScene = view.getByText(`Active battle ${battle.id}`);
  expect(mobileScene).not.toBe(desktopScene);
  expect(store.get(userContext.userBattleAtom)).toBe(shared);
  changeLayout({ battleFocus: false });
  expect(view.getByText(`Active battle ${battle.id}`)).not.toBe(mobileScene);
  expect(store.get(userContext.userBattleAtom)).toBe(shared);
  expect(read).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(store.get(userContext.userBattleAtom)).toBeUndefined();
});

it.each([false, true])(
  "returns keyboard focus to the shown battle layout with results=%s",
  async (finished) => {
    vi.spyOn(mediaQuery, "useMediaQuery").mockReturnValue(true);
    vi.spyOn(combatSettings, "UserCombatSettings").mockReturnValue(null as never);
    const battle = makeCompleteBattle({
      id: "focus-return",
      usersState: [makeUser({ userId: "player" })],
    });
    const setBattleFocus = (battleFocus: boolean) => changeLayout({ battleFocus });
    const { view, changeLayout } = mount(
      battle.id,
      async () =>
        ({
          battle,
          result: finished ? { outcome: "Won" } : null,
        }) as unknown as Response,
      { battleFocus: true, setBattleFocus, layoutOrder: ["timer", "battlefield"] },
    );
    const exit = await view.findByRole("button", { name: "Show layout" });
    expect(exit.closest("#tutorial-combat-action-timer")).toBeTruthy();
    expect(exit.closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(exit);
    fireEvent.click(exit);
    await waitFor(() =>
      expect(view.queryByRole("button", { name: "Show layout" })).toBeNull(),
    );
    const button = view.queryByRole("button", { name: "Battle focus" });
    expect(
      document.activeElement === (finished ? view.container.firstElementChild : button),
    ).toBe(true);
    expect(document.activeElement?.closest("[inert]")).toBeNull();
  },
);

it.each(["settled", "healing", "starting"] as const)(
  "retains arena heal protection across viewport and focus remounts while %s",
  async (phase) => {
    const viewport = vi.spyOn(mediaQuery, "useMediaQuery").mockReturnValue(true);
    vi.spyOn(combatSettings, "UserCombatSettings").mockReturnValue(null as never);
    const battle = makeCompleteBattle({
      id: `heal-${phase}`,
      battleType: "ARENA",
      usersState: [
        makeUser({ userId: "player" }),
        makeUser({ userId: "opponent", isAi: true, controllerId: "arena-opponent" }),
      ],
    });
    let finishHeal!: () => void;
    let finishStart!: () => void;
    const { view, heal, start, mutationToast, changeLayout, changeProfile } = mount(
      battle.id,
      async () =>
        ({
          battle,
          result: { outcome: "Won", curHealth: 50, curStamina: 50, curChakra: 50 },
        }) as unknown as Response,
      { battleFocus: true },
      false,
      {
        heal: async () => {
          if (phase === "healing")
            await new Promise<void>((resolve) => {
              finishHeal = resolve;
            });
          changeProfile({
            money: 1500,
            curHealth: 100,
            curStamina: 100,
            curChakra: 100,
          });
          return { success: true, message: "Healed" };
        },
        start: async () => {
          if (phase === "starting")
            await new Promise<void>((resolve) => {
              finishStart = resolve;
            });
          return { success: false, message: "Daily arena limit reached" };
        },
      },
    );
    await view.findByText("Finished battle result");
    changeProfile({ status: "AWAKE", battleId: null });
    fireEvent.click(view.getByRole("button", { name: "Heal and Go Again (-500 Ryo)" }));
    if (phase === "healing") await waitFor(() => expect(heal).toHaveBeenCalledTimes(1));
    else await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    if (phase === "settled")
      await view.findByRole("button", { name: "Healed — use Go Again" });
    const desktopResult = view.getByText("Finished battle result");
    viewport.mockReturnValue(false);
    changeLayout({});
    expect(view.getByText("Finished battle result")).not.toBe(desktopResult);
    const mobileResult = view.getByText("Finished battle result");
    changeLayout({ battleFocus: false });
    expect(view.getByText("Finished battle result")).not.toBe(mobileResult);
    const healButton = view.container.querySelector<HTMLButtonElement>("#heal-return")!;
    expect(healButton.disabled).toBe(true);
    fireEvent.click(healButton);
    if (phase !== "settled") {
      const repeatButton = view.container.querySelector<HTMLButtonElement>("#return")!;
      expect(repeatButton.disabled).toBe(true);
      fireEvent.click(repeatButton);
      await act(async () => (phase === "healing" ? finishHeal() : finishStart()));
    }
    await waitFor(() =>
      expect(mutationToast).toHaveBeenCalledWith({
        success: false,
        message: "Daily arena limit reached",
      }),
    );
    expect(heal).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(
      view
        .getByRole("button", { name: "Healed — use Go Again" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Go Again" }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect(heal).toHaveBeenCalledTimes(1);
  },
);

it("clears shared combat handler snapshots on spectator exit without publishing the viewed battle", async () => {
  const battle = makeCompleteBattle({
    id: "spectated",
    usersState: [makeUser({ userId: "player" })],
  });
  let mounted!: ReturnType<typeof mount>;
  await act(async () => {
    mounted = mount(
      battle.id,
      async () => ({ battle, result: null }) as unknown as Response,
      {},
      true,
    );
  });
  const { view } = mounted;
  await view.findByText(`Active battle ${battle.id}`);
  const store = getDefaultStore();
  expect(store.get(userContext.userBattleAtom)).toBeUndefined();
  act(() =>
    store.set(
      userContext.userBattleAtom,
      battle as unknown as NonNullable<Response["battle"]>,
    ),
  );
  view.unmount();
  expect(store.get(userContext.userBattleAtom)).toBeUndefined();
});

it("passes aggro and resource bar toggles to the spectated battle scene", async () => {
  const battle = makeCompleteBattle({
    id: "spectated",
    usersState: [makeUser({ userId: "player" })],
  });
  let mounted!: ReturnType<typeof mount>;
  await act(async () => {
    mounted = mount(
      battle.id,
      async () => ({ battle, result: null }) as unknown as Response,
      { showAggro: false, resourceBarsVisibility: "on" },
      true,
    );
  });
  const { view, changeLayout } = mounted;
  await view.findByText("Scene aggro false bars on");
  act(() => changeLayout({ showAggro: true }));
  await view.findByText("Scene aggro true bars on");
  act(() => changeLayout({ resourceBarsVisibility: "off" }));
  await view.findByText("Scene aggro true bars off");
});

it("starts asset loading before mounting each new battle scene, preserving the query input order", async () => {
  const resolvers = new Map<string, (value: Response) => void>();
  const { view, changeBattle, prefetchAssets } = mount(
    "a",
    (id) =>
      new Promise((resolve) => {
        resolvers.set(id, resolve);
      }),
  );
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
        extraState: {
          ...battle.extraState,
          textureAssets: [`texture-${id}`, "shared"],
          sfxAssets: ["shared", `sfx-${id}`],
        },
      },
      result: null,
    } as unknown as Response;
    await act(async () => resolvers.get(id)!(response));
    await waitFor(() => expect(view.getByText(`Active battle ${id}`)).toBeDefined());
    expect(prefetchAssets).toHaveBeenLastCalledWith({
      ids: [`texture-${id}`, "shared", "shared", `sfx-${id}`],
    });
    const request = loadingEvents.indexOf(
      `assets:texture-${id},shared,shared,sfx-${id}`,
    );
    expect(request).toBeGreaterThanOrEqual(0);
    expect(request).toBeLessThan(loadingEvents.indexOf(`scene:${id}`));
  }
});

it("requests the battlefield's artwork catalog alongside the battle and hands it to the scene", async () => {
  let respond!: (value: Response) => void;
  const { view, fetchSceneCatalog, sceneCatalog } = mount(
    "catalog",
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  // The catalog is in flight while the battle query is still pending.
  await waitFor(() => expect(fetchSceneCatalog).toHaveBeenCalledTimes(1));
  const battle = makeCompleteBattle({
    id: "catalog",
    usersState: [makeUser({ userId: "player" })],
  });
  await act(async () => respond({ battle, result: null } as unknown as Response));
  await waitFor(() => expect(view.getByText("Active battle catalog")).toBeDefined());
  expect(loadingEvents.indexOf("catalog")).toBeLessThan(
    loadingEvents.indexOf("scene:catalog"),
  );
  // The first scene consumes that request instead of starting another one.
  expect(await sceneCatalogLoader!()).toBe(sceneCatalog);
  expect(fetchSceneCatalog).toHaveBeenCalledTimes(1);
});

it("draws with the catalog the travel map already holds while refreshing it", async () => {
  const held = { designs: { held: {} }, layouts: {} };
  heldSceneCatalog = held;
  const battle = makeCompleteBattle({
    id: "held-catalog",
    usersState: [makeUser({ userId: "player" })],
  });
  const { view, fetchSceneCatalog } = mount(
    battle.id,
    async () =>
      ({
        battle,
        result: null,
      }) as unknown as Response,
  );
  await waitFor(() =>
    expect(view.getByText("Active battle held-catalog")).toBeDefined(),
  );
  expect(await sceneCatalogLoader!()).toBe(held);
  // The refreshed copy is for later scenes; this one does not wait for it.
  expect(fetchSceneCatalog).toHaveBeenCalledTimes(1);
});

it("recovers a settled battle missing behind a cached character ID", async () => {
  const { view, refetchProfile, push } = mount("settled", async () => empty);
  await waitFor(() =>
    expect(view.getByText("You are not in an active battle.")).toBeDefined(),
  );
  expect(refetchProfile).toHaveBeenCalledTimes(1);
  expect(
    view.getByRole("link", { name: "Return to Profile" }).getAttribute("href"),
  ).toBe("/profile");
  expect(push).not.toHaveBeenCalled();
});

it.each(["query", "profile"])(
  "releases battle pools when the %s confirms combat ended while the page stays mounted",
  async (source) => {
    const battle = makeCompleteBattle({
      id: "externally-settled",
      usersState: [
        makeUser({
          userId: "player",
          curHealth: 23,
          maxHealth: 100,
          curChakra: 31,
          maxChakra: 100,
          curStamina: 42,
          maxStamina: 100,
        }),
      ],
    });
    let ended = false;
    const { view, queryClient, changeProfile } = mount(battle.id, async () =>
      ended ? empty : ({ battle, result: null } as unknown as Response),
    );
    await view.findByText(`Active battle ${battle.id}`);
    const store = getDefaultStore();
    expect(store.get(userContext.userBattleAtom)?.id).toBe(battle.id);
    if (source === "query") {
      await act(async () => queryClient.setQueryData(["combat", battle.id], empty));
      await view.findByText("You are not in an active battle.");
      expect(store.get(userContext.userBattleAtom)).toBeUndefined();
    }
    ended = true;
    changeProfile({
      status: "AWAKE",
      battleId: null,
      curHealth: 90,
      curChakra: 91,
      curStamina: 92,
    });
    if (source === "profile")
      await act(async () => queryClient.setQueryData(["combat", battle.id], empty));
    await view.findByText("You are not in an active battle.");
    expect(store.get(userContext.userBattleAtom)).toBeUndefined();
    vi.spyOn(userContext, "useUserDataSelector").mockImplementation(
      (select) =>
        ({
          timeDiff: 0,
          data: select({
            ...userContext.useRequiredUserData().data,
            level: 10,
            experience: 0,
            rank: "GENIN",
            regeneration: 7,
            raidBuffs: [],
            titles: [],
          } as never),
        }) as never,
    );
    vi.spyOn(avatar, "default").mockReturnValue(null as never);
    vi.spyOn(gameMenu, "useGameMenu").mockReturnValue({} as never);
    vi.spyOn(statusBar, "default").mockImplementation(({ title, current, regen }) => (
      <p>
        {title}: {current}; regen: {regen}
      </p>
    ));
    Object.assign(client.api, {
      profile: { getSidebarTimers: { useQuery: () => ({ data: undefined }) } },
      raids: { getUserRaidBuffs: { useQuery: () => ({ data: undefined }) } },
    });
    const sidebar = render(<MenuBoxProfile />);
    expect(sidebar.getByText("HP: 90; regen: 7")).toBeDefined();
    expect(sidebar.getByText("CP: 91; regen: 7")).toBeDefined();
    expect(sidebar.getByText("SP: 92; regen: 7")).toBeDefined();
  },
);

it.each(["AWAKE", "HOSPITALIZED"])(
  "applies another tab's arena result after the profile becomes %s without another lookup",
  async (status) => {
    const battle = makeCompleteBattle({
      id: "other-tab-finished",
      battleType: "ARENA",
      usersState: [makeUser({ userId: "player", isAutoCombat: true })],
    });
    const read = vi.fn(async () => ({ battle, result: null }) as unknown as Response);
    const { view, queryClient, changeProfile, push } = mount(battle.id, read);
    await view.findByText(`Active battle ${battle.id}`);
    changeProfile({ status, battleId: null });
    expect(read).toHaveBeenCalledTimes(1);
    expect(view.queryByText("You are not in an active battle.")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    await act(async () =>
      queryClient.setQueryData(["combat", battle.id], {
        battle,
        result: { outcome: status === "AWAKE" ? "Won" : "Lost" },
      } as unknown as Response),
    );
    await view.findByText("Finished battle result");
    expect(view.queryByText("You are not in an active battle.")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  },
);

it("keeps the requested battle while a profile refresh overtakes its initial response", async () => {
  const battle = makeCompleteBattle({
    id: "initial-result-race",
    battleType: "ARENA",
    usersState: [makeUser({ userId: "player" })],
  });
  let finish!: (response: Response) => void;
  const read = vi.fn(
    (_id: string) =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const { view, changeProfile } = mount(battle.id, read);
  changeProfile({ status: "AWAKE", battleId: null });
  expect(view.queryByText("You are not in an active battle.")).toBeNull();
  await act(async () =>
    finish({ battle, result: { outcome: "Won" } } as unknown as Response),
  );
  await view.findByText("Finished battle result");
  expect(read.mock.calls.every(([id]) => id === battle.id)).toBe(true);
});

it("preserves a newer shared battle snapshot when the rendered battle disappears", async () => {
  const battle = makeCompleteBattle({
    id: "older",
    usersState: [makeUser({ userId: "player" })],
  });
  const newer = { ...battle, id: "newer" } as unknown as NonNullable<
    Response["battle"]
  >;
  const { view, queryClient } = mount(
    battle.id,
    async () => ({ battle, result: null }) as unknown as Response,
  );
  await view.findByText(`Active battle ${battle.id}`);
  const store = getDefaultStore();
  act(() => store.set(userContext.userBattleAtom, newer));
  await act(async () => queryClient.setQueryData(["combat", battle.id], empty));
  await view.findByText("You are not in an active battle.");
  expect(store.get(userContext.userBattleAtom)).toBe(newer);
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
  const { view, refetchProfile } = mount(
    "pending",
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  expect(view.getByText("Loading Battle Data")).toBeDefined();
  expect(view.queryByRole("link", { name: "Return to Profile" })).toBeNull();
  expect(refetchProfile).not.toHaveBeenCalled();
  await act(async () => resolve(empty));
  await waitFor(() =>
    expect(view.getByRole("link", { name: "Return to Profile" })).toBeDefined(),
  );
});

it("retries a failed lookup without treating the failure as a settled battle", async () => {
  let fails = true;
  const read = vi.fn(async () => {
    if (fails) throw new Error("Offline");
    return empty;
  });
  const { view, refetchProfile } = mount("retry", read);
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain("Unable to load"),
  );
  expect(refetchProfile).not.toHaveBeenCalled();
  expect(view.queryByText("You are not in an active battle.")).toBeNull();
  fails = false;
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(view.getByRole("link", { name: "Return to Profile" })).toBeDefined(),
  );
  expect(read).toHaveBeenCalledTimes(2);
});

it("does not let a late missing response for A replace a pending battle B", async () => {
  const resolvers = new Map<string, (value: Response) => void>();
  const { view, changeBattle, refetchProfile } = mount(
    "a",
    (id) =>
      new Promise((r) => {
        resolvers.set(id, r);
      }),
  );
  changeBattle("b");
  await act(async () => resolvers.get("a")!(empty));
  expect(view.getByText("Loading Battle Data")).toBeDefined();
  expect(view.queryByText("You are not in an active battle.")).toBeNull();
  expect(refetchProfile).not.toHaveBeenCalled();
  await act(async () => resolvers.get("b")!(empty));
  await waitFor(() => expect(refetchProfile).toHaveBeenCalledTimes(1));
});

it("keeps an already displayed result when a later lookup or profile loses its battle", async () => {
  const battle = makeCompleteBattle({
    id: "finished",
    usersState: [makeUser({ userId: "player" })],
  });
  const finished = { battle, result: { outcome: "Won" } } as unknown as Response;
  const { view, queryClient, changeBattle, refetchProfile } = mount(
    "finished",
    async () => finished,
  );
  await waitFor(() => expect(view.getByText("Finished battle result")).toBeDefined());
  await act(async () => queryClient.setQueryData(["combat", "finished"], empty));
  expect(refetchProfile).not.toHaveBeenCalled();
  changeBattle(null);
  expect(view.getByText("Finished battle result")).toBeDefined();
  expect(view.queryByRole("link", { name: "Return to Profile" })).toBeNull();
  expect(getDefaultStore().get(userContext.userBattleAtom)?.id).toBe(battle.id);
});

it("preserves dungeon recovery when a different member settles its battle", async () => {
  const battle = makeCompleteBattle({
    id: "dungeon-battle",
    usersState: [makeUser({ userId: "player" })],
    extraState: { dungeon: dungeonBattleState() },
  });
  const active = { battle, result: null } as unknown as Response;
  const { view, queryClient, push, refetchProfile } = mount(
    "dungeon-battle",
    async () => active,
  );
  await waitFor(() =>
    expect(view.getByText("Active battle dungeon-battle")).toBeDefined(),
  );
  expect(refetchProfile).not.toHaveBeenCalled();
  await act(async () => queryClient.setQueryData(["combat", "dungeon-battle"], empty));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dungeon"));
  expect(refetchProfile).toHaveBeenCalledTimes(1);
  expect(view.queryByText("Active battle dungeon-battle")).toBeNull();
});

it("does not route a missing newer battle through a retained dungeon battle", async () => {
  const battle = makeCompleteBattle({
    id: "dungeon-a",
    usersState: [makeUser({ userId: "player" })],
    extraState: { dungeon: dungeonBattleState() },
  });
  const { view, changeBattle, push, refetchProfile } = mount("dungeon-a", async (id) =>
    id === "dungeon-a" ? ({ battle, result: null } as unknown as Response) : empty,
  );
  await waitFor(() => expect(view.getByText("Active battle dungeon-a")).toBeDefined());
  changeBattle("ordinary-b");
  await waitFor(() =>
    expect(view.getByRole("link", { name: "Return to Profile" })).toBeDefined(),
  );
  expect(refetchProfile).toHaveBeenCalledTimes(1);
  expect(push).not.toHaveBeenCalled();
});

it("offers a compact battlefield badge that disables auto combat", async () => {
  const battle = makeCompleteBattle({
    id: "auto-battle",
    battleType: "ARENA",
    usersState: [makeUser({ userId: "player", isAutoCombat: true })],
  });
  const { view, toggleAutoCombat, queryClient } = mount(
    battle.id,
    async () => ({ battle, result: null }) as unknown as Response,
  );
  const badge = await view.findByRole("button", { name: "Disable auto combat" });
  expect(badge.parentElement?.className).toContain("top-2 left-2");
  expect(view.queryByText("Auto combat active")).toBeNull();
  expect(view.queryByText(/Your AI profile is fighting/)).toBeNull();
  expect(view.queryByText(/Hotkey/)).toBeNull();
  fireEvent.click(badge);
  expect(toggleAutoCombat).toHaveBeenCalledWith({
    battleId: battle.id,
    enabled: false,
  });
  await act(async () =>
    queryClient.setQueryData(["combat", battle.id], {
      battle: {
        ...battle,
        usersState: [makeUser({ userId: "player", isAutoCombat: false })],
      },
      result: null,
    }),
  );
  await waitFor(() =>
    expect(!!view.queryByRole("button", { name: "Disable auto combat" })).toBe(false),
  );
});

it("keeps required AI matches read-only and removes the badge from finished battles", async () => {
  const battle = makeCompleteBattle({
    id: "required-auto",
    battleType: "ARENA",
    usersState: [makeUser({ userId: "player", isAutoCombat: true })],
    extraState: { tournamentAiOnly: true },
  });
  const { view, toggleAutoCombat, queryClient } = mount(
    battle.id,
    async () => ({ battle, result: null }) as unknown as Response,
  );
  await view.findByRole("status");
  expect(view.queryByRole("button", { name: "Disable auto combat" })).toBeNull();
  expect(toggleAutoCombat).not.toHaveBeenCalled();
  await act(async () =>
    queryClient.setQueryData(["combat", battle.id], {
      battle,
      result: { outcome: "Won" },
    }),
  );
  await view.findByText("Finished battle result");
  expect(view.queryByRole("status")).toBeNull();
});

it("omits empty action tabs during auto combat when history and timeline are hidden", async () => {
  const battle = makeCompleteBattle({
    id: "auto-tabs",
    battleType: "ARENA",
    usersState: [makeUser({ userId: "player", isAutoCombat: true })],
  });
  const { view } = mount(
    battle.id,
    async () => ({ battle, result: null }) as unknown as Response,
    { useTabs: true },
  );
  await view.findByRole("button", { name: "Disable auto combat" });
  expect(view.queryByRole("tablist")).toBeNull();
});

it("selects the visible history during auto combat and marks its actions read", async () => {
  const battle = makeCompleteBattle({
    id: "auto-history",
    battleType: "ARENA",
    version: 7,
    usersState: [makeUser({ userId: "player", isAutoCombat: true })],
  });
  const { view, queryClient } = mount(
    battle.id,
    async () => ({ battle, result: null }) as unknown as Response,
    { useTabs: true, showBattleLog: true },
  );
  const history = await view.findByRole("tab", { name: "History" });
  expect(history.getAttribute("data-state")).toBe("active");
  await act(async () =>
    queryClient.setQueryData(["combat", battle.id], {
      battle: { ...battle, version: 8 },
      result: null,
    }),
  );
  await waitFor(() => expect(history.textContent).toBe("History"));
  expect(view.queryByRole("tab", { name: "Actions" })).toBeNull();
});

it("reads battle hotkeys from the loadouts chosen for this battle", async () => {
  const battle = makeCompleteBattle({
    id: "lobby",
    usersState: [
      makeUser({
        userId: "player",
        jutsuLoadout: "battle-jutsu",
        itemLoadout: "battle-item",
      }),
    ],
  });
  const { view } = mount(
    "lobby",
    async () => ({ battle, result: null }) as unknown as Response,
  );
  await waitFor(() => expect(view.getByText("Active battle lobby")).toBeDefined());
  expect(battleHotkeys.useBattleHotkeys).toHaveBeenLastCalledWith({
    jutsuLoadoutId: "battle-jutsu",
    itemLoadoutId: "battle-item",
  });
});

it("preserves the selected action while settings controls handle battle keys", async () => {
  const battle = makeCompleteBattle({
    id: "keyboard-focus",
    usersState: [makeUser({ userId: "player" })],
  });
  const { view } = mount(
    battle.id,
    async () => ({ battle, result: null }) as unknown as Response,
  );
  await view.findByText(`Active battle ${battle.id}`);
  const store = getDefaultStore();
  fireEvent.keyDown(document, { key: "a" });
  expect(store.get(userContext.combatActionIdAtom)).toBe("basicAttack");
  for (const role of ["dialog", "combobox", "listbox", "option"]) {
    const control = document.createElement("div");
    control.setAttribute("role", role);
    document.body.append(control);
    try {
      fireEvent.keyDown(control, { key: "a" });
      fireEvent.keyDown(control, { key: "Escape" });
      expect(store.get(userContext.combatActionIdAtom)).toBe("basicAttack");
    } finally {
      control.remove();
    }
  }
  fireEvent.keyDown(document, { key: "a" });
  expect(store.get(userContext.combatActionIdAtom)).toBeUndefined();
});

for (const [status, autoWakeUp, expected] of [
  ["AWAKE", true, true],
  ["ASLEEP", true, true],
  ["HOSPITALIZED", true, true],
  ["ASLEEP", false, false],
  ["BATTLE", true, false],
  ["TRAVEL", true, false],
  ["QUEUED", true, false],
] as const) {
  it(`arena heal result ${status} auto=${autoWakeUp}`, async () => {
    const battle = makeCompleteBattle({
      id: `arena-heal-${status}`,
      battleType: "ARENA",
      usersState: [
        makeUser({ userId: "player" }),
        makeUser({ userId: "opponent", isAi: true, controllerId: "arena-opponent" }),
      ],
    });
    const { view, changeProfile } = mount(
      battle.id,
      async () =>
        ({
          battle,
          result: { outcome: "Won", curHealth: 50, curStamina: 50, curChakra: 50 },
        }) as unknown as Response,
    );
    await view.findByText("Finished battle result");
    changeProfile({ status, autoWakeUp, battleId: null } as never);
    const button = view.container.querySelector<HTMLButtonElement>("#heal-return")!;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(!expected);
  });
}

it("uses stun-adjusted AP for action feedback, deselection and keyboard selection", async () => {
  const battle = makeCompleteBattle({
    id: "stunned-actions",
    usersState: [makeUser({ userId: "player", actionPoints: 100 })],
  });
  const { view, queryClient } = mount(
    battle.id,
    async () => ({ battle, result: null }) as unknown as Response,
    { layoutOrder: ["battlefield", "actions"] },
  );
  const heal = await view.findByRole("button", { name: "Basic Heal" });
  const store = getDefaultStore();
  expect(heal.getAttribute("aria-disabled")).toBe("false");
  fireEvent.keyDown(document, { key: "h" });
  expect(store.get(userContext.combatActionIdAtom)).toBe("basicHeal");
  const stun = makeEffect(
    "stun",
    { apReduction: 50, rounds: 3 },
    { targetId: "player", isNew: false, castThisRound: false },
  );
  await act(async () =>
    queryClient.setQueryData(["combat", battle.id], {
      battle: { ...battle, version: battle.version + 1, usersEffects: [stun] },
      result: null,
    }),
  );
  await waitFor(() => expect(heal.getAttribute("aria-disabled")).toBe("true"));
  expect(store.get(userContext.combatActionIdAtom)).toBeUndefined();
  act(() => heal.focus());
  const summary = (await view.findByRole("tooltip")).textContent;
  expect(summary).toContain("60 AP");
  expect(summary).toContain("Not enough AP");
  fireEvent.click(heal);
  fireEvent.keyDown(document, { key: "h" });
  expect(store.get(userContext.combatActionIdAtom)).toBeUndefined();
  await act(async () =>
    queryClient.setQueryData(["combat", battle.id], {
      battle: { ...battle, version: battle.version + 2 },
      result: null,
    }),
  );
  await waitFor(() => expect(heal.getAttribute("aria-disabled")).toBe("false"));
  fireEvent.keyDown(document, { key: "h" });
  expect(store.get(userContext.combatActionIdAtom)).toBe("basicHeal");
});
