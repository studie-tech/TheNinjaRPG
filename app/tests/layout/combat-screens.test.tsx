import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import * as combatHooks from "@/hooks/combat";
import * as gameScene from "@/hooks/game-scene";
import * as navigation from "@/hooks/navigation";
import * as tutorialHooks from "@/hooks/tutorial";
import * as inventoryCache from "@/hooks/useInventoryCacheUpdate";
import * as pageActive from "@/hooks/usePageActive";
import * as sectorCache from "@/hooks/useSectorCacheUpdate";
import Combat from "@/layout/Combat";
import * as combatResourceBars from "@/layout/CombatResourceBars";
import * as combatRewards from "@/layout/CombatRewards";
import * as countdown from "@/layout/Countdown";
import * as dayNight from "@/layout/DayNightIndicator";
import * as huntingBoard from "@/layout/HuntingBoard";
import * as image from "@/layout/Image";
import * as itemLoadout from "@/layout/ItemLoadoutSelector";
import * as jutsuLoadout from "@/layout/JutsuLoadoutSelector";
import * as logbook from "@/layout/Logbook";
import { maskBattle } from "@/libs/combat/masking";
import type { BattleState, CombatResult, ReturnedBattle } from "@/libs/combat/types";
import * as toast from "@/libs/toast";
import * as tutorialLib from "@/libs/tutorial";
import * as tutorialSteps from "@/libs/tutorialSteps";
import * as UserContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { makeCompleteBattle, makeUser } from "../setup/combat";

type Profile = {
  userId: string;
  username: string;
  role: string;
  tutorialOn: boolean;
  tutorialStep: number;
  isOutlaw: boolean;
  userQuests: unknown[];
};
type Response = { success: boolean; message: string; battle?: ReturnedBattle };

const state = {
  profile: undefined as unknown as Profile,
  currentStep: undefined as tutorialSteps.TutorialStepConfig | undefined,
  push: vi.fn(),
  nextStep: vi.fn(async (_step?: string) => {}),
  invalidateBattle: vi.fn(async () => {}),
  fetchProfile: vi.fn(async () => ({
    userData: { tutorialOn: true, tutorialStep: 9, status: "AWAKE" },
  })),
  ready: vi.fn(
    async (_input: { battleId: string }): Promise<Response> => ({
      success: false,
      message: "",
    }),
  ),
  loadout: vi.fn(
    async (_input: object): Promise<Response> => ({ success: false, message: "" }),
  ),
  performOptions: undefined as unknown as {
    onSuccess: (data: object, input: object, context: object) => Promise<void>;
  },
  publishBattle: vi.fn(),
  setBattleState: vi.fn(),
  rewards: vi.fn(),
};
const spies: { mockRestore: () => void }[] = [];
let toasts: ReturnType<typeof vi.fn>;
const clients: QueryClient[] = [];

const stub = <T extends object>(module: T, name: keyof T, implementation: unknown) => {
  spies.push(
    vi
      .spyOn(module, name as never)
      .mockImplementation(implementation as never) as never,
  );
};

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  for (const fn of [
    state.push,
    state.nextStep,
    state.invalidateBattle,
    state.fetchProfile,
    state.ready,
    state.loadout,
    state.publishBattle,
    state.setBattleState,
    state.rewards,
  ])
    fn.mockClear();
  state.currentStep = undefined;
  state.profile = {
    userId: "player",
    username: "player",
    role: "USER",
    tutorialOn: false,
    tutorialStep: 48,
    isOutlaw: false,
    userQuests: [],
  };
  toasts = vi.fn();
  stub(toast, "showMutationToast", toasts);
  stub(UserContext, "useRequiredUserData", () => ({
    data: state.profile,
    timeDiff: 0,
    updateUser: async () => true,
    prepareUserUpdate: () => 0,
  }));
  stub(inventoryCache, "useInventoryCacheUpdate", () => ({
    prepareInventoryUpdate: () => undefined,
    updateInventory: async () => undefined,
  }));
  stub(sectorCache, "useSectorCacheUpdate", () => ({
    prepareSectorUpdate: () => undefined,
    updateSector: async () => undefined,
  }));
  stub(tutorialHooks, "useTutorialStep", () => ({
    currentStep: state.currentStep,
    handleNextStepAsync: state.nextStep,
  }));
  stub(navigation, "useNavigationRouter", () => ({ push: state.push }));
  stub(pageActive, "usePageActive", () => true);
  stub(gameScene, "useGameScene", () => ({
    scene: { current: null },
    isReady: true,
    error: false,
  }));
  stub(combatHooks, "useCombatUpdates", () => ({
    updateLogs: async () => {},
    startAction: () => true,
    settleAction: () => {},
    canDrive: () => true,
    publishBattle: state.publishBattle,
  }));
  stub(combatResourceBars, "CombatResourceBars", () => null);
  stub(dayNight, "DayNightIndicator", () => null);
  stub(countdown, "default", () => <span>countdown</span>);
  stub(image, "default", () => null);
  stub(huntingBoard, "HuntingBoard", () => <p>Hunting board</p>);
  stub(logbook, "QuestUpdateModal", ({ questId }: { questId: string }) => (
    <p>Quest update {questId}</p>
  ));
  stub(combatRewards, "CombatRewards", (props: object) => {
    state.rewards(props);
    return <p>Rewards</p>;
  });
  for (const [module, kind] of [
    [itemLoadout, "Item"],
    [jutsuLoadout, "Jutsu"],
  ] as const) {
    stub(
      module,
      "default",
      ({
        onSelectOverride,
        selectedOverrideId,
      }: {
        onSelectOverride: (id: string, name: string) => void;
        selectedOverrideId?: string;
      }) => (
        <button
          type="button"
          onClick={() => onSelectOverride(`${kind}-next`, `${kind} next`)}
        >
          {kind} loadout {selectedOverrideId}
        </button>
      ),
    );
  }
  const api = Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      combat: { getBattle: { invalidate: state.invalidateBattle } },
      profile: { getUser: { fetch: state.fetchProfile } },
      territoryWar: { invalidate: async () => {} },
      village: { invalidate: async () => {} },
      clan: { invalidate: async () => {} },
    }),
    misc: {
      getAllGameAssetNames: {
        useQuery: () => ({
          data: [],
          isPlaceholderData: false,
          isError: false,
          isFetching: false,
          refetch: vi.fn(),
        }),
      },
    },
    combat: {
      performAction: {
        useMutation: (options: typeof state.performOptions) => {
          state.performOptions = options;
          return { mutate: vi.fn(), isPending: false };
        },
      },
      iAmHere: {
        useMutation: (options: object) =>
          useMutation({ ...options, mutationFn: state.ready }),
      },
      updateCombatLoadout: {
        useMutation: (options: object) =>
          useMutation({ ...options, mutationFn: state.loadout }),
      },
    },
  });
  spies.push(api as never);
});

afterEach(() => {
  cleanup();
  for (const spy of spies.splice(0)) spy.mockRestore();
  clients.splice(0).forEach((queryClient) => queryClient.clear());
  restoreBrowserGlobals();
});

const makeBattle = (values: Partial<ReturnedBattle> = {}, lobby = false) => {
  const now = Date.now();
  const battle = makeCompleteBattle({
    id: "battle-1",
    version: 3,
    createdAt: new Date(now + (lobby ? 60_000 : -120_000)),
    roundStartAt: new Date(now),
    updatedAt: new Date(now),
    activeUserId: "opponent",
    rewardScaling: 1,
    usersState: [
      makeUser({
        userId: "player",
        username: "Player",
        isOriginal: true,
        iAmHere: false,
        initiative: 12.7,
        itemLoadout: "Item-current",
        jutsuLoadout: "Jutsu-current",
      }),
      makeUser({
        userId: "opponent",
        username: "Rival",
        isOriginal: true,
        initiative: 15.2,
        iAmHere: true,
        direction: "right",
      }),
      makeUser({ userId: "minion", username: "Minion", isOriginal: true, isAi: true }),
    ],
  } as never);
  return { ...maskBattle(battle, "player"), ...values } as ReturnedBattle;
};

const result = (values: Partial<CombatResult> = {}) =>
  ({
    outcome: "Won",
    curHealth: 50,
    notifications: [],
    ...values,
  }) as unknown as CombatResult;

const mount = (battleState: BattleState, extra: { arenaActions?: ReactNode } = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  clients.push(queryClient);
  const tree = (current: BattleState) => (
    <QueryClientProvider client={queryClient}>
      <Combat
        battleState={current}
        userId="player"
        setBattleState={state.setBattleState}
        config={
          {
            showAggro: false,
            showGridNumbers: false,
            resourceBarsVisibility: "all",
          } as never
        }
        endTurnKey="w"
        arenaActions={extra.arenaActions}
        loadLpcCatalog={async () => ({}) as never}
      />
    </QueryClientProvider>
  );
  const view = render(tree(battleState));
  return { view, rerender: (next: BattleState) => view.rerender(tree(next)) };
};

const buttonTexts = (view: ReturnType<typeof render>) =>
  Array.from(view.container.querySelectorAll(".grid > *")).map(
    (node) => node.textContent,
  );

describe("combat lobby", () => {
  it("shows initiative and readiness, then confirms the player is ready", async () => {
    const battle = makeBattle({}, true);
    const { view, rerender } = mount({ battle, result: null, isPending: false });
    expect(view.getByText("Waiting for opponent")).toBeTruthy();
    expect(view.getByText("Initiative Winner: Rival", { exact: false })).toBeTruthy();
    expect(view.getByText("Player")).toBeTruthy();
    expect(view.getByText("Rival (✓)")).toBeTruthy();
    expect(view.queryByText("Minion", { exact: false })).toBeNull();
    expect(view.getByText("12")).toBeTruthy();
    expect(view.getByText("15")).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Item loadout Item-current" }),
    ).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Jutsu loadout Jutsu-current" }),
    ).toBeTruthy();
    expect(document.getElementById("tutorial-combat-field")?.hidden).toBe(false);

    let settle!: (response: Response) => void;
    state.ready.mockImplementationOnce(
      () =>
        new Promise((done) => {
          settle = done;
        }),
    );
    fireEvent.click(view.getByRole("button", { name: "I'm Ready" }));
    await waitFor(() =>
      expect(
        view.getByRole("button", { name: "Confirming" }).hasAttribute("disabled"),
      ).toBe(true),
    );
    expect(state.ready).toHaveBeenCalledWith(
      { battleId: "battle-1" },
      expect.anything(),
    );
    // A second press while confirming sends nothing.
    fireEvent.click(view.getByRole("button", { name: "Confirming" }));
    expect(state.ready).toHaveBeenCalledTimes(1);
    const readyBattle = makeBattle(
      {
        usersState: battle.usersState.map((user) =>
          user.userId === "player" ? { ...user, iAmHere: true } : user,
        ),
      },
      true,
    );
    await act(async () => settle({ success: true, message: "", battle: readyBattle }));
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Ready" }).hasAttribute("disabled")).toBe(
        true,
      ),
    );
    expect(view.getByText("Player (✓)")).toBeTruthy();
    expect(state.setBattleState).toHaveBeenCalledWith({
      battle: readyBattle,
      result: null,
      isPending: false,
    });
    expect(state.invalidateBattle).toHaveBeenCalledTimes(1);
    expect(toasts).not.toHaveBeenCalled();
    // An older snapshot of the same lobby cannot offer the action again. The battle
    // ref follows props after a commit, so the second render is the one that reads it.
    const stale = { ...battle };
    rerender({ battle: stale, result: null, isPending: false });
    rerender({ battle: stale, result: null, isPending: false });
    expect(view.getByRole("button", { name: "Ready" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(view.getByText("Player (✓)")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Item loadout Item-current" }));
    expect(state.loadout).not.toHaveBeenCalled();
  });

  it("reports an expired lobby and lets the player try again", async () => {
    state.ready.mockResolvedValueOnce({ success: false, message: "" });
    const { view } = mount({
      battle: makeBattle({}, true),
      result: null,
      isPending: false,
    });
    fireEvent.click(view.getByRole("button", { name: "I'm Ready" }));
    await waitFor(() =>
      expect(toasts).toHaveBeenCalledWith({
        success: false,
        message: "The combat lobby has expired. Refresh to see the current battle.",
      }),
    );
    expect(
      view.getByRole("button", { name: "I'm Ready" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("saves a loadout choice while holding readiness", async () => {
    const battle = makeBattle({}, true);
    let settle!: (response: Response) => void;
    state.loadout.mockImplementationOnce(
      () =>
        new Promise((done) => {
          settle = done;
        }),
    );
    const { view } = mount({ battle, result: null, isPending: false });
    fireEvent.click(view.getByRole("button", { name: "Item loadout Item-current" }));
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("Saving"));
    expect(state.loadout).toHaveBeenCalledWith(
      { battleId: "battle-1", itemLoadoutId: "Item-next" },
      expect.anything(),
    );
    expect(
      view.getByRole("button", { name: "I'm Ready" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Jutsu loadout Jutsu-current" }));
    expect(state.loadout).toHaveBeenCalledTimes(1);
    const updated = makeBattle(
      {
        usersState: battle.usersState.map((user) =>
          user.userId === "player" ? { ...user, itemLoadout: "Item-next" } : user,
        ),
      },
      true,
    );
    await act(async () =>
      settle({ success: true, message: "Item loadout set", battle: updated }),
    );
    await waitFor(() => expect(view.queryByRole("status")).toBeNull());
    expect(toasts).toHaveBeenCalledWith({
      success: true,
      title: "Loadout updated",
      message: "Item loadout set",
    });
    expect(state.setBattleState).toHaveBeenCalledWith({
      battle: updated,
      result: null,
      isPending: false,
    });
    expect(state.invalidateBattle).toHaveBeenCalledTimes(1);
    expect(
      view.getByRole("button", { name: "I'm Ready" }).hasAttribute("disabled"),
    ).toBe(false);

    state.loadout.mockResolvedValueOnce({ success: false, message: "" });
    fireEvent.click(view.getByRole("button", { name: "Jutsu loadout Jutsu-current" }));
    await waitFor(() =>
      expect(toasts).toHaveBeenLastCalledWith({
        success: false,
        message: "The combat lobby changed before this loadout could be saved.",
      }),
    );
    expect(state.loadout).toHaveBeenLastCalledWith(
      { battleId: "battle-1", jutsuLoadoutId: "Jutsu-next" },
      expect.anything(),
    );
  });

  it.each([
    ["RANKED_PVP", true, false],
    ["SPARRING", true, true],
    ["ARENA", false, false],
  ] as const)(
    "%s lobbies show the overlay=%s with loadouts=%s",
    (battleType, overlay, loadouts) => {
      const { view } = mount({
        battle: makeBattle({ battleType }, true),
        result: null,
        isPending: false,
      });
      expect(!!view.queryByText("Waiting for opponent")).toBe(overlay);
      expect(view.queryAllByRole("button", { name: /loadout/ }).length > 0).toBe(
        loadouts,
      );
    },
  );

  it("leaves the lobby once the countdown passes", () => {
    const { view } = mount({ battle: makeBattle(), result: null, isPending: false });
    expect(view.queryByText("Waiting for opponent")).toBeNull();
  });
});

describe("combat result screen", () => {
  it("returns to the profile after a won fight", () => {
    const battle = makeBattle();
    const { view } = mount(
      { battle, result: result(), isPending: false },
      { arenaActions: <button type="button">Arena again</button> },
    );
    expect(view.getByText("You Won")).toBeTruthy();
    expect(document.getElementById("tutorial-combat-field")?.hidden).toBe(true);
    const back = view.getByRole("button", { name: "Return to Profile" });
    expect(back.id).toBe("return");
    expect(back.closest("a")?.getAttribute("href")).toBe("/profile");
    expect(buttonTexts(view)).toEqual(["Return to Profile", "Arena again"]);
    expect(state.rewards).toHaveBeenLastCalledWith({
      result: result(),
      isOutlaw: false,
      isQuest: false,
      showPvpEnergy: false,
    });
    fireEvent.click(back);
    expect(state.fetchProfile).not.toHaveBeenCalled();
  });

  it("sends a defeated fighter to the hospital", () => {
    const { view } = mount({
      battle: makeBattle(),
      result: result({ outcome: "Lost", curHealth: 0 }),
      isPending: false,
    });
    expect(view.getByText("You Lost")).toBeTruthy();
    expect(
      view
        .getByRole("button", { name: "Return to Hospital" })
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("/hospital");
  });

  it.each([
    ["SHRINE_WAR", { outcome: "Won" }, ["Return to Profile", "Back to Shrine"]],
    ["SHRINE_WAR", { outcome: "Lost" }, ["Return to Profile"]],
    [
      "RANKED_PVP",
      { outcome: "Lost", curHealth: 0 },
      ["Return to Profile", "Back to PvP Queue"],
    ],
    ["QUEST", { outcome: "Won" }, ["Return to Profile", "To Map"]],
  ] as const)("offers the %s follow-ups after %o", (battleType, values, buttons) => {
    const { view } = mount({
      battle: makeBattle({ battleType }),
      result: result(values as never),
      isPending: false,
    });
    expect(buttonTexts(view)).toEqual([...buttons]);
    expect(state.rewards).toHaveBeenLastCalledWith(
      expect.objectContaining({ isQuest: battleType === "QUEST" }),
    );
  });

  it("returns a dungeon party member to the party", () => {
    const battle = makeBattle();
    const { view } = mount({
      battle: {
        ...battle,
        extraState: { ...battle.extraState, dungeon: { id: "dungeon" } },
      } as never,
      result: result(),
      isPending: false,
    });
    expect(
      view
        .getByRole("button", { name: "Return to party" })
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("/dungeon");
  });

  it("continues an isolated pyramid run in place", () => {
    state.profile = {
      ...state.profile,
      userQuests: [{ isolated: true, endAt: null, completed: 0 }],
    };
    const { view } = mount({
      battle: makeBattle({ battleType: "QUEST" }),
      result: result(),
      isPending: false,
    });
    const next = view.getByRole("button", { name: "Continue Pyramid" });
    expect(next.closest("a")?.getAttribute("href")).toBe("/combat");
    expect(view.queryByRole("button", { name: "To Map" })).toBeNull();
    fireEvent.click(next);
    expect(state.setBattleState).toHaveBeenCalledWith(undefined);
  });

  it("shows hunting rewards before the usual rewards", () => {
    const { view } = mount({
      battle: makeBattle(),
      result: result({ hunting: { id: "hunt" } } as never),
      isPending: false,
    });
    expect(view.getByText("Hunting board")).toBeTruthy();
  });

  it.each([
    ["Continue tutorial", "/profile", "Won", 50],
    ["Continue tutorial", "/hospital", "Lost", 0],
    ["To Map", "/travel", "Won", 50],
  ] as const)(
    "waits for the confirmed profile before %s to the next lesson (%s)",
    async (name, destination, outcome, curHealth) => {
      state.profile = { ...state.profile, tutorialOn: true, tutorialStep: 8 };
      state.currentStep = {
        id: "combat-fight",
        chapter: "combat",
        title: "Fight!",
        description: "",
        page: "/combat",
      };
      const returnPage = vi
        .spyOn(tutorialLib, "getTutorialBattleReturnPage")
        .mockReturnValue("/next-lesson");
      spies.push(returnPage);
      let settle!: (profile: Awaited<ReturnType<typeof state.fetchProfile>>) => void;
      state.fetchProfile.mockImplementationOnce(
        () =>
          new Promise((done) => {
            settle = done;
          }),
      );
      const { view } = mount({
        battle: makeBattle({ battleType: "QUEST" }),
        result: result({ outcome, curHealth } as never),
        isPending: false,
      });
      const button = view.getByRole("button", { name });
      const link = button.closest("a")!;
      expect(link.getAttribute("href")).toBe(
        destination === "/travel" ? "/travel" : destination,
      );
      const click = new MouseEvent("click", { bubbles: true, cancelable: true });
      act(() => {
        link.dispatchEvent(click);
      });
      expect(click.defaultPrevented).toBe(true);
      await waitFor(() =>
        expect(view.getAllByRole("button", { name: "Returning..." }).length).toBe(2),
      );
      expect(state.fetchProfile).toHaveBeenCalledWith(undefined, { staleTime: 0 });
      // A second press while the profile loads does not fetch again.
      act(() => {
        link.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(state.fetchProfile).toHaveBeenCalledTimes(1);
      const profile = {
        userData: { tutorialOn: true, tutorialStep: 9, status: "AWAKE" },
      };
      await act(async () => settle(profile));
      expect(returnPage).toHaveBeenCalledWith(
        tutorialSteps.TUTORIAL_STEPS,
        profile.userData,
        outcome,
        destination,
      );
      expect(state.push).toHaveBeenCalledWith("/next-lesson");
      await waitFor(() => expect(view.getByRole("button", { name })).toBeTruthy());
    },
  );

  it("keeps the player on the result screen when the profile cannot load", async () => {
    state.profile = { ...state.profile, tutorialOn: true };
    state.currentStep = {
      id: "combat-fight",
      chapter: "combat",
      title: "Fight!",
      description: "",
      page: "/combat",
    };
    state.fetchProfile.mockRejectedValueOnce(new Error("offline"));
    const { view } = mount({
      battle: makeBattle(),
      result: result(),
      isPending: false,
    });
    fireEvent.click(view.getByRole("button", { name: "Continue tutorial" }));
    await waitFor(() =>
      expect(toasts).toHaveBeenCalledWith({
        success: false,
        message: "Could not load your updated character. Please try returning again.",
      }),
    );
    expect(state.push).not.toHaveBeenCalled();
    expect(
      view.getByRole("button", { name: "Continue tutorial" }).hasAttribute("disabled"),
    ).toBe(false);
  });
});

describe("combat action notifications", () => {
  it("titles each settlement notice by its kind and advances the tutorial on a win", async () => {
    state.currentStep = {
      id: "combat-fight",
      chapter: "combat",
      title: "Fight!",
      description: "",
      page: "/combat",
      onCombatWin: "combat-claim-reward",
      onCombatLoss: "combat-enter-arena",
    };
    const battle = makeBattle();
    mount({ battle, result: null, isPending: false });
    const notifications = [
      "Kunai has broken and cannot be used until repaired!",
      "Kunai durability is critically low at 20%! Repair it soon to prevent it from breaking!",
      "Kunai durability is now 40%. Consider repairing it soon!",
      "Hidden Leaf's shrine captured! Hidden Leaf lost 5 war HP!",
      "The townhall took damage",
      "Return to the Shrine",
      "Delivered Herb for Errand.",
    ];
    const settled = { ...battle, version: 4 };
    await act(() =>
      state.performOptions.onSuccess(
        {
          updateClient: true,
          battleUpdate: settled,
          result: result({ notifications }),
          notification: "Turn passed",
          logEntries: undefined,
          updatedQuestIds: [],
        },
        { battleId: battle.id },
        {},
      ),
    );
    expect(toasts.mock.calls.map(([call]) => call)).toEqual([
      { success: false, message: "Turn passed" },
      { success: false, title: "Item Broken", message: notifications[0] },
      { success: false, title: "Low Durability Warning", message: notifications[1] },
      { success: false, title: "Low Durability Warning", message: notifications[2] },
      { success: true, title: "Quest Update", message: notifications[3] },
      { success: true, title: "War Update", message: notifications[4] },
      { success: true, title: "War Update", message: notifications[5] },
      { success: true, title: "Quest Update", message: notifications[6] },
    ]);
    expect(state.setBattleState).toHaveBeenLastCalledWith({
      battle: settled,
      result: result({ notifications }),
      isPending: false,
    });
    expect(state.publishBattle).toHaveBeenCalledTimes(1);
    expect(state.nextStep).toHaveBeenCalledWith("combat-claim-reward");
  });

  it("opens the next quest's update after a fight outside the tutorial", async () => {
    state.profile = {
      ...state.profile,
      userQuests: [{ questId: "chain-1", quest: { id: "chain-1" } }],
    };
    const findQuest = vi
      .spyOn(await import("@/libs/questRun"), "findConsecutiveQuestId")
      .mockReturnValue("chain-2");
    spies.push(findQuest);
    const battle = makeBattle();
    const { view } = mount({ battle, result: null, isPending: false });
    await act(() =>
      state.performOptions.onSuccess(
        {
          updateClient: true,
          battleUpdate: { ...battle, version: 4 },
          result: result({ outcome: "Lost" }),
          updatedQuestIds: ["chain-1"],
        },
        { battleId: battle.id },
        {},
      ),
    );
    expect(findQuest).toHaveBeenCalledWith(state.profile.userQuests, ["chain-1"]);
    expect(view.getByText("Quest update chain-2")).toBeTruthy();
    expect(state.nextStep).not.toHaveBeenCalled();
  });
});
