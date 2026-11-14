import { afterEach, beforeEach, describe, expect, it, mock, vi } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import type * as TutorialHooks from "@/hooks/tutorial";
import type * as TutorialSteps from "@/libs/tutorialSteps";
import * as routing from "@/utils/routing";
import * as UserContext from "@/utils/UserContext";

// An assistant suite replaces these modules with one synthetic step, and Bun keeps
// module mocks across files. Query-suffixed imports load the real definitions again.
const realStepsPath = "../../src/libs/tutorialSteps.tsx?real";
const steps = (await import(realStepsPath)) as typeof TutorialSteps;
mock.module("@/libs/tutorialSteps", () => steps);
const realTutorialPath = "../../src/hooks/tutorial.tsx?real";
const { tutorialPageGuidanceAtom, useTutorialStep } = (await import(
  realTutorialPath
)) as typeof TutorialHooks;
const { TUTORIAL_STEPS } = steps;

const store = getDefaultStore();
let tutorialStep = 0;
let pathname = "/profile";
let updateUser = vi.fn();
let push = vi.fn();
let replace = vi.fn();
let mutationOptions: StepMutationOptions | undefined;

beforeEach(() => {
  tutorialStep = 0;
  pathname = "/profile";
  updateUser = vi.fn();
  push = vi.fn();
  replace = vi.fn();
  mutationOptions = undefined;
  vi.spyOn(UserContext, "useUserDataSelector").mockImplementation(
    () =>
      ({
        data: { userId: "u1", tutorialOn: true, tutorialStep, status: "AWAKE" },
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
          return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
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
    store.set(tutorialPageGuidanceAtom, false);
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
});

describe("useTutorialStep step saving", () => {
  const stepIndex = (id: string) => TUTORIAL_STEPS.findIndex((step) => step.id === id);
  const saveStep = async (step: number) => {
    window.history.replaceState({}, "", pathname);
    renderHook(() => useTutorialStep());
    const options = mutationOptions;
    if (!options) throw new Error("The step mutation was not created");
    const context = await options.onMutate({ step });
    return { options, context };
  };

  it("leads a collapsed lesson to the next step's page before the save returns", async () => {
    tutorialStep = stepIndex("tools-home");
    pathname = "/village";
    const next = tutorialStep + 1;
    const { context } = await saveStep(next);
    expect(updateUser).toHaveBeenCalledWith({ tutorialStep: next });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(TUTORIAL_STEPS[next]?.page);
    expect(context.previousStep).toBe(tutorialStep);
  });

  it("leaves navigation to an open lesson, which follows the saved step", async () => {
    tutorialStep = stepIndex("tools-home");
    pathname = "/village";
    act(() => store.set(tutorialPageGuidanceAtom, true));
    await saveStep(tutorialStep + 1);
    expect(updateUser).toHaveBeenCalledWith({ tutorialStep: tutorialStep + 1 });
    expect(push).not.toHaveBeenCalled();
  });

  it("leaves battles to the battle start and stays on a page the step uses", async () => {
    tutorialStep = stepIndex("combat-enter-arena");
    pathname = "/battlearena";
    await saveStep(tutorialStep + 1);
    tutorialStep = stepIndex("combat-turns");
    pathname = "/combat";
    await saveStep(tutorialStep + 1);
    tutorialStep = stepIndex("tools-mission-hall");
    pathname = "/village";
    await saveStep(tutorialStep + 1);
    expect(push).not.toHaveBeenCalled();
  });

  it("puts the step back when the save fails, and keeps a confirmed one", async () => {
    tutorialStep = stepIndex("tools-home");
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

  it.each(["transport", "rejection"])(
    "restores a collapsed lesson's page after a %s failure",
    async (failure) => {
      tutorialStep = stepIndex("academy-accept-trials");
      pathname = "/academy";
      const nextStep = tutorialStep + 1;
      const { options, context } = await saveStep(nextStep);
      // The source component unmounts when the optimistic destination commits.
      cleanup();
      window.history.replaceState({}, "", "/village");
      await options.onSettled(
        failure === "rejection" ? { success: false } : undefined,
        failure === "transport" ? new Error("offline") : null,
        { step: nextStep },
        context,
      );
      expect(updateUser).toHaveBeenLastCalledWith({ tutorialStep });
      expect(replace).toHaveBeenCalledWith("/academy");
    },
  );

  it("cancels a still-loading optimistic page when saving fails", async () => {
    tutorialStep = stepIndex("academy-accept-trials");
    pathname = "/academy";
    const { options, context } = await saveStep(tutorialStep + 1);
    await options.onSettled(
      undefined,
      new Error("offline"),
      { step: tutorialStep + 1 },
      context,
    );
    expect(replace).toHaveBeenCalledWith("/academy");
  });

  it("preserves an independent navigation when an optimistic save fails", async () => {
    tutorialStep = stepIndex("academy-accept-trials");
    pathname = "/academy";
    const { options, context } = await saveStep(tutorialStep + 1);
    window.history.replaceState({}, "", "/profile");
    await options.onSettled(
      undefined,
      new Error("offline"),
      { step: tutorialStep + 1 },
      context,
    );
    expect(updateUser).toHaveBeenLastCalledWith({ tutorialStep });
    expect(replace).not.toHaveBeenCalled();
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
