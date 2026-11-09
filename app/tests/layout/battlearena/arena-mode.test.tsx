import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import type { UserUpdate, UserUpdateOptions } from "@/deltas/profile";
import * as combatHooks from "@/hooks/combat";
import * as navigation from "@/hooks/navigation";
import * as sleep from "@/hooks/sleep";
import * as tutorial from "@/hooks/tutorial";
import * as loadoutNames from "@/hooks/useLoadoutNames";
import { ArenaMode } from "@/layout/battlearena/ArenaMode";
import * as image from "@/layout/Image";
import * as itemLoadout from "@/layout/ItemLoadoutSelector";
import * as jutsuLoadout from "@/layout/JutsuLoadoutSelector";
import * as userContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";

let mutate: ReturnType<typeof vi.fn>;
let toggleSleep: ReturnType<typeof vi.fn>;
let status = "AWAKE";
let autoWakeUp = true;
let tutorialStep: unknown;

beforeEach(() => {
  mutate = vi.fn();
  toggleSleep = vi.fn();
  status = "AWAKE";
  autoWakeUp = true;
  tutorialStep = undefined;
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: {
      getAllAiNames: {
        useQuery: () => ({
          data: [
            { userId: "ai-2", username: "Drazir", level: 85, avatar: null },
            { userId: "ai-1", username: "Yama", level: 20, avatar: null },
          ],
        }),
      },
      getAi: { useQuery: () => ({ data: undefined, isPending: true }) },
    },
    combat: { startArenaBattle: { useMutation: () => ({ mutate, isPending: false }) } },
  });
  vi.spyOn(userContext, "useRequiredUserData").mockImplementation(
    () =>
      ({
        data: { userId: "me", level: 22, status, autoWakeUp, dailyArenaFights: 3 },
        updateUser: vi.fn(),
      }) as never,
  );
  vi.spyOn(navigation, "useNavigationRouter").mockReturnValue({
    push: vi.fn(),
  } as never);
  vi.spyOn(tutorial, "useTutorialStep").mockImplementation(
    () => ({ currentStep: tutorialStep, completeTutorialAction: vi.fn() }) as never,
  );
  vi.spyOn(sleep, "useSleepToggle").mockImplementation(
    () => ({ toggleSleep, isTogglingSleep: false }) as never,
  );
  vi.spyOn(combatHooks, "useAutoCombatSetting").mockReturnValue([true, vi.fn()]);
  vi.spyOn(loadoutNames, "useLoadoutNames").mockReturnValue({
    jutsu: null,
    item: null,
  });
  vi.spyOn(jutsuLoadout, "default").mockImplementation((() => (
    <p>Jutsu loadout</p>
  )) as never);
  vi.spyOn(itemLoadout, "default").mockImplementation((() => (
    <p>Item loadout</p>
  )) as never);
  vi.spyOn(image, "default").mockImplementation((({ alt }: { alt: string }) => (
    // biome-ignore lint/performance/noImgElement: isolated avatar fixture
    <img alt={alt} />
  )) as never);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("names the selected opponent on the fight button", () => {
  render(<ArenaMode aiId="ai-1" setAiId={vi.fn()} />);
  const fight = screen.getByRole("button", { name: "Fight Yama" });
  expect(fight.id).toBe("tutorial-battlearena-challenge-ai-enter");
  expect(screen.getByText("Fights today: 3")).toBeDefined();
});

it("lists the closest level first and selects on click", () => {
  const setAiId = vi.fn();
  render(<ArenaMode aiId="ai-1" setAiId={setAiId} />);
  const tiles = screen
    .getAllByRole("button", { pressed: false })
    .concat(screen.getAllByRole("button", { pressed: true }));
  expect(tiles.some((tile) => tile.textContent?.includes("Drazir"))).toBe(true);
  expect(screen.getAllByRole("button", { name: /Level/ })[0]?.textContent).toContain(
    "Yama",
  );
  fireEvent.click(screen.getByRole("button", { name: /Drazir/ }));
  expect(setAiId).toHaveBeenCalledWith("ai-2");
});

it("switches to the best match when the saved opponent is not in the arena", () => {
  const setAiId = vi.fn();
  render(<ArenaMode aiId="retired-ai" setAiId={setAiId} />);
  expect(setAiId).toHaveBeenCalledWith("ai-1");
});

it("starts the fight once", () => {
  render(<ArenaMode aiId="ai-1" setAiId={vi.fn()} />);
  const fight = screen.getByRole("button", { name: "Fight Yama" });
  fireEvent.click(fight);
  fireEvent.click(fight);
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(mutate).toHaveBeenCalledWith({ aiId: "ai-1", autoCombat: true });
});

it("fights by hand during the tutorial", () => {
  tutorialStep = { advanceOn: "arenaStart" };
  render(<ArenaMode aiId="ai-1" setAiId={vi.fn()} />);
  expect(screen.queryByRole("switch", { name: "Toggle auto combat" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Fight Yama" }));
  expect(mutate).toHaveBeenCalledWith({ aiId: "ai-1", autoCombat: false });
});

it("asks to wake up when automatic waking is disabled", () => {
  status = "ASLEEP";
  autoWakeUp = false;
  render(<ArenaMode aiId="ai-1" setAiId={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Fight Yama" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Wake up/ }));
  expect(toggleSleep).toHaveBeenCalled();
});

it("keeps the tutorial fight action available for automatic waking", () => {
  status = "ASLEEP";
  tutorialStep = { advanceOn: "arenaStart" };
  render(<ArenaMode aiId="ai-1" setAiId={vi.fn()} />);
  const fight = screen.getByRole("button", { name: "Fight Yama" });
  expect(fight.id).toBe("tutorial-battlearena-challenge-ai-enter");
  fireEvent.click(fight);
  expect(mutate).toHaveBeenCalledWith({ aiId: "ai-1", autoCombat: false });
  expect(toggleSleep).not.toHaveBeenCalled();
});

it("scrolls opponents in one row and gives the battle setup its own row below", () => {
  render(<ArenaMode aiId="ai-1" setAiId={vi.fn()} />);
  const picker = screen.getByRole("region", { name: "Choose your opponent" });
  const strip = within(picker).getByRole("list", { name: "Opponents" });
  expect(strip.className).toContain("overflow-x-auto");
  expect(within(strip).getAllByRole("listitem")).toHaveLength(2);
  const setup = screen.getByRole("complementary", { name: "Battle setup" });
  expect(
    picker.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(setup.className).not.toContain("w-60");
  expect(within(setup).getByRole("button", { name: "Fight Yama" })).toBeDefined();
});

it.each(["ASLEEP", "HOSPITALIZED"] as const)(
  "applies recovered %s pools and the tutorial battle without a profile fetch",
  async (initialStatus) => {
    status = initialStatus;
    tutorialStep = { advanceOn: "arenaStart" };
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const nextAccountCache = new QueryClient();
    const key = [["profile", "getUser"], { type: "query" }];
    const initial = {
      userData: {
        userId: "me",
        status: initialStatus,
        autoWakeUp: true,
        level: 22,
        dailyArenaFights: 3,
        curHealth: 5,
        curChakra: 6,
        curStamina: 7,
      },
      notifications: [],
    };
    const canonical = {
      ...initial,
      userData: {
        ...initial.userData,
        status: "BATTLE" as const,
        battleId: "fight",
        dailyArenaFights: 4,
        curHealth: 100,
        curChakra: 100,
        curStamina: 100,
      },
      notifications: [{ color: "red", href: "/combat", name: "In combat" }],
    };
    const otherAccount = {
      ...initial,
      userData: { ...initial.userData, userId: "other", curHealth: 42 },
    };
    cache.setQueryData(key, initial);
    nextAccountCache.setQueryData(key, otherAccount);
    let reads = 0;
    const observer = new QueryObserver(cache, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => {
        reads++;
        return canonical;
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    const revision = prepareUserUpdate(cache, key);
    const updateUser = (patch: UserUpdate | undefined, options?: UserUpdateOptions) =>
      updateUserCache(cache, key, patch, options);
    vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
      data: initial.userData,
      updateUser,
      prepareUserUpdate: () => prepareUserUpdate(cache, key),
    } as never);
    const response = {
      success: true,
      battleId: "fight",
      actionNotice: "Recovered",
      userPatch: { status: "BATTLE" as const, battleId: "fight", dailyArenaFights: 4 },
      userDelta: {},
      userRecovery: {
        userId: "me",
        userPatch: {
          status: "AWAKE" as const,
          curHealth: 100,
          curChakra: 100,
          curStamina: 100,
        },
      },
    };
    let callbacks: {
      onMutate: () => number | undefined;
      onSuccess: (
        result: typeof response,
        input: unknown,
        revision: number | undefined,
      ) => Promise<void>;
    };
    Object.assign(client.api.combat.startArenaBattle, {
      useMutation: (options: typeof callbacks) => {
        callbacks = options;
        return { mutate, isPending: false };
      },
    });
    const completeTutorialAction = vi.fn();
    vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({
      currentStep: tutorialStep,
      completeTutorialAction,
    } as never);
    try {
      render(<ArenaMode aiId="tutorial-dummy" setAiId={vi.fn()} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Fight/ }));
        expect(mutate).toHaveBeenCalledWith({
          aiId: "tutorial-dummy",
          autoCombat: false,
        });
        await callbacks.onSuccess(
          response,
          { aiId: "tutorial-dummy" },
          callbacks.onMutate(),
        );
      });
      expect(reads).toBe(0);
      expect(cache.getQueryData(key)).toMatchObject(canonical);
      expect(completeTutorialAction).toHaveBeenCalledWith("arenaStart");
      // A callback captured by the former account retains its QueryClient after a session switch.
      await updateUserCache(cache, key, { curHealth: 1 }, { revision });
      expect(reads).toBe(1);
      expect(cache.getQueryData(key)).toEqual(canonical);
      expect(nextAccountCache.getQueryData(key)).toEqual(otherAccount);
    } finally {
      unsubscribe();
      cache.clear();
      nextAccountCache.clear();
    }
  },
);

it("preserves the profile after a lost battle response and allows retry", async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = [["profile", "getUser"], { type: "query" }];
  const initial = {
    userData: {
      userId: "me",
      status: "AWAKE",
      rank: "GENIN",
      level: 22,
      dailyArenaFights: 3,
      items: [],
      titles: [],
      battleId: null,
    },
    notifications: [],
  };
  const canonical = {
    ...initial,
    userData: {
      ...initial.userData,
      status: "BATTLE",
      battleId: "fight",
      dailyArenaFights: 4,
    },
  };
  cache.setQueryData(key, initial);
  const read = vi.fn(async () => canonical);
  const observer = new QueryObserver(cache, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: read,
  });
  const unsubscribe = observer.subscribe(() => {});
  vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
    data: initial.userData,
    prepareUserUpdate: () => prepareUserUpdate(cache, key),
    updateUser: (patch: UserUpdate | undefined, options?: UserUpdateOptions) =>
      updateUserCache(cache, key, patch, options),
  } as never);
  let callbacks!: { onError: (error: Error) => void };
  Object.assign(client.api.combat.startArenaBattle, {
    useMutation: (options: typeof callbacks) => {
      callbacks = options;
      return { mutate, isPending: false };
    },
  });
  try {
    render(<ArenaMode aiId="ai-1" setAiId={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Fight Yama" }));
    await act(async () => callbacks.onError(new Error("Response lost after commit")));
    expect(read).not.toHaveBeenCalled();
    expect(cache.getQueryData(key)).toEqual(initial);
    expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Fight Yama" }));
    expect(mutate).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
    cache.clear();
  }
});

it.each(["missing revision", "superseded revision", "withheld projection"] as const)(
  "retains the profile for a battle response with %s without starting a read",
  async (condition) => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = [["profile", "getUser"], { type: "query" }];
    const initial = {
      userData: {
        userId: "me",
        status: "AWAKE",
        rank: "GENIN",
        level: 22,
        dailyArenaFights: 3,
        items: [],
        titles: [],
        battleId: null,
      },
      notifications: [],
    };
    cache.setQueryData(key, initial);
    const read = vi.fn(async () => initial);
    const observer = new QueryObserver(cache, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: read,
    });
    const unsubscribe = observer.subscribe(() => {});
    vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
      data: initial.userData,
      prepareUserUpdate: () => prepareUserUpdate(cache, key),
      updateUser: (patch: UserUpdate | undefined, options?: UserUpdateOptions) =>
        updateUserCache(cache, key, patch, options),
    } as never);
    const response = {
      success: true,
      message: "Battle started",
      battleId: "fight",
      userPatch:
        condition === "withheld projection"
          ? undefined
          : { status: "BATTLE" as const, battleId: "fight" },
      userDelta: condition === "withheld projection" ? undefined : {},
    };
    let callbacks!: {
      onMutate: () => number | undefined;
      onSuccess: (
        result: typeof response,
        input: unknown,
        revision: number | undefined,
      ) => Promise<void>;
    };
    Object.assign(client.api.combat.startArenaBattle, {
      useMutation: (options: typeof callbacks) => {
        callbacks = options;
        return { mutate, isPending: false };
      },
    });
    try {
      render(<ArenaMode aiId="ai-1" setAiId={vi.fn()} />);
      const revision =
        condition === "missing revision" ? undefined : callbacks.onMutate();
      if (condition === "superseded revision") {
        cache.setQueryData<typeof initial>(
          key,
          (current) =>
            current && {
              ...current,
              userData: { ...current.userData, dailyArenaFights: 4 },
            },
        );
      }
      const preserved = cache.getQueryData(key);
      await act(async () => callbacks.onSuccess(response, { aiId: "ai-1" }, revision));
      expect(read).not.toHaveBeenCalled();
      expect(cache.getQueryData(key)).toEqual(preserved);
      expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
    } finally {
      unsubscribe();
      cache.clear();
    }
  },
);
