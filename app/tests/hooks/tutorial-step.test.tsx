import { afterEach, beforeEach, describe, expect, it, mock, vi } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import { TUTORIAL_ITEM_ID } from "@/drizzle/constants";
import type * as TutorialHooks from "@/hooks/tutorial";
import type * as TutorialSteps from "@/libs/tutorialSteps";
import * as routing from "@/utils/routing";
import * as UserContext from "@/utils/UserContext";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeCompleteBattle,
  makeWeapon,
} from "../setup/combat";

// An assistant suite replaces these modules with one synthetic step, and Bun keeps
// module mocks across files. Query-suffixed imports load the real definitions again.
const realStepsPath = "../../src/libs/tutorialSteps.tsx?real";
const steps = (await import(realStepsPath)) as typeof TutorialSteps;
mock.module("@/libs/tutorialSteps", () => steps);
const realTutorialPath = "../../src/hooks/tutorial.tsx?real";
const { useTutorialStep } = (await import(realTutorialPath)) as typeof TutorialHooks;
const { TUTORIAL_STEPS } = steps;

const store = getDefaultStore();
let tutorialStep = 0;
let pathname = "/profile";
let status = "AWAKE";
let place: Record<string, unknown> = {};
let updateUser = vi.fn();
let push = vi.fn();
let replace = vi.fn();
let mutationOptions: StepMutationOptions | undefined;
let saveMutation = vi.fn(async (_variables: { step: number }) => ({}));

beforeEach(() => {
  tutorialStep = 0;
  pathname = "/profile";
  status = "AWAKE";
  place = { sector: 301, villageName: "Horizon", villageSector: 301 };
  updateUser = vi.fn();
  push = vi.fn();
  replace = vi.fn();
  mutationOptions = undefined;
  saveMutation = vi.fn(async (_variables: { step: number }) => ({}));
  vi.spyOn(UserContext, "useUserDataSelector").mockImplementation(
    () =>
      ({
        data: { userId: "u1", tutorialOn: true, tutorialStep, status, ...place },
        updateUser,
        timeDiff: 0,
      }) as never,
  );
  vi.spyOn(routing, "usePublicPathname").mockImplementation(() => pathname);
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push, replace } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: {
      updateTutorialStep: {
        useMutation: (options: StepMutationOptions) => {
          mutationOptions = options;
          return { mutate: vi.fn(), mutateAsync: saveMutation, isPending: false };
        },
      },
    },
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  act(() => {
    store.set(UserContext.userBattleAtom, undefined);
    store.set(UserContext.combatActionIdAtom, undefined);
  });
  vi.restoreAllMocks();
});

const renderCounted = () => {
  let renders = 0;
  renderHook(() => {
    renders += 1;
    return useTutorialStep();
  });
  return () => renders;
};

describe("useTutorialStep combat subscriptions", () => {
  it("keeps a fight begun on another page on the battle page while it loads", () => {
    tutorialStep = TUTORIAL_STEPS.findIndex((step) => step.id === "mission-find-pup");
    pathname = "/combat";
    status = "BATTLE";
    const { result } = renderHook(() => useTutorialStep());
    expect(TUTORIAL_STEPS[tutorialStep]?.page).toBe("/travel");
    expect(result.current.currentStep?.page).toBe("/combat");
    expect(result.current.currentStep?.elementIds).toEqual([]);
    expect(result.current.currentStep?.action).toBeUndefined();
  });

  it("coaches the courier fight from its first turn, where the first fights instruct", () => {
    pathname = "/combat";
    status = "BATTLE";
    const battle = makeCompleteBattle({
      activeUserId: "u1",
      round: 1,
      roundStartAt: new Date(),
      usersState: [
        makeBattleUser("u1", { direction: "left", longitude: 0 }),
        makeBattleUser("enemy", { longitude: 2, direction: "right" }),
      ],
    });
    act(() => store.set(UserContext.userBattleAtom, battle));
    const spotlitAt = (id: string) => {
      tutorialStep = TUTORIAL_STEPS.findIndex((step) => step.id === id);
      const { result, unmount } = renderHook(() => useTutorialStep());
      const elements = result.current.currentStep?.elementIds ?? [];
      unmount();
      return elements;
    };
    expect(spotlitAt("combat-fight")).not.toEqual([]);
    expect(spotlitAt("arena-fight")).not.toEqual([]);
    expect(spotlitAt("mission-find-pup")).toEqual([]);
  });

  it("points at the way back after a rematch that was lost again", () => {
    tutorialStep = TUTORIAL_STEPS.findIndex((step) => step.id === "combat-rematch");
    pathname = "/combat";
    status = "BATTLE";
    expect(renderHook(() => useTutorialStep()).result.current.currentStep?.title).toBe(
      "Rematch",
    );
    status = "AWAKE";
    const { result } = renderHook(() => useTutorialStep());
    expect(result.current.currentStep?.title).toBe("Battle over");
    expect(result.current.currentStep?.elementIds).toEqual(["return"]);
    expect(result.current.currentStep?.isInScene).toBe(false);
  });

  it("ignores battle updates and action selection outside a guided combat lesson", () => {
    const renders = renderCounted();
    const before = renders();
    act(() => {
      store.set(UserContext.userBattleAtom, { id: "battle" } as never);
      store.set(UserContext.combatActionIdAtom, "attack");
    });
    expect(renders()).toBe(before);
  });

  it("follows the battle during a guided combat lesson", () => {
    tutorialStep = TUTORIAL_STEPS.findIndex((step) => step.id === "combat-fight");
    pathname = "/combat";
    const renders = renderCounted();
    const before = renders();
    act(() => store.set(UserContext.combatActionIdAtom, "attack"));
    expect(renders()).toBeGreaterThan(before);
  });

  it("guides an owned shuriken selection to its target while retaining catalog highlights", () => {
    tutorialStep = TUTORIAL_STEPS.findIndex((step) => step.id === "combat-fight");
    pathname = "/combat";
    const battle = makeCompleteBattle({
      activeUserId: "u1",
      roundStartAt: new Date(),
      usersState: [
        makeBattleUser("u1", {
          direction: "left",
          longitude: 0,
          items: [
            makeBattleUserItem({ id: "owned-shuriken", itemId: TUTORIAL_ITEM_ID }),
          ],
        }),
        makeBattleUser("enemy", { longitude: 2, direction: "right" }),
      ],
      extraState: {
        items: {
          [TUTORIAL_ITEM_ID]: makeWeapon({
            id: TUTORIAL_ITEM_ID,
            name: "Shuriken",
            range: 3,
            battleUsageType: "BOTH",
          }),
        },
      },
    });
    act(() => store.set(UserContext.userBattleAtom, battle));
    const { result } = renderHook(() => useTutorialStep());
    expect(result.current.currentStep?.elementIds).toEqual([
      `tutorial-combat-action-${TUTORIAL_ITEM_ID}`,
    ]);
    act(() => store.set(UserContext.combatActionIdAtom, "owned-shuriken"));
    expect(result.current.currentStep?.title).toBe("Pick your target");
    expect(result.current.currentStep?.elementIds).toEqual(["tutorial-combat-field"]);
  });
});

describe("useTutorialStep after a fight", () => {
  const examTour = () => TUTORIAL_STEPS.findIndex((step) => step.id === "exam-tour");
  const examBattle = (leftBattle: boolean) =>
    makeCompleteBattle({
      id: "exam",
      usersState: [
        makeBattleUser("u1", { leftBattle }),
        makeBattleUser("clone", { longitude: 2 }),
      ],
    });

  it("shows the fight's close as soon as the battle that moved the step on is over", () => {
    tutorialStep = examTour();
    pathname = "/combat";
    status = "BATTLE";
    act(() => store.set(UserContext.userBattleAtom, examBattle(true)));
    const { result } = renderHook(() => useTutorialStep());
    expect(result.current.currentStep?.title).toBe("Battle over");
    expect(result.current.currentStep?.page).toBe("/combat");
  });

  it("keeps the step itself while the player is still in a fight", () => {
    tutorialStep = examTour();
    pathname = "/combat";
    status = "BATTLE";
    act(() => store.set(UserContext.userBattleAtom, examBattle(false)));
    const { result } = renderHook(() => useTutorialStep());
    expect(result.current.currentStep).toBe(TUTORIAL_STEPS[tutorialStep]);
  });
});

describe("useTutorialStep keyboard shortcuts", () => {
  const spentTurn = () => {
    tutorialStep = TUTORIAL_STEPS.findIndex((step) => step.id === "combat-fight");
    pathname = "/combat";
    status = "BATTLE";
    const battle = makeCompleteBattle({
      activeUserId: "u1",
      round: 2,
      roundStartAt: new Date(),
      usersState: [
        // A loadout the battle does not list keeps the turn open with too few AP to act.
        {
          ...makeBattleUser("u1", { longitude: 0, actionPoints: 5, direction: "left" }),
          items: undefined as never,
        },
        makeBattleUser("enemy", { longitude: 2, direction: "right" }),
      ],
    });
    act(() => store.set(UserContext.userBattleAtom, battle));
    return renderHook(() => useTutorialStep()).result;
  };

  it("names the End Turn key where there is a keyboard", () => {
    const result = spentTurn();
    expect(result.current.currentStep?.title).toBe("Turn spent");
    expect(result.current.currentStep?.action).toContain("press W");
  });

  it("leaves keyboard shortcuts out on touch screens", () => {
    const matchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(pointer: coarse)",
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    try {
      const result = spentTurn();
      expect(result.current.currentStep?.title).toBe("Turn spent");
      expect(result.current.currentStep?.action).not.toContain("press W");
    } finally {
      if (matchMedia) Object.defineProperty(window, "matchMedia", matchMedia);
      else delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });
});

describe("useTutorialStep step saving", () => {
  const stepIndex = (id: string) => {
    const index = TUTORIAL_STEPS.findIndex((step) => step.id === id);
    if (index === -1) throw new Error(`No tutorial step ${id}`);
    return index;
  };
  const saveStep = async (step: number) => {
    window.history.replaceState({}, "", pathname);
    renderHook(() => useTutorialStep());
    const options = mutationOptions;
    if (!options) throw new Error("The step mutation was not created");
    const context = await options.onMutate({ step });
    return { options, context };
  };

  it("changes the step at once and leaves the player on their page", async () => {
    tutorialStep = stepIndex("tools-itemshop-building");
    pathname = "/village";
    const next = tutorialStep + 1;
    const { context } = await saveStep(next);
    expect(updateUser).toHaveBeenCalledWith({ tutorialStep: next });
    expect(push).not.toHaveBeenCalled();
    expect(context.previousStep).toBe(tutorialStep);
  });

  it("puts the step back when the save fails, and keeps a confirmed one", async () => {
    tutorialStep = stepIndex("tools-itemshop-building");
    pathname = "/village";
    const { options, context } = await saveStep(tutorialStep + 1);
    updateUser.mockClear();
    await options.onSettled(
      undefined,
      new Error("offline"),
      { step: tutorialStep + 1 },
      context,
    );
    expect(updateUser).toHaveBeenCalledWith({ tutorialStep });
    updateUser.mockClear();
    await options.onSettled(
      { success: true, userPatch: { tutorialStep: tutorialStep + 1 } },
      null,
      { step: tutorialStep + 1 },
      context,
    );
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("useTutorialStep on the way to a step's page", () => {
  const at = (id: string, path: string) => {
    tutorialStep = TUTORIAL_STEPS.findIndex((step) => step.id === id);
    pathname = path;
    const { result, unmount } = renderHook(() => useTutorialStep());
    const { currentStep, stepNumber, arrivedStep } = result.current;
    unmount();
    return { currentStep, stepNumber, arrivedStep };
  };

  it("points at the next control and keeps the lesson's own words for its page", () => {
    const lesson = TUTORIAL_STEPS.find((step) => step.id === "combat-claim-reward")!;
    const way = at("combat-claim-reward", "/travel").currentStep;
    expect(way?.action).toBe("Tap Profile in the main menu.");
    expect(way?.elementIds).toEqual(["tutorial-profile"]);
    expect(way?.description).toBe(lesson.wayLead!);
    expect(way?.page).toBe("*");
    expect(way?.advanceOn).toBeUndefined();
    expect(at("combat-claim-reward", "/profile").currentStep).toBe(lesson);
    expect(push).not.toHaveBeenCalled();
  });

  it("shows no way to a player held by a fight or the hospital", () => {
    const lesson = TUTORIAL_STEPS.find((step) => step.id === "academy-building")!;
    status = "BATTLE";
    expect(at("academy-building", "/travel").currentStep).toBe(lesson);
    status = "HOSPITALIZED";
    expect(at("academy-building", "/hospital").currentStep).toBe(lesson);
  });

  it("completes a step on reaching the page its control leads to, by any way", () => {
    const academy = TUTORIAL_STEPS.findIndex((step) => step.id === "academy-building");
    expect(at("academy-building", "/village").arrivedStep).toBeUndefined();
    const arrived = at("academy-building", "/academy");
    expect(arrived.arrivedStep).toBe(academy + 1);
    expect(arrived.stepNumber).toBe(academy + 1);
    expect(arrived.currentStep).toBe(TUTORIAL_STEPS[academy + 1]!);
  });
});

describe("useTutorialStep closing words", () => {
  it("keeps the dashboard step after the claim and saves it only on Finish", async () => {
    tutorialStep = TUTORIAL_STEPS.findIndex((step) => step.id === "exam-dashboard");
    const { result } = renderHook(() => useTutorialStep());
    expect(result.current.currentStep?.advanceOn).toBe("claimStreak");
    await act(() => result.current.completeTutorialAction("claimStreak"));
    expect(saveMutation).not.toHaveBeenCalled();
    expect(result.current.currentStep?.id).toBe("exam-dashboard");
    await act(() => result.current.handleNextStepAsync());
    expect(saveMutation).toHaveBeenCalledWith({ step: tutorialStep + 1 });
  });
});

type StepMutationContext = {
  previousStep: number;
  rollbackNavigation?: () => void;
};

type StepMutationOptions = {
  onMutate: (variables: { step: number }) => Promise<StepMutationContext>;
  onSettled: (
    data: { success: boolean; userPatch?: { tutorialStep: number } } | undefined,
    error: Error | null,
    variables: { step: number },
    context: StepMutationContext | undefined,
  ) => Promise<void>;
};
