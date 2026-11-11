import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import { useTutorialStep } from "@/hooks/tutorial";
import { TUTORIAL_STEPS } from "@/libs/tutorialSteps";
import * as routing from "@/utils/routing";
import * as UserContext from "@/utils/UserContext";

const store = getDefaultStore();
let tutorialStep = 0;
let pathname = "/profile";

beforeEach(() => {
  tutorialStep = 0;
  pathname = "/profile";
  vi.spyOn(UserContext, "useUserDataSelector").mockImplementation(
    () =>
      ({
        data: { userId: "u1", tutorialOn: true, tutorialStep, status: "AWAKE" },
        updateUser: vi.fn(),
        timeDiff: 0,
      }) as never,
  );
  vi.spyOn(routing, "usePublicPathname").mockImplementation(() => pathname);
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: {
      updateTutorialStep: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
    },
  });
});

afterEach(() => {
  cleanup();
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
