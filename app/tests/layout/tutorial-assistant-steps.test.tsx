import { afterEach, beforeEach, describe, expect, it, mock, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import * as navigation from "next/navigation";
import { type ReactNode, useMemo } from "react";
import * as client from "@/app/_trpc/client";
import * as sortableList from "@/components/ui/sortable-list";
import {
  IMG_URL_ASSISTANT,
  OrderedQuestTypesInTutorial,
  TUTORIAL_STEPS_COUNT,
} from "@/drizzle/constants";
import type * as TutorialHooks from "@/hooks/tutorial";
import * as image from "@/layout/Image";
import * as logbook from "@/layout/Logbook";
import type { StoryDockCard } from "@/layout/StoryDock";
import { chatPanelAtom } from "@/libs/chatPanel";
import { dialogChoiceContentId } from "@/libs/objectives";
import { sceneCharactersAtom } from "@/libs/questScene";
import { getQuestsTabLesson } from "@/libs/questsTabLesson";
import * as toast from "@/libs/toast";
import {
  getTutorialChapterProgress,
  TUTORIAL_VILLAGE_CHOICE_STEP_ID,
} from "@/libs/tutorial";
import type * as TutorialSteps from "@/libs/tutorialSteps";
import { parseHtml } from "@/utils/parse";
import * as routing from "@/utils/routing";
import * as UserContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { stubDialog } from "../setup/dialog";

// Another assistant suite replaces these modules with one synthetic step, and Bun keeps
// module mocks across files. Query-suffixed imports load the real definitions again.
const realStepsPath = "../../src/libs/tutorialSteps.tsx?real";
const steps = (await import(realStepsPath)) as typeof TutorialSteps;
mock.module("@/libs/tutorialSteps", () => steps);
const realTutorialPath = "../../src/hooks/tutorial.tsx?real";
const tutorial = (await import(realTutorialPath)) as typeof TutorialHooks;
mock.module("@/hooks/tutorial", () => tutorial);
// The story card is driven here directly; its rules are covered by storyGuidance.test.ts.
const storyDock: { card: StoryDockCard | null } = { card: null };
mock.module("@/layout/StoryDock", () => ({
  useStoryDockCard: () => storyDock.card,
  StorySpotlight: () => null,
}));
const {
  TUTORIAL_CHAPTERS,
  TUTORIAL_HOSPITALIZED_STEP,
  TUTORIAL_STEPS,
  lessonReadingSeconds,
} = steps;
const { default: TutorialAssistant } = await import("@/layout/TutorialAssistant");

type Profile = {
  userId: string;
  tutorialOn: boolean;
  tutorialStep: number;
  status: string;
  battleId: string | null;
  level: number;
  rank: string;
  sector: number;
  earnedExperience: number;
  curStamina: number;
  maxStamina: number;
  curChakra: number;
  maxChakra: number;
  petAcquisitions: number;
  playedBefore?: boolean;
  role: string;
  userQuests?: unknown[];
  questData?: unknown[];
};

const state = {
  profile: undefined as unknown as Profile,
  pathname: "/profile",
  push: vi.fn(),
  replace: vi.fn(),
  updateUser: vi.fn(async (_patch: unknown) => {}),
  updateStep: vi.fn(),
  saveStep: vi.fn(async (_input: { step: number }) => ({ success: true })),
  disable: vi.fn(async () => ({ success: true, message: "Saved" })),
  sceneAssets: vi.fn(),
  checkRewards: vi.fn(),
  retryBattle: vi.fn(),
  setRightSideBarOpen: vi.fn(),
  streaks: undefined as unknown,
};

const makeProfile = (tutorialStep: number, values: Partial<Profile> = {}): Profile => ({
  userId: "actor",
  tutorialOn: true,
  tutorialStep,
  status: "AWAKE",
  battleId: null,
  level: 2,
  rank: "STUDENT",
  sector: -1,
  earnedExperience: 10,
  curStamina: 10,
  maxStamina: 100,
  curChakra: 10,
  maxChakra: 100,
  petAcquisitions: 0,
  role: "USER",
  ...values,
});

const spies: { mockRestore: () => void }[] = [];
let restoreDialogs = () => {};

beforeEach(() => {
  localStorage.clear();
  installBrowserGlobals({ resizeObserver: true, animationFrame: () => 0 });
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  getDefaultStore().set(sceneCharactersAtom, []);
  for (const fn of [
    state.push,
    state.replace,
    state.updateUser,
    state.updateStep,
    state.saveStep,
    state.disable,
    state.sceneAssets,
    state.checkRewards,
    state.setRightSideBarOpen,
  ])
    fn.mockClear();
  state.pathname = "/profile";
  state.streaks = undefined;
  spies.push(
    vi
      .spyOn(UserContext, "useUserData")
      .mockImplementation(() => ({ data: state.profile }) as never),
  );
  spies.push(
    vi.spyOn(UserContext, "useUserDataSelector").mockImplementation((select) => {
      const data = state.profile;
      const selected = useMemo(
        () => (data ? select(data as never) : undefined),
        [data],
      );
      return { data: selected, updateUser: state.updateUser, timeDiff: 0 } as never;
    }),
  );
  spies.push(
    vi.spyOn(routing, "usePublicPathname").mockImplementation(() => state.pathname),
  );
  spies.push(
    vi
      .spyOn(navigation, "useRouter")
      .mockImplementation(
        () => ({ push: state.push, replace: state.replace }) as never,
      ),
  );
  spies.push(vi.spyOn(image, "default").mockImplementation((() => null) as never));
  // The graduation screen celebrates with canvas confetti, which the test DOM cannot draw.
  spies.push(vi.spyOn(toast, "triggerConfetti").mockResolvedValue(undefined));
  spies.push(
    vi
      .spyOn(logbook, "QuestObjectives")
      .mockImplementation((({ quest }: { quest: { name: string } }) => (
        <p>Objectives of {quest.name}</p>
      )) as never),
  );
  spies.push(
    vi
      .spyOn(logbook, "useCheckRewards")
      .mockImplementation(
        () => ({ checkRewards: state.checkRewards, isCheckingRewards: false }) as never,
      ),
  );
  spies.push(
    vi.spyOn(sortableList, "SortableList").mockImplementation((({
      items,
    }: {
      items: { id: string; label: string }[];
    }) => (
      <ol>
        {items.map((item) => (
          <li key={item.id}>{item.label}</li>
        ))}
      </ol>
    )) as never),
  );
  const api = Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    profile: {
      updatePreferences: { useMutation: () => ({ mutateAsync: state.disable }) },
      updateTutorialStep: {
        // The step changes optimistically before the save, as the real mutation does.
        useMutation: (options: {
          onMutate?: (variables: { step: number }) => Promise<unknown>;
        }) => ({
          mutate: state.updateStep,
          mutateAsync: async (variables: { step: number }) => {
            await options.onMutate?.(variables);
            return state.saveStep(variables);
          },
          isPending: false,
        }),
      },
    },
    quests: {
      retryBattle: {
        useMutation: () => ({ mutate: state.retryBattle, isPending: false }),
      },
    },
    village: {
      getVillageChoices: { useQuery: () => ({ data: [], isPending: false }) },
    },
    // The "Tomorrow" screen previews day 2 of the daily streak, and the Dashboard lesson
    // closes once no day is left to claim.
    activityStreak: {
      getUserStreaks: { useQuery: () => ({ data: state.streaks }) },
    },
    gameAsset: {
      getSceneAssets: {
        useQuery: (input: unknown, options: unknown) => {
          state.sceneAssets(input, options);
          return {
            data: [
              { type: "SCENE_CHARACTER", image: "https://example.com/proctor.png" },
            ],
          };
        },
      },
    },
  });
  spies.push(api as never);
  restoreDialogs = stubDialog();
});

afterEach(() => {
  storyDock.card = null;
  cleanup();
  vi.useRealTimers();
  for (const spy of spies.splice(0)) spy.mockRestore();
  restoreDialogs();
  restoreBrowserGlobals();
});

const assistant = (
  sidebarBreakpoint: number | null = 768,
  rightSideBarOpen = false,
) => (
  <TutorialAssistant
    sidebarBreakpoint={sidebarBreakpoint}
    rightSideBarOpen={rightSideBarOpen}
    setRightSideBarOpen={state.setRightSideBarOpen}
    rightSideBarRef={{ current: null }}
  />
);

/** A visible element the assistant can measure, standing in for the page's control. */
const Target = ({
  id,
  box = new DOMRect(40, 300, 160, 48),
}: {
  id: string;
  box?: DOMRect;
}) => (
  <div
    id={id}
    ref={(element) => {
      if (element) element.getBoundingClientRect = () => box;
    }}
  />
);

const show = (
  step: number,
  values: Partial<Profile> = {},
  pathname?: string,
  extra?: ReactNode,
  breakpoint?: number | null,
) => {
  state.profile = makeProfile(step, values);
  state.pathname =
    pathname ?? TUTORIAL_STEPS[step]?.page.split(/[?#]/)[0] ?? "/profile";
  return render(
    <>
      {extra}
      {assistant(breakpoint)}
    </>,
  );
};

/**
 * Renders a step and waits out its reading time and the idle delay before the lesson
 * offers its own buttons.
 */
const showAfterIdle = (...args: Parameters<typeof show>) => {
  vi.useFakeTimers();
  const view = show(...args);
  act(() => vi.advanceTimersByTime(idleWaitMs(args[0])));
  vi.useRealTimers();
  return view;
};

/** The first wait before a step's own buttons: its reading time, then 10 s idle. */
const idleWaitMs = (step: number) =>
  Math.ceil((lessonReadingSeconds(TUTORIAL_STEPS[step]!) + 10) * 1000);

const textOf = (node: ReactNode) =>
  render(<div>{node}</div>).container.textContent ?? "";

const lesson = (view: ReturnType<typeof render>, title: string) =>
  view.getByRole("region", { name: `Tutorial: ${title}` });

const overlay = () =>
  document.body.querySelector<HTMLElement>("div[data-battle-focus-layer].inset-0");

describe("each tutorial step", () => {
  it("covers every defined step", () => {
    expect(TUTORIAL_STEPS).toHaveLength(TUTORIAL_STEPS_COUNT);
  });

  it.each(TUTORIAL_STEPS.map((step, index) => [index, step.id] as const))(
    "step %i (%s) shows its lesson, highlight and advance controls",
    async (index) => {
      const step = TUTORIAL_STEPS[index]!;
      const target = step.elementIds?.[0];
      const view = show(index, {}, undefined, target ? <Target id={target} /> : null);
      const region = lesson(view, step.title);
      expect(region.getAttribute("data-tutorial-step")).toBe(step.id);

      // The test window is wider than the sidebar breakpoint: the menu is a sidebar.
      const shown = step.sidebarDescription ?? step.description;
      const description = textOf(typeof shown === "string" ? parseHtml(shown) : shown);
      expect(region.textContent).toContain(description);
      const progress = getTutorialChapterProgress(TUTORIAL_STEPS, index)!;
      const chapterIndex = TUTORIAL_CHAPTERS.findIndex(
        (chapter) => chapter.id === progress.chapter,
      );
      expect(region.textContent).toContain(
        `Chapter ${chapterIndex + 1} of ${TUTORIAL_CHAPTERS.length} · ${TUTORIAL_CHAPTERS[chapterIndex]?.title}`,
      );
      expect(
        view
          .getByRole("progressbar", { name: "Chapter progress" })
          .getAttribute("aria-valuenow"),
      ).toBe(String(progress.position));
      if (step.action) expect(region.textContent).toContain(step.action);

      // The highlight surrounds the step's first target and only captures clicks that
      // advance; a scene on the page stays lit around its target.
      const marked = target;
      const highlightButton = marked
        ? view.getByRole("button", { name: step.action ?? "Continue tutorial" })
        : null;
      if (marked) {
        const hole = highlightButton!.parentElement!.parentElement!;
        expect(hole.style.transform).toBe("translate(32px, 292px)");
        expect(highlightButton!.className.includes("pointer-events-auto")).toBe(
          !!step.proceedOnHighlightClick,
        );
        expect(!!overlay()?.querySelector(".animate-spotlight-ping")).toBe(
          !!step.action || !!step.proceedOnHighlightClick,
        );
      } else {
        expect(overlay() === null).toBe(true);
      }

      const nextLabel =
        step.nextLabel ?? (index === TUTORIAL_STEPS.length - 1 ? "Finish" : "Next");
      expect(!!view.queryByRole("button", { name: nextLabel })).toBe(
        !!step.showNextButton,
      );

      // Each way of advancing is tried on a fresh lesson: the last one hides on advance.
      const advance = async (
        press: (view: ReturnType<typeof render>) => void,
        advances: boolean,
      ) => {
        cleanup();
        state.saveStep.mockClear();
        state.updateUser.mockClear();
        const fresh = show(
          index,
          {},
          undefined,
          target ? <Target id={target} /> : null,
        );
        press(fresh);
        if (advances) {
          await waitFor(() =>
            expect(state.saveStep).toHaveBeenCalledWith({ step: index + 1 }),
          );
          expect(state.updateUser).toHaveBeenCalledWith({ tutorialStep: index + 1 });
        } else {
          await act(async () => {});
          expect(state.saveStep).not.toHaveBeenCalled();
        }
      };
      // Enter advances exactly the steps that offer Next or a pressable highlight.
      await advance(
        () => fireEvent.keyDown(window, { key: "Enter" }),
        !!step.showNextButton || !!step.proceedOnHighlightClick,
      );
      if (step.showNextButton)
        await advance(
          (fresh) => fireEvent.click(fresh.getByRole("button", { name: nextLabel })),
          true,
        );
      if (marked)
        await advance(
          (fresh) =>
            fireEvent.click(
              fresh.getByRole("button", { name: step.action ?? "Continue tutorial" }),
            ),
          !!step.proceedOnHighlightClick,
        );
      expect(state.push).not.toHaveBeenCalled();
      expect(state.replace).not.toHaveBeenCalled();
      expect(state.updateStep).not.toHaveBeenCalled();
    },
  );
});

describe("collapsed graduation", () => {
  it("moves a graduate whose lesson is collapsed onto the full-screen promotion", async () => {
    localStorage.setItem("activityDockOpen:actor", "false");
    const rankUp = TUTORIAL_STEPS.findIndex((step) => step.id === "exam-rank-up");
    show(5, { rank: "GENIN", userQuests: [] });
    await waitFor(() =>
      expect(state.updateStep).toHaveBeenCalledWith({ step: rankUp }),
    );
    expect(state.updateStep).toHaveBeenCalledTimes(1);
  });
});

describe("step overrides", () => {
  it("leaves Lemu out of the card while the page's quest scene shows her", () => {
    const store = getDefaultStore();
    store.set(sceneCharactersAtom, [[IMG_URL_ASSISTANT]]);
    const view = show(0);
    const region = lesson(view, TUTORIAL_STEPS[0]!.title);
    expect(region.querySelector("[data-tutorial-portrait]")).toBeNull();
    act(() => store.set(sceneCharactersAtom, []));
    expect(region.querySelector("[data-tutorial-portrait]")).toBeTruthy();
  });

  it("shows Lemu inside the lesson card, practice steps included", () => {
    const practice = TUTORIAL_STEPS.findIndex((step) => step.page === "*");
    for (const index of [0, practice]) {
      const drawn = image.default as unknown as ReturnType<typeof vi.fn>;
      drawn.mockClear();
      const view = show(index);
      const region = lesson(view, TUTORIAL_STEPS[index]!.title);
      expect(region.querySelector("[data-tutorial-portrait]")).toBeTruthy();
      expect(drawn.mock.calls.some(([props]) => props?.src === IMG_URL_ASSISTANT)).toBe(
        true,
      );
      cleanup();
    }
  });

  it("points to a highlight scrolled out of view and scrolls to it on a tap", () => {
    const scrollBy = vi.fn();
    const original = window.scrollBy;
    window.scrollBy = scrollBy as never;
    const below = window.innerHeight + 400;
    const view = show(
      TUTORIAL_STEPS.findIndex((step) => step.id === "academy-building"),
      {},
      undefined,
      <Target id="tutorial-academy" box={new DOMRect(40, below, 160, 48)} />,
    );
    fireEvent.click(
      view.getByRole("button", { name: "Scroll down to the highlighted control" }),
    );
    expect(scrollBy).toHaveBeenCalledWith({
      top: below - window.innerHeight * 0.35,
      behavior: "smooth",
    });
    window.scrollBy = original;
  });

  it("shows the hospital lesson over any step while hospitalized", () => {
    const view = show(
      5,
      { status: "HOSPITALIZED" },
      "/hospital",
      <Target id="tutorial-hospital-buttons" />,
    );
    const region = lesson(view, TUTORIAL_HOSPITALIZED_STEP.title);
    expect(region.getAttribute("data-tutorial-step")).toBe("hospitalized");
    expect(region.textContent).toContain(TUTORIAL_HOSPITALIZED_STEP.action!);
    expect(
      view.getByRole("button", { name: TUTORIAL_HOSPITALIZED_STEP.action! }),
    ).toBeTruthy();
    expect(state.push).not.toHaveBeenCalled();
  });

  it("celebrates a formed bond and points at the new companion", async () => {
    const index = TUTORIAL_STEPS.findIndex((step) => step.advanceOn === "petAdopt");
    const view = show(
      index,
      { petAcquisitions: 1 },
      "/pets",
      <Target id="tutorial-pet-acquisition" />,
    );
    const region = lesson(view, "A bond is formed");
    expect(region.textContent).toContain("The Bondkeepers bless your new bond.");
    expect(view.getByRole("button", { name: "Continue tutorial" })).toBeTruthy();
    expect(state.saveStep).not.toHaveBeenCalled();
    // Nothing reports an adoption, so the reveal moves on with Next or Enter.
    expect(view.getByRole("button", { name: "Next" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() =>
      expect(state.saveStep).toHaveBeenCalledWith({ step: index + 1 }),
    );
  });

  it("explains greyed-out ramen to a player with full stamina and chakra", async () => {
    const index = TUTORIAL_STEPS.findIndex((step) => step.advanceOn === "buyRamen");
    const view = show(index, { curStamina: 100, curChakra: 100 });
    const region = lesson(view, TUTORIAL_STEPS[index]!.title);
    expect(region.textContent).toContain("Your stamina and chakra are full right now");
    expect(region.textContent).toContain("Tap Next.");
    expect(view.getByRole("button", { name: "Next" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() =>
      expect(state.saveStep).toHaveBeenCalledWith({ step: index + 1 }),
    );
  });

  it.each([
    [
      "spending experience the player does not have",
      "needsUnassignedExperience",
      { earnedExperience: 0 },
      undefined,
    ],
    [
      "adopting after a bond already formed",
      "petAdopt",
      { petAcquisitions: 1 },
      "/profile",
    ],
    ["travelling to the sector the player stands in", "travelArrive", {}, undefined],
  ] as const)("skips %s", async (_name, kind, values, pathname) => {
    const index = TUTORIAL_STEPS.findIndex((step) =>
      kind === "needsUnassignedExperience"
        ? step.needsUnassignedExperience
        : step.advanceOn === kind,
    );
    const step = TUTORIAL_STEPS[index]!;
    const sector = kind === "travelArrive" ? Number(step.relatedValue) : -1;
    show(index, { ...values, sector }, pathname);
    await waitFor(() =>
      expect(state.saveStep).toHaveBeenCalledWith({ step: index + 1 }),
    );
  });
});

describe("routing", () => {
  it.each([false, true])(
    "keeps drawer-only tutorial dismissal responsive (desktop=%s)",
    (desktop) => {
      const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({
          matches: desktop,
          addEventListener() {},
          removeEventListener() {},
        }),
      });
      try {
        state.pathname = "/not-the-lesson";
        state.profile = makeProfile(0);
        render(assistant(null, true));
        expect(state.push).toHaveBeenCalled();
        if (desktop) expect(state.setRightSideBarOpen).not.toHaveBeenCalledWith(false);
        else expect(state.setRightSideBarOpen).toHaveBeenCalledWith(false);
      } finally {
        cleanup();
        if (original) Object.defineProperty(window, "matchMedia", original);
        else Reflect.deleteProperty(window, "matchMedia");
      }
    },
  );

  it("sends the player to the step's page and tries once more", async () => {
    vi.useFakeTimers();
    const index = TUTORIAL_STEPS.findIndex((step) => step.page === "/village");
    const view = show(index, {}, "/profile");
    expect(state.push).toHaveBeenCalledWith("/village");
    expect(state.setRightSideBarOpen).toHaveBeenCalledWith(false);
    // While the page opens the lesson says where it is going, never an empty dock.
    expect(lesson(view, TUTORIAL_STEPS[index]!.title).textContent).toContain(
      "Taking you there",
    );
    expect(view.queryByText("There is no tutorial guidance on this page.")).toBeNull();
    act(() => vi.advanceTimersByTime(1500));
    expect(state.push).toHaveBeenCalledTimes(2);
  });

  it("returns a player to their abandoned tutorial fight", () => {
    const index = TUTORIAL_STEPS.findIndex(
      (step) => step.onCombatWin && step.page === "/combat",
    );
    show(index, { status: "BATTLE", battleId: "fight" }, "/profile");
    expect(state.replace).toHaveBeenCalledWith("/combat");
    expect(state.push).not.toHaveBeenCalled();
  });

  it("sends the player back to their tutorial fight a second time", () => {
    vi.useFakeTimers();
    const index = TUTORIAL_STEPS.findIndex(
      (step) => step.onCombatWin && step.page === "/combat",
    );
    show(index, { status: "BATTLE", battleId: "fight" }, "/profile");
    expect(state.replace).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1500));
    expect(state.replace).toHaveBeenCalledTimes(2);
    expect(state.replace).toHaveBeenLastCalledWith("/combat");
    expect(state.push).not.toHaveBeenCalled();
  });

  it("leaves an unrelated battle alone on a step outside the fight", () => {
    show(0, { status: "BATTLE", battleId: "fight" }, "/profile");
    expect(state.replace).not.toHaveBeenCalled();
  });
});

describe("highlight placement", () => {
  const index = TUTORIAL_STEPS.findIndex((step) => step.id === "academy-building");
  const target = () => TUTORIAL_STEPS[index]!.elementIds![0]!;

  it("scrolls an off-screen target towards the middle, a bounded number of times", async () => {
    const scrollBy = vi.fn();
    Object.defineProperty(document, "scrollingElement", {
      configurable: true,
      value: { scrollBy },
    });
    try {
      show(
        index,
        {},
        "/village",
        <Target id={target()} box={new DOMRect(40, 2000, 160, 48)} />,
      );
      expect(scrollBy).toHaveBeenCalledWith({
        top: 2024 - (80 + window.innerHeight) / 2,
        behavior: "auto",
      });
      await waitFor(() => expect(scrollBy).toHaveBeenCalledTimes(5), { timeout: 3000 });
      await new Promise((done) => setTimeout(done, 600));
      expect(scrollBy).toHaveBeenCalledTimes(5);
    } finally {
      Reflect.deleteProperty(document, "scrollingElement");
    }
  });

  it("leaves a visible, well-placed target alone", async () => {
    const scrollBy = vi.fn();
    Object.defineProperty(document, "scrollingElement", {
      configurable: true,
      value: { scrollBy },
    });
    try {
      const middle = (80 + window.innerHeight) / 2;
      const view = show(
        index,
        {},
        "/village",
        <Target id={target()} box={new DOMRect(40, middle - 24, 160, 48)} />,
      );
      await new Promise((done) => setTimeout(done, 600));
      expect(scrollBy).not.toHaveBeenCalled();
      expect(
        lesson(view, TUTORIAL_STEPS[index]!.title).getAttribute("data-dodge-highlight"),
      ).toBeNull();
    } finally {
      Reflect.deleteProperty(document, "scrollingElement");
    }
  });

  it("moves the lesson aside when scrolling cannot uncover the target", async () => {
    const view = show(
      index,
      {},
      "/village",
      <Target id={target()} box={new DOMRect(40, 600, 160, 48)} />,
    );
    const dock = view.container.querySelector<HTMLElement>("[data-activity-dock]")!;
    dock.getBoundingClientRect = () => new DOMRect(0, 500, 420, 300);
    await waitFor(
      () =>
        expect(
          lesson(view, TUTORIAL_STEPS[index]!.title).getAttribute(
            "data-dodge-highlight",
          ),
        ).toBe("true"),
      { timeout: 3000 },
    );
  });
});

describe("fight placement", () => {
  const fight = TUTORIAL_STEPS.findIndex((step) => step.id === "combat-battlefield");
  const placeFight = async (
    timerTop: number,
    expectedTop: number,
    { fieldHeight = 300, dockTop = 350, tile = null as DOMRect | null } = {},
  ) => {
    const scrollBy = vi.fn();
    Object.defineProperty(document, "scrollingElement", {
      configurable: true,
      value: { scrollBy },
    });
    try {
      const view = show(
        fight,
        {},
        "/combat",
        <>
          <Target
            id="tutorial-combat-action-timer"
            box={new DOMRect(40, timerTop, 600, 48)}
          />
          <Target
            id="tutorial-combat-field"
            box={new DOMRect(40, 92, 600, fieldHeight)}
          />
          {tile && <Target id="tutorial-combat-action-basicAttack" box={tile} />}
        </>,
      );
      const dock = view.container.querySelector<HTMLElement>("[data-activity-dock]")!;
      dock.getBoundingClientRect = () => new DOMRect(0, dockTop, 420, 300);
      await waitFor(
        () =>
          expect(scrollBy).toHaveBeenCalledWith({ top: expectedTop, behavior: "auto" }),
        { timeout: 3000 },
      );
      expect(scrollBy.mock.calls.every(([call]) => call.top <= expectedTop)).toBe(true);
    } finally {
      Reflect.deleteProperty(document, "scrollingElement");
    }
  };

  it("uncovers a target only as far as the AP bar stays on screen", async () => {
    // Clearing the field would scroll 58px; the AP bar 40px from the top allows 24.
    await placeFight(40, 24);
  });

  it("brings an AP bar above the screen back into view", async () => {
    await placeFight(-30, -46);
  });

  it("places a field taller than the screen as far as the AP bar allows", async () => {
    await placeFight(40, 24, { fieldHeight: 2 * window.innerHeight });
  });

  it("scrolls the action tiles under an uncovered field clear of the lesson", async () => {
    // The field ends above the dock at 450; the tile below it needs 500 + 16 - 450.
    await placeFight(200, 66, { dockTop: 450, tile: new DOMRect(40, 400, 90, 100) });
  });

  it("places the fight again when action tiles land below the screen after it settled", async () => {
    const scrollBy = vi.fn();
    Object.defineProperty(document, "scrollingElement", {
      configurable: true,
      value: { scrollBy },
    });
    let tileBox = new DOMRect(40, 400, 90, 100);
    try {
      const view = show(
        fight,
        {},
        "/combat",
        <>
          <Target
            id="tutorial-combat-action-timer"
            box={new DOMRect(40, 200, 600, 48)}
          />
          <Target id="tutorial-combat-field" box={new DOMRect(40, 92, 600, 300)} />
          <div
            id="tutorial-combat-action-basicAttack"
            ref={(element) => {
              if (element) element.getBoundingClientRect = () => tileBox;
            }}
          />
        </>,
      );
      const dock = view.container.querySelector<HTMLElement>("[data-activity-dock]")!;
      dock.getBoundingClientRect = () => new DOMRect(700, 0, 300, 300);
      // Placed in view and clear of the lesson, so it latches without scrolling.
      await new Promise((done) => setTimeout(done, 600));
      expect(scrollBy).not.toHaveBeenCalled();
      // Tiles rendering later run past the foot of the screen.
      tileBox = new DOMRect(40, window.innerHeight - 50, 90, 100);
      const expectedTop = tileBox.bottom + 16 - window.innerHeight;
      await waitFor(
        () =>
          expect(scrollBy).toHaveBeenCalledWith({ top: expectedTop, behavior: "auto" }),
        { timeout: 3000 },
      );
    } finally {
      Reflect.deleteProperty(document, "scrollingElement");
    }
  });

  it("narrows the lesson to the space beside the field and restores it after", async () => {
    const root = document.documentElement;
    const view = show(
      fight,
      {},
      "/combat",
      <Target id="tutorial-combat-field" box={new DOMRect(40, 92, 600, 300)} />,
    );
    const dock = view.container.querySelector<HTMLElement>("[data-activity-dock]")!;
    // The dock ends at 1020 and the field at 640; 16px stay between them.
    dock.getBoundingClientRect = () => new DOMRect(600, 350, 420, 300);
    await waitFor(
      () => expect(root.style.getPropertyValue("--activity-dock-width")).toBe("364px"),
      { timeout: 3000 },
    );
    view.unmount();
    expect(root.style.getPropertyValue("--activity-dock-width")).toBe("");
  });

  it("keeps the lesson text on a phone unless the step has an instruction to show", () => {
    const explained = show(fight, {}, "/combat");
    const battlefield = TUTORIAL_STEPS[fight]!;
    expect(
      explained
        .getByText(battlefield.description as string)
        .className.includes("max-md:hidden"),
    ).toBe(false);
    cleanup();
    const exam = TUTORIAL_STEPS.findIndex((step) => step.id === "exam-proctor");
    const instructed = show(exam, {}, "/combat");
    expect(
      instructed
        .getByText(TUTORIAL_STEPS[exam]!.description as string)
        .className.includes("max-md:hidden"),
    ).toBe(true);
  });

  it("keeps the reason beside an instruction that points at a control", () => {
    const claim = TUTORIAL_STEPS.findIndex((step) => step.id === "combat-claim-reward");
    const view = show(claim, {}, "/combat");
    expect(lesson(view, "Battle over")).toBeTruthy();
    expect(
      view
        .getByText("That's the fight done.", { exact: false })
        .className.includes("max-md:hidden"),
    ).toBe(false);
  });

  it("says where it is going while a battle starts, never an empty dock", () => {
    vi.useFakeTimers();
    const walk = TUTORIAL_STEPS.findIndex((step) => step.id === "exam-walk");
    const view = show(walk, { status: "BATTLE", battleId: "exam" }, "/combat");
    expect(lesson(view, TUTORIAL_STEPS[walk]!.title).textContent).toContain(
      "Taking you there",
    );
    expect(view.queryByText("There is no tutorial guidance on this page.")).toBeNull();
    // A battle the lesson never catches up with is not its to explain.
    act(() => vi.advanceTimersByTime(3000));
    expect(view.getByText("There is no tutorial guidance on this page.")).toBeTruthy();
    vi.useRealTimers();
  });

  it("keeps a rematch's advice on a phone beside its generic instruction", () => {
    const rematch = TUTORIAL_STEPS.findIndex(
      (step) =>
        !!(step.onCombatWin || step.onCombatLoss) &&
        typeof step.description === "string" &&
        !["combat-fight", "mission-find-pup"].includes(step.id) &&
        !step.page.startsWith("/combat"),
    );
    expect(rematch).toBeGreaterThan(-1);
    const view = show(rematch, { status: "BATTLE" }, "/combat");
    expect(
      view
        .getByText(TUTORIAL_STEPS[rematch]!.description as string)
        .className.includes("max-md:hidden"),
    ).toBe(false);
  });
});

describe("dashboard farewell", () => {
  const dashboard = TUTORIAL_STEPS.findIndex((step) => step.id === "exam-dashboard");
  const step = TUTORIAL_STEPS[dashboard]!;
  const dayOne = { dayNumber: 1, rewards: { reward_money: 100 } };
  const claimed = {
    streaks: [
      {
        streakType: "RECURRING",
        allRewards: [dayOne, { dayNumber: 2, rewards: { reward_money: 200 } }],
        canClaimToday: false,
        alreadyClaimedToday: true,
        nextDayNumber: 2,
      },
    ],
    activeRecurringConfig: null,
  };

  it("asks for the claim with no Finish while day 1 is waiting", async () => {
    state.streaks = { streaks: [], activeRecurringConfig: { rewards: [dayOne] } };
    const view = show(dashboard);
    const region = await waitFor(() => lesson(view, step.title));
    expect(region.textContent).toContain(step.action!);
    expect(view.queryByRole("button", { name: "Finish" })).toBeNull();
    fireEvent.keyDown(window, { key: "Enter" });
    await act(async () => {});
    expect(state.saveStep).not.toHaveBeenCalled();
  });

  it("says farewell and offers Finish once today's day is claimed, after a reload too", async () => {
    state.streaks = claimed;
    const view = show(dashboard);
    const region = await waitFor(() => lesson(view, step.title));
    expect(region.textContent).toContain(
      textOf(parseHtml(step.afterAction!.description)),
    );
    expect(region.textContent).toContain(step.afterAction!.action);
    expect(region.textContent).not.toContain(step.action!);
    fireEvent.click(view.getByRole("button", { name: "Finish" }));
    await waitFor(() =>
      expect(state.saveStep).toHaveBeenCalledWith({ step: dashboard + 1 }),
    );
  });

  it("says farewell when the streak has no day to claim at all", async () => {
    state.streaks = { streaks: [], activeRecurringConfig: null };
    const view = show(dashboard);
    await waitFor(() => lesson(view, step.title));
    expect(view.getByRole("button", { name: "Finish" })).toBeTruthy();
  });
});

describe("mobile game menu", () => {
  const index = TUTORIAL_STEPS.findIndex((step) => step.requiresGameMenu);
  it("guides drawer-only desktop layouts through the game-menu button", async () => {
    const view = show(
      index,
      {},
      undefined,
      <Target id="tutorial-gameBtn" box={new DOMRect(1000, 10, 44, 44)} />,
      null,
    );
    const region = await waitFor(() => lesson(view, TUTORIAL_STEPS[index]!.title));
    expect(region.textContent).toContain("Tap the highlighted menu button.");
    fireEvent.click(view.getByRole("button", { name: "Open menu" }));
    expect(state.setRightSideBarOpen).toHaveBeenCalledWith(true);
  });

  it("highlights the menu button until the drawer opens", async () => {
    const view = show(
      index,
      {},
      undefined,
      <Target id="tutorial-gameBtn" box={new DOMRect(700, 10, 40, 40)} />,
      4000,
    );
    const region = await waitFor(() => lesson(view, TUTORIAL_STEPS[index]!.title));
    expect(region.getAttribute("data-tutorial-step")).toBe(
      `menu-${TUTORIAL_STEPS[index]!.id}`,
    );
    expect(region.textContent).toContain("Tap the highlighted menu button.");
    expect(region.textContent).toContain(
      "Your new experience waits under Assign XP in the game menu.",
    );
    fireEvent.click(view.getByRole("button", { name: "Open menu" }));
    expect(state.setRightSideBarOpen).toHaveBeenCalledWith(true);
    state.setRightSideBarOpen.mockClear();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(state.setRightSideBarOpen).toHaveBeenCalledWith(true);
    expect(state.saveStep).not.toHaveBeenCalled();
  });

  it("names the location and main menus for a step without its own menu lead", async () => {
    const travel = TUTORIAL_STEPS.findIndex(
      (step) => step.requiresGameMenu && !step.gameMenuLead,
    );
    const view = show(
      travel,
      {},
      undefined,
      <Target id="tutorial-gameBtn" box={new DOMRect(700, 10, 40, 40)} />,
      4000,
    );
    const region = await waitFor(() => lesson(view, TUTORIAL_STEPS[travel]!.title));
    expect(region.textContent).toContain(
      "On phones, the location and main menus live in the game menu.",
    );
    // The reason for the step comes first, as on a wide screen.
    expect(region.textContent).toContain(
      textOf(parseHtml(String(TUTORIAL_STEPS[travel]!.description))),
    );
  });

  it("falls back to a dialog when the menu button is missing", () => {
    const view = show(index, {}, undefined, null, 4000);
    expect(view.getByText("Continue the tutorial")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Open menu" }));
    expect(state.setRightSideBarOpen).toHaveBeenCalledWith(true);
  });

  it("sends a phone to the menu for Assign XP, but not once on the page it opens", async () => {
    const assign = TUTORIAL_STEPS.findIndex((step) => step.id === "tools-assign");
    const step = TUTORIAL_STEPS[assign]!;
    const menu = show(
      assign,
      { earnedExperience: 100 },
      "/traininggrounds",
      <Target id="tutorial-gameBtn" box={new DOMRect(700, 10, 40, 40)} />,
      4000,
    );
    const prompt = await waitFor(() => lesson(menu, step.title));
    expect(prompt.getAttribute("data-tutorial-step")).toBe("menu-tools-assign");
    expect(prompt.textContent).toContain(
      "Your new experience waits under Assign XP in the game menu.",
    );
    expect(prompt.textContent).not.toContain("location and main menus");
    cleanup();
    const page = show(
      assign,
      { earnedExperience: 100 },
      "/profile/experience",
      null,
      4000,
    );
    const region = await waitFor(() => lesson(page, step.title));
    expect(region.getAttribute("data-tutorial-step")).toBe("tools-assign");
    expect(region.textContent).toContain(textOf(parseHtml(String(step.description))));
    expect(region.textContent).not.toContain("Tap the highlighted menu button.");
    // The page is already open, so the lesson asks only for the spending.
    expect(region.textContent).toContain(step.gameMenuEntryAction!);
    expect(region.textContent).not.toContain(step.action!);
  });
});

it.each(["arenaStart", "buyItem", "trainStats", "buyRamen"] as const)(
  "offers a way past a step whose %s never lands",
  async (trigger) => {
    vi.useFakeTimers();
    const index = TUTORIAL_STEPS.findIndex((step) => step.advanceOn === trigger);
    const view = show(index);
    expect(view.queryByRole("button", { name: "Next" })).toBeNull();
    expect(view.queryByRole("button", { name: "Skip this step" })).toBeNull();
    act(() => vi.advanceTimersByTime(60_000));
    expect(view.getByText("Stuck here?")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Skip this step" }));
    vi.useRealTimers();
    await waitFor(() =>
      expect(state.saveStep).toHaveBeenCalledWith({ step: index + 1 }),
    );
  },
);

describe("quest steps", () => {
  const dialogQuest = (
    questId: string,
    objectiveId: string,
    questType = "starter",
  ) => ({
    userQuests: [
      {
        id: `attempt-${questId}`,
        questId,
        endAt: null,
        completed: 0,
        quest: {
          id: questId,
          name: `Quest ${questId}`,
          questType,
          description: `About ${questId}`,
          consecutiveObjectives: true,
          content: {
            sceneCharacters: ["scene-character"],
            reward: { reward_rank: "NONE", reward_exp: 0, reward_money: 0 },
            objectives: [
              {
                id: objectiveId,
                task: "dialog",
                description: `Say yes to ${questId}`,
                sceneCharacters: [],
                nextObjectiveId: [
                  { text: "Yes", nextObjectiveId: "after" },
                  { text: "Leave" },
                ],
              },
            ],
          },
        },
      },
    ],
    questData: [{ id: questId, goals: [] }],
  });

  it("answers the related quest's dialog from the lesson", () => {
    const index = TUTORIAL_STEPS.findIndex(
      (step) => step.advanceOn === "questDialog" && !step.teachOnPage,
    );
    const step = TUTORIAL_STEPS[index]!;
    const view = showAfterIdle(
      index,
      dialogQuest(String(step.relatedValue), String(step.objectiveId)),
    );
    expect(view.getByText("Your answer")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Leave" }));
    expect(state.checkRewards).toHaveBeenCalledWith({
      questId: step.relatedValue,
      nextObjectiveId: dialogChoiceContentId(undefined, String(step.objectiveId)),
    });
    fireEvent.click(view.getByRole("button", { name: "Yes" }));
    expect(state.checkRewards).toHaveBeenLastCalledWith({
      questId: step.relatedValue,
      nextObjectiveId: "after",
    });
  });

  it("returns focus to the reopen button when the village chooser hides", () => {
    const index = TUTORIAL_STEPS.findIndex(
      (step) => step.id === TUTORIAL_VILLAGE_CHOICE_STEP_ID,
    );
    const step = TUTORIAL_STEPS[index]!;
    const view = show(
      index,
      dialogQuest(String(step.relatedValue), String(step.objectiveId)),
    );
    fireEvent.click(view.getByRole("button", { name: "Not yet, let me look around" }));
    const reopen = view.getByRole("button", { name: "Choose your village" });
    expect(document.activeElement).toBe(reopen);
  });

  it("claims a finished objective's reward from the lesson", () => {
    const index = TUTORIAL_STEPS.findIndex(
      (step) =>
        step.advanceOn === "questReward" &&
        typeof step.objectiveId === "string" &&
        !step.teachOnPage,
    );
    const step = TUTORIAL_STEPS[index]!;
    const questId = String(step.relatedValue);
    const objectiveId = String(step.objectiveId);
    const quest = (task: string, done: boolean) => ({
      userQuests: [
        {
          id: "attempt",
          questId,
          endAt: null,
          quest: {
            id: questId,
            name: "Trials",
            questType: "starter",
            consecutiveObjectives: true,
            content: {
              reward: { reward_rank: "GENIN", reward_exp: 5000, reward_money: 20000 },
              objectives: [
                {
                  id: objectiveId,
                  task,
                  description: "Train a <b>jutsu</b>",
                  reward_rank: "GENIN",
                  reward_exp: 1200,
                  reward_money: 300,
                },
              ],
            },
          },
        },
      ],
      questData: [
        { id: questId, goals: [{ id: objectiveId, done, collected: false }] },
      ],
    });
    const view = showAfterIdle(index, quest("train_jutsu", true));
    fireEvent.click(
      view.getByRole("button", { name: "Claim Genin rank + 1,200 XP + 300 ryo" }),
    );
    expect(state.checkRewards).toHaveBeenCalledWith({ questId });
    cleanup();
    // A won quest is claimed under the name its Quests entry gives the button: the
    // quest's own reward.
    fireEvent.click(
      showAfterIdle(index, quest("win_quest", true)).getByRole("button", {
        name: "Claim Genin rank + 5,000 XP + 20,000 ryo",
      }),
    );
    expect(state.checkRewards).toHaveBeenLastCalledWith({ questId });
    cleanup();
    const pending = showAfterIdle(index, quest("train_jutsu", false));
    expect(pending.getByText("Objective:", { exact: false }).textContent).toBe(
      "Objective: Train a jutsu",
    );
    expect(pending.queryByRole("button", { name: /^Claim/ })).toBeNull();
  });

  it("points at the lesson's Claim button when nothing on the page can claim", () => {
    const starterQuest = (stepIndex: number, done: boolean) => {
      const step = TUTORIAL_STEPS[stepIndex]!;
      const questId = String(step.relatedValue);
      const objectiveId = String(step.objectiveId);
      return {
        userQuests: [
          {
            id: "attempt",
            questId,
            endAt: null,
            quest: {
              id: questId,
              name: "Trials",
              questType: "starter",
              consecutiveObjectives: true,
              content: {
                reward: { reward_rank: "NONE", reward_exp: 0, reward_money: 0 },
                objectives: [
                  {
                    id: objectiveId,
                    task: "train_specific_jutsu",
                    description: "Learn Sonic Slash",
                    reward_rank: "NONE",
                    reward_exp: 1000,
                    reward_money: 0,
                  },
                ],
              },
            },
          },
        ],
        questData: [
          { id: questId, goals: [{ id: objectiveId, done, collected: false }] },
        ],
      };
    };
    // The first jutsu's reward has no logbook entry on the Training Grounds.
    const jutsuClaim = TUTORIAL_STEPS.findIndex(
      (step) => step.id === "tools-claim-jutsu",
    );
    expect(TUTORIAL_STEPS[jutsuClaim]?.elementIds ?? []).toEqual([]);
    const view = showAfterIdle(jutsuClaim, starterQuest(jutsuClaim, true));
    const claim = view.getByRole("button", { name: "Claim 1,000 XP" });
    expect(claim.closest("[data-tutorial-claim-highlight]")).toBeTruthy();
    // A claim names every reward, so a long one wraps inside the dock.
    expect(claim.className).toContain("whitespace-normal");
    expect(claim.className).not.toContain("whitespace-nowrap");
    expect(claim.className).toContain("h-auto");
    expect(overlay()).toBeTruthy();
    fireEvent.click(claim);
    expect(state.checkRewards).toHaveBeenCalledWith({
      questId: String(TUTORIAL_STEPS[jutsuClaim]?.relatedValue),
    });
    cleanup();
    // Nothing to claim yet: no dimming, no pointer.
    show(jutsuClaim, starterQuest(jutsuClaim, false));
    expect(document.querySelector("[data-tutorial-claim-highlight]")).toBeNull();
    expect(overlay()).toBeNull();
    cleanup();
    // The first fight's reward is claimed from the logbook's gift: the lesson keeps its
    // own Claim back until the player is stuck.
    vi.useFakeTimers();
    const fightClaim = TUTORIAL_STEPS.findIndex(
      (step) => step.id === "combat-claim-reward",
    );
    const fight = show(fightClaim, starterQuest(fightClaim, true));
    expect(fight.queryByRole("button", { name: "Claim 1,000 XP" })).toBeNull();
    act(() => vi.advanceTimersByTime(60_000));
    fireEvent.click(fight.getByRole("button", { name: "Claim 1,000 XP" }));
    expect(state.checkRewards).toHaveBeenLastCalledWith({
      questId: String(TUTORIAL_STEPS[fightClaim]?.relatedValue),
    });
    vi.useRealTimers();
  });

  it("teaches the first claim in the logbook and sends the rest to the lesson's Claim", () => {
    const claimSteps = TUTORIAL_STEPS.filter(
      (step) => step.advanceOn === "questReward",
    );
    const [first, ...rest] = claimSteps;
    expect(first?.id).toBe("combat-claim-reward");
    expect(first?.teachOnPage).toBe(true);
    expect(first?.elementIds).toEqual(["tutorial-objective-claim"]);
    for (const step of rest) expect(step.elementIds ?? []).toEqual([]);
  });

  it("practises assigning experience and levelling up with fewer pointers each time", () => {
    const levelSteps = TUTORIAL_STEPS.filter((step) => step.advanceOn === "levelUp");
    expect(levelSteps.map((step) => step.id)).toEqual([
      "combat-level-up",
      "tools-level-up",
      "mission-level-up",
      "genin-level-up",
    ]);
    // The first round is led page by page; later rounds run wherever the player is.
    expect(levelSteps[0]?.page).toBe("/profile/experience");
    for (const step of levelSteps.slice(1)) expect(step.page).toBe("*");
    // The second level-up points at the Level up button alone; later rounds are text only.
    expect(levelSteps[1]?.elementIds?.[0]).toBe("tutorial-level-up-experience");
    expect(levelSteps[1]?.elementIds).not.toContain("tutorial-level-up-modal-content");
    expect(levelSteps.slice(2).every((step) => !step.elementIds?.length)).toBe(true);
  });

  it("points the second briefing at its logbook entry only", () => {
    const byId = (id: string) => TUTORIAL_STEPS.find((step) => step.id === id);
    expect(byId("academy-accept-trials")?.elementIds?.[0]).toBe(
      "tutorial-dialog-options",
    );
    expect(byId("mission-brief")?.elementIds).toEqual([
      byId("academy-accept-trials")?.elementIds?.[1] ?? "",
    ]);
  });

  it("asks for a rematch after the proctor's clone wins", () => {
    const proctor = TUTORIAL_STEPS.find((step) => step.id === "exam-proctor");
    const retry = TUTORIAL_STEPS.find((step) => step.id === proctor?.onCombatLoss);
    expect(proctor?.onCombatWin).toBe("exam-tour");
    expect(retry?.id).toBe("exam-proctor-retry");
    expect(retry?.objectiveId).toBe(proctor?.objectiveId);
    expect(retry?.onCombatWin).toBe("exam-tour");
    expect(retry?.onCombatLoss).toBe("exam-proctor-retry");
  });

  it("offers a rematch from the lesson after the proctor's clone wins", () => {
    const index = TUTORIAL_STEPS.findIndex((step) => step.id === "exam-proctor-retry");
    const step = TUTORIAL_STEPS[index]!;
    const questId = String(step.relatedValue);
    const objectiveId = String(step.objectiveId);
    const lostTo = (recentlyDied: boolean) => ({
      userQuests: [
        {
          id: "attempt",
          questId,
          endAt: null,
          quest: {
            id: questId,
            name: "Road to Genin",
            questType: "starter",
            consecutiveObjectives: true,
            content: {
              reward: { reward_rank: "NONE", reward_exp: 0, reward_money: 0 },
              objectives: [
                { id: objectiveId, task: "start_battle", description: "Fight" },
              ],
            },
          },
        },
      ],
      questData: [
        { id: questId, goals: [{ id: objectiveId, done: false, recentlyDied }] },
      ],
    });
    state.retryBattle.mockClear();
    const view = show(index, lostTo(true) as never);
    fireEvent.click(view.getByRole("button", { name: "Retry battle" }));
    expect(state.retryBattle).toHaveBeenCalledWith({ questId });
    cleanup();
    // Nothing to retry before a loss.
    expect(
      show(index, lostTo(false) as never).queryByRole("button", {
        name: "Retry battle",
      }),
    ).toBeNull();
  });

  it("leaves every reward for the player to claim", () => {
    const readyQuest = (stepIndex: number, done = true) => {
      const step = TUTORIAL_STEPS[stepIndex]!;
      const questId = String(step.relatedValue);
      const objectiveId = String(step.objectiveId);
      return {
        userQuests: [
          {
            id: "attempt",
            questId,
            endAt: null,
            quest: {
              id: questId,
              name: "Trials",
              questType: "starter",
              consecutiveObjectives: true,
              content: {
                reward: { reward_rank: "NONE", reward_exp: 0, reward_money: 0 },
                objectives: [
                  {
                    id: objectiveId,
                    task: "win_combat",
                    description: "Win",
                    reward_rank: "NONE",
                    reward_exp: 1000,
                    reward_money: 0,
                  },
                ],
              },
            },
          },
        ],
        questData: [
          { id: questId, goals: [{ id: objectiveId, done, collected: false }] },
        ],
      };
    };
    const claimSteps = ["tools-claim-jutsu", "mission-claim-pup"];
    vi.useFakeTimers();
    for (const stepId of claimSteps) {
      const index = TUTORIAL_STEPS.findIndex((step) => step.id === stepId);
      const questId = String(TUTORIAL_STEPS[index]?.relatedValue);
      state.checkRewards.mockClear();
      const view = show(index, readyQuest(index));
      // Nothing is claimed while the player only reads the lesson, and the lesson's
      // own Claim waits until they have read it and then been idle for a while.
      act(() => vi.advanceTimersByTime(10_000));
      expect(state.checkRewards).not.toHaveBeenCalled();
      expect(view.queryByRole("button", { name: /^Claim / })).toBeNull();
      act(() => vi.advanceTimersByTime(idleWaitMs(index) - 10_000));
      fireEvent.click(view.getByRole("button", { name: /^Claim / }));
      expect(state.checkRewards).toHaveBeenLastCalledWith({ questId });
      cleanup();
    }
  });

  it("teaches the trip on the page and offers the lesson's trip only once stuck", () => {
    vi.useFakeTimers();
    for (const [stepId, label] of [
      ["mission-travel-to-pup", "Take me there"],
      ["bond-travel-wake", "Take me to Wake Island"],
    ] as const) {
      const index = TUTORIAL_STEPS.findIndex((step) => step.id === stepId);
      const sector = TUTORIAL_STEPS[index]?.relatedValue;
      expect(typeof sector).toBe("number");
      state.push.mockClear();
      const view = show(index, { sector: 301, level: 3 });
      expect(view.queryByRole("button", { name: label })).toBeNull();
      act(() => vi.advanceTimersByTime(60_000));
      fireEvent.click(view.getByRole("button", { name: label }));
      expect(state.push).toHaveBeenCalledWith(`/travel?sector=${sector}`);
      cleanup();
    }
    vi.useRealTimers();
  });

  it("restarts the wait for the lesson's own button whenever the player acts", () => {
    vi.useFakeTimers();
    const index = TUTORIAL_STEPS.findIndex(
      (step) => step.id === "mission-travel-to-pup",
    );
    const view = show(index, { sector: 301, level: 3 });
    act(() => vi.advanceTimersByTime(8000));
    fireEvent.pointerDown(window);
    act(() => vi.advanceTimersByTime(8000));
    expect(view.queryByRole("button", { name: "Take me there" })).toBeNull();
    act(() => vi.advanceTimersByTime(2000));
    expect(view.getByRole("button", { name: "Take me there" })).toBeTruthy();
    vi.useRealTimers();
  });

  it("folds the lesson's text once the player turns to the page, until the step changes", () => {
    const index = TUTORIAL_STEPS.findIndex(
      (step) => step.id === "mission-travel-to-pup",
    );
    const view = show(index, { sector: 301, level: 3 });
    const dock = view.container.ownerDocument.querySelector("[data-activity-dock]")!;
    // An open lesson with more than two lines, taller than half the screen.
    dock.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        right: 343,
        bottom: 812,
        width: 343,
        height: 812,
      }) as DOMRect;
    for (const lead of dock.querySelectorAll("fieldset > div")) {
      Object.defineProperty(lead, "scrollHeight", { configurable: true, value: 200 });
    }
    const folded = () => !!dock.querySelector("[data-lead-folded]");
    // A tap inside the dock is reading the lesson, not turning to the page.
    fireEvent.pointerDown(lesson(view, TUTORIAL_STEPS[index]!.title));
    expect(folded()).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(folded()).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Show all" }));
    expect(folded()).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(folded()).toBe(true);
    // The next lesson opens with all its text.
    state.profile = makeProfile(index + 1, { sector: 301, level: 3 });
    state.pathname = TUTORIAL_STEPS[index + 1]!.page.split(/[?#]/)[0]!;
    view.rerender(assistant());
    expect(folded()).toBe(false);
  });

  it("keeps the text open in a fight, where narrow docks already hide it", () => {
    const index = TUTORIAL_STEPS.findIndex((step) => step.id === "combat-fight");
    const view = show(index, { status: "BATTLE", battleId: "battle" }, "/combat");
    fireEvent.pointerDown(document.body);
    expect(view.container.ownerDocument.querySelector("[data-lead-folded]")).toBeNull();
  });

  it("counts the lesson's reading time before the idle wait while the player has not acted", () => {
    vi.useFakeTimers();
    const index = TUTORIAL_STEPS.findIndex(
      (step) => step.id === "mission-travel-to-pup",
    );
    const view = show(index, { sector: 301, level: 3 });
    act(() => vi.advanceTimersByTime(10_000));
    expect(view.queryByRole("button", { name: "Take me there" })).toBeNull();
    act(() => vi.advanceTimersByTime(idleWaitMs(index) - 10_000 - 1));
    expect(view.queryByRole("button", { name: "Take me there" })).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(view.getByRole("button", { name: "Take me there" })).toBeTruthy();
    vi.useRealTimers();
  });

  it("sends later answers and claims to the Quests tab", () => {
    for (const stepId of ["tools-claim-jutsu", "bond-return-pup", "exam-claim"]) {
      const index = TUTORIAL_STEPS.findIndex((step) => step.id === stepId);
      const step = TUTORIAL_STEPS[index]!;
      expect(step.action).toContain("Open Quests");
      expect(getQuestsTabLesson({ tutorialOn: true, tutorialStep: index })).toEqual({
        questId: String(step.relatedValue),
        marks: step.questsTab!.marks,
        prompt: step.questsTab!.prompt ?? "Claim your reward here.",
      });
      expect(getQuestsTabLesson({ tutorialOn: false, tutorialStep: index })).toBeNull();
    }
    expect(getQuestsTabLesson({ tutorialOn: true, tutorialStep: 0 })).toBeNull();
  });

  it("says on the Quests tab what each lesson sent there asks, however little it marks", () => {
    expect(
      TUTORIAL_STEPS.filter((step) => step.questsTab).map((step) => [
        step.id,
        getQuestsTabLesson({
          tutorialOn: true,
          tutorialStep: TUTORIAL_STEPS.indexOf(step),
        })?.prompt,
      ]),
    ).toEqual([
      ["tools-claim-jutsu", "Claim your reward here."],
      ["mission-claim-pup", "Claim your reward here."],
      ["bond-return-pup", "Answer to hand over the pup."],
      ["genin-debrief", "Answer here to complete the Academy Trials."],
      ["exam-tour", "Answer the proctor here."],
      ["exam-joined", "Answer the proctor here."],
      ["exam-claim", "Claim your reward here."],
    ]);
  });

  it("marks the Quests tab less each time, the first claim and the first answer in full", () => {
    expect(
      TUTORIAL_STEPS.filter((step) => step.questsTab).map((step) => [
        step.id,
        step.questsTab!.marks,
      ]),
    ).toEqual([
      ["tools-claim-jutsu", "all"],
      ["mission-claim-pup", "tab"],
      ["bond-return-pup", "all"],
      ["genin-debrief", "none"],
      ["exam-tour", "none"],
      ["exam-joined", "none"],
      ["exam-claim", "none"],
    ]);
  });

  it("answers in the logbook before the lesson offers its own answers", () => {
    vi.useFakeTimers();
    const answer = TUTORIAL_STEPS.findIndex(
      (step) => step.advanceOn === "questDialog" && step.teachOnPage,
    );
    const step = TUTORIAL_STEPS[answer]!;
    const view = show(
      answer,
      dialogQuest(String(step.relatedValue), String(step.objectiveId)),
    );
    expect(view.queryByRole("button", { name: "Yes" })).toBeNull();
    act(() => vi.advanceTimersByTime(60_000));
    expect(view.getByRole("button", { name: "Yes" })).toBeTruthy();
    vi.useRealTimers();
  });

  /** A quest whose single objective is the step's own, as the profile holds it. */
  const stepQuest = (
    index: number,
    objective: Record<string, unknown>,
    goal: Record<string, unknown> = {},
  ) => {
    const step = TUTORIAL_STEPS[index]!;
    const questId = String(step.relatedValue);
    const objectiveId = [step.objectiveId].flat()[0]!;
    return {
      userQuests: [
        {
          id: "attempt",
          questId,
          endAt: null,
          completed: 0,
          quest: {
            id: questId,
            name: "Trials",
            questType: "starter",
            consecutiveObjectives: true,
            content: {
              reward: { reward_rank: "NONE", reward_exp: 0, reward_money: 0 },
              objectives: [{ id: objectiveId, description: "Go", ...objective }],
            },
          },
        },
      ],
      questData: [{ id: questId, goals: [{ id: objectiveId, ...goal }] }],
    };
  };

  it("starts the wait for the lesson's own button once it replaces the fight's close", () => {
    vi.useFakeTimers();
    const index = TUTORIAL_STEPS.findIndex((step) => step.id === "mission-claim-pup");
    const quest = stepQuest(
      index,
      { task: "defeat_opponents", reward_exp: 1500 },
      { done: true, collected: false },
    );
    const view = show(index, quest, "/combat");
    expect(lesson(view, "Battle over")).toBeTruthy();
    act(() => vi.advanceTimersByTime(idleWaitMs(index) * 2));
    state.pathname = "/travel";
    view.rerender(assistant());
    expect(lesson(view, TUTORIAL_STEPS[index]!.title)).toBeTruthy();
    expect(view.queryByRole("button", { name: "Claim 1,500 XP" })).toBeNull();
    act(() => vi.advanceTimersByTime(idleWaitMs(index) - 1));
    expect(view.queryByRole("button", { name: "Claim 1,500 XP" })).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(view.getByRole("button", { name: "Claim 1,500 XP" })).toBeTruthy();
    vi.useRealTimers();
  });

  it("floats the dock above a waiting shortcut, so the shortcut arrives without moving its tabs", () => {
    vi.useFakeTimers();
    const height = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute("data-tutorial-pending-footer") ? 48 : 0;
      },
    });
    try {
      const index = TUTORIAL_STEPS.findIndex(
        (step) => step.id === "mission-travel-to-pup",
      );
      const view = show(index, { sector: 301, level: 3 });
      const dock = view.container.querySelector<HTMLElement>("[data-activity-dock]")!;
      const preview = dock.querySelector<HTMLElement>("[data-tutorial-pending-footer]");
      expect(preview?.textContent).toContain("Take me there");
      expect(preview?.closest("[aria-hidden]")).toBeTruthy();
      expect(view.queryByRole("button", { name: "Take me there" })).toBeNull();
      expect(dock.style.translate).toBe("0px -48px");
      act(() => vi.advanceTimersByTime(idleWaitMs(index)));
      expect(view.getByRole("button", { name: "Take me there" })).toBeTruthy();
      // The skip a stuck player is offered waits in the same way.
      const skip = dock.querySelector<HTMLElement>("[data-tutorial-pending-footer]");
      expect(skip?.textContent).toContain("Skip this step");
      expect(skip?.textContent).not.toContain("Take me there");
      expect(dock.style.translate).toBe("0px -48px");
      act(() => vi.advanceTimersByTime(60_000));
      expect(view.getByRole("button", { name: "Skip this step" })).toBeTruthy();
      expect(dock.querySelector("[data-tutorial-pending-footer]")).toBeNull();
      expect(dock.style.translate).toBe("");
    } finally {
      if (height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
      vi.useRealTimers();
    }
  });

  it("restarts the wait for a skip whenever the player acts, on a canvas too", () => {
    vi.useFakeTimers();
    const index = TUTORIAL_STEPS.findIndex((step) => step.advanceOn === "trainStats");
    // A canvas that keeps its taps to itself, as the game's maps do.
    const view = show(
      index,
      {},
      undefined,
      <canvas data-testid="map" onPointerDown={(event) => event.stopPropagation()} />,
    );
    act(() => vi.advanceTimersByTime(50_000));
    fireEvent.pointerDown(view.getByTestId("map"));
    act(() => vi.advanceTimersByTime(59_000));
    expect(view.queryByRole("button", { name: "Skip this step" })).toBeNull();
    act(() => vi.advanceTimersByTime(1_000));
    expect(view.getByRole("button", { name: "Skip this step" })).toBeTruthy();
    vi.useRealTimers();
  });

  it("holds a lesson's own button while the player taps a canvas or has a dialog open", async () => {
    vi.useFakeTimers();
    const index = TUTORIAL_STEPS.findIndex(
      (step) => step.id === "mission-travel-to-pup",
    );
    const view = show(
      index,
      { sector: 301, level: 3 },
      undefined,
      <canvas data-testid="globe" onPointerDown={(event) => event.stopPropagation()} />,
    );
    const shortcut = () => view.queryByRole("button", { name: "Take me there" });
    act(() => vi.advanceTimersByTime(idleWaitMs(index) - 1_000));
    fireEvent.pointerDown(view.getByTestId("globe"));
    act(() => vi.advanceTimersByTime(9_000));
    expect(shortcut()).toBeNull();
    // The travel confirmation opens over the page, as a Radix dialog portalled to the body.
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    act(() => document.body.append(dialog));
    act(() => vi.advanceTimersByTime(30_000));
    expect(shortcut()).toBeNull();
    act(() => dialog.remove());
    act(() => vi.advanceTimersByTime(10_000));
    expect(shortcut()).toBeTruthy();
    // A dialog opened over an offered shortcut hides it again.
    await act(async () => document.body.append(dialog));
    expect(shortcut()).toBeNull();
    await act(async () => dialog.remove());
    expect(shortcut()).toBeTruthy();
    vi.useRealTimers();
  });

  it("counts a dialog closing as the player acting, for the shortcut and the skip", async () => {
    vi.useFakeTimers();
    const index = TUTORIAL_STEPS.findIndex(
      (step) => step.id === "mission-travel-to-pup",
    );
    const view = show(index, { sector: 301, level: 3 });
    const shortcut = () => view.queryByRole("button", { name: "Take me there" });
    const skip = () => view.queryByRole("button", { name: "Skip this step" });
    // The travel confirmation stays open well past both waits, closed by no tap.
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    await act(async () => document.body.append(dialog));
    act(() => vi.advanceTimersByTime(95_000));
    expect(shortcut()).toBeNull();
    expect(skip()).toBeNull();
    await act(async () => dialog.remove());
    act(() => vi.advanceTimersByTime(9_000));
    expect(shortcut()).toBeNull();
    expect(skip()).toBeNull();
    act(() => vi.advanceTimersByTime(1_000));
    expect(shortcut()).toBeTruthy();
    act(() => vi.advanceTimersByTime(49_000));
    expect(skip()).toBeNull();
    act(() => vi.advanceTimersByTime(1_000));
    expect(skip()).toBeTruthy();
    // An offered skip leaves the screen under a dialog, like the shortcut.
    await act(async () => document.body.append(dialog));
    expect(skip()).toBeNull();
    // It waits unseen meanwhile, so it returns without moving the dock's tabs.
    expect(
      view.container.querySelector("[data-tutorial-pending-footer]")?.textContent,
    ).toContain("Skip this step");
    await act(async () => dialog.remove());
    expect(skip()).toBeTruthy();
    vi.useRealTimers();
  });

  it("folds the lesson's text for the page and for a dialog separately", async () => {
    const index = TUTORIAL_STEPS.findIndex(
      (step) => step.id === "mission-travel-to-pup",
    );
    const view = show(index, { sector: 301, level: 3 });
    const dock = view.container.ownerDocument.querySelector("[data-activity-dock]")!;
    // An open lesson with more than two lines, taller than half the screen.
    dock.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        right: 343,
        bottom: 812,
        width: 343,
        height: 812,
      }) as DOMRect;
    for (const lead of dock.querySelectorAll("fieldset > div")) {
      Object.defineProperty(lead, "scrollHeight", { configurable: true, value: 200 });
    }
    const folded = () => !!dock.querySelector("[data-lead-folded]");
    fireEvent.pointerDown(document.body);
    expect(folded()).toBe(true);
    // The tap opened a dialog: what the lesson stood in front of has moved.
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    await act(async () => document.body.append(dialog));
    expect(folded()).toBe(false);
    await act(async () => dialog.remove());
    expect(folded()).toBe(true);
  });

  it("gives a quoted objective its reading time before the lesson's own answer", () => {
    vi.useFakeTimers();
    const index = TUTORIAL_STEPS.findIndex((step) => step.id === "exam-tour");
    const step = TUTORIAL_STEPS[index]!;
    expect(step.quoteObjective).toBe(true);
    const quote = Array.from({ length: 40 }, (_, word) => `word${word}`).join(" ");
    const quest = stepQuest(index, {
      task: "dialog",
      description: quote,
      nextObjectiveId: [{ text: "Show me around", nextObjectiveId: "after" }],
    });
    const view = show(index, quest);
    expect(lesson(view, step.title).textContent).toContain(quote);
    const answer = () => view.queryByRole("button", { name: "Show me around" });
    act(() => vi.advanceTimersByTime(idleWaitMs(index)));
    expect(answer()).toBeNull();
    act(() => vi.advanceTimersByTime(lessonReadingSeconds(step, quote) * 1000));
    expect(answer()).toBeTruthy();
    vi.useRealTimers();
  });

  it("points a player who took Express Trials at the Global tab on the way home", () => {
    const index = TUTORIAL_STEPS.findIndex((step) => step.id === "exam-report");
    const step = TUTORIAL_STEPS[index]!;
    const quest = stepQuest(index, {
      task: "move_to_location",
      sector: 1335,
      longitude: 5,
      latitude: 6,
    });
    const express = show(
      index,
      { ...quest, sector: 222, playedBefore: true },
      undefined,
      <Target id="tutorial-Global" />,
    );
    expect(express.getByRole("button", { name: step.action! })).toBeTruthy();
    cleanup();
    // A player who played the trials has made two trips already.
    localStorage.setItem("expressTrialsDeclined:actor", "true");
    const trials = show(
      index,
      { ...quest, sector: 222, playedBefore: true },
      undefined,
      <Target id="tutorial-Global" />,
    );
    expect(trials.queryByRole("button", { name: step.action! })).toBeNull();
  });

  it("names where new experience waits in the phone's game menu", () => {
    const index = TUTORIAL_STEPS.findIndex((step) => step.id === "tools-assign");
    const step = TUTORIAL_STEPS[index]!;
    state.profile = makeProfile(index);
    state.pathname = "/traininggrounds";
    const view = render(assistant(4000, true));
    const region = lesson(view, step.title);
    expect(region.textContent).toContain("in the game menu");
    expect(region.textContent).not.toContain("right sidebar");
  });

  it("follows a trip under way and leaves only the walk once home", () => {
    vi.useFakeTimers();
    const index = TUTORIAL_STEPS.findIndex((step) => step.id === "exam-report");
    const step = TUTORIAL_STEPS[index]!;
    const quest = stepQuest(index, {
      task: "move_to_location",
      sector: 1335,
      longitude: 5,
      latitude: 6,
    });
    const travelling = show(index, { ...quest, status: "TRAVEL", sector: 222 });
    const region = lesson(travelling, step.title);
    expect(region.textContent).toContain("Follow your character");
    expect(region.textContent).not.toContain(step.action!);
    act(() => vi.advanceTimersByTime(120_000));
    expect(travelling.queryByText("Stuck here?")).toBeNull();
    expect(travelling.queryByRole("button", { name: "Travel home" })).toBeNull();
    cleanup();
    state.push.mockClear();
    const home = show(index, { ...quest, sector: 1335 });
    const arrived = lesson(home, step.title);
    expect(arrived.textContent).toContain(step.onArrival!.action);
    expect(arrived.textContent).toContain("Welcome home");
    expect(arrived.textContent).not.toContain("Travel home");
    act(() => vi.advanceTimersByTime(60_000));
    fireEvent.click(home.getByRole("button", { name: "Walk to the marker" }));
    expect(state.push).toHaveBeenCalledWith(
      "/travel?sector=1335&longitude=5&latitude=6",
    );
    vi.useRealTimers();
  });

  describe("after the tutorial", () => {
    const openLesson = () => {
      localStorage.setItem("activityDockOpen:actor", "true");
      localStorage.setItem("activityDockTab:actor", JSON.stringify("tutorial"));
    };

    it("leads with the story card when it outranks the quest on show", async () => {
      openLesson();
      const quest = dialogQuest(
        "high",
        "high-objective",
        OrderedQuestTypesInTutorial[0],
      );
      storyDock.card = {
        id: "story-ready-8",
        title: "Lemu is waiting",
        eyebrow: "Chapter 8 · The Ledger",
        lead: <p>Someone at the Academy archives wants to see you.</p>,
      };
      const view = show(
        TUTORIAL_STEPS_COUNT,
        { rank: "GENIN", userQuests: quest.userQuests, questData: quest.questData },
        "/profile",
      );
      const region = await waitFor(() => lesson(view, "Lemu is waiting"));
      expect(region.textContent).toContain("Chapter 8 · The Ledger");
      expect(region.textContent).not.toContain("Say yes to high");
    });

    it("fills an otherwise empty dock with the story card", async () => {
      openLesson();
      storyDock.card = {
        id: "story-next-9",
        title: "Chapter 9 at level 7",
        eyebrow: "Next · Watchtowers",
        lead: <p>1,200 experience to go.</p>,
      };
      const view = show(TUTORIAL_STEPS_COUNT, { rank: "GENIN" }, "/profile");
      const region = await waitFor(() => lesson(view, "Chapter 9 at level 7"));
      expect(region.textContent).toContain("1,200 experience to go.");
    });

    it("guides the highest-priority active quest and loads its characters", async () => {
      openLesson();
      const [first, second] = OrderedQuestTypesInTutorial;
      const low = dialogQuest("low", "low-objective", second);
      const high = dialogQuest("high", "high-objective", first);
      const view = show(
        TUTORIAL_STEPS_COUNT,
        {
          rank: "GENIN",
          userQuests: [...low.userQuests, ...high.userQuests],
          questData: [...low.questData, ...high.questData],
        },
        "/profile",
      );
      const region = await waitFor(() => lesson(view, "Quest high"));
      expect(region.getAttribute("data-tutorial-step")).toBe("quest-high");
      expect(region.textContent).toContain("Active quest");
      expect(region.textContent).toContain("Say yes to high");
      expect(region.textContent).toContain("Objectives of Quest high");
      expect(view.queryByRole("progressbar")).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Yes" }));
      expect(state.checkRewards).toHaveBeenCalledWith({
        questId: "high",
        nextObjectiveId: "after",
      });
      expect(state.sceneAssets).toHaveBeenLastCalledWith(
        { assetIds: first === "starter" ? [] : ["scene-character"] },
        { enabled: first !== "starter" },
      );

      fireEvent.click(view.getByTitle("Sort quest priorities"));
      expect(view.getByText("Quest Priority Order")).toBeTruthy();
      expect(view.queryByRole("region", { name: "Tutorial: Quest high" })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Done" }));
      expect(lesson(view, "Quest high")).toBeTruthy();

      fireEvent.click(view.getByRole("button", { name: "Hide story guidance" }));
      await waitFor(() => expect(state.disable).toHaveBeenCalledTimes(1));
    });

    it("collects a finished quest's reward while awake", async () => {
      openLesson();
      const quest = dialogQuest("done", "done-objective", "mission");
      quest.questData = [
        { id: "done", goals: [{ id: "done-objective", done: true }] },
      ] as never;
      const view = show(TUTORIAL_STEPS_COUNT, { rank: "GENIN", ...quest }, "/profile");
      await waitFor(() => lesson(view, "Quest done"));
      fireEvent.click(view.getByRole("button", { name: "Collect Reward" }));
      expect(state.checkRewards).toHaveBeenCalledWith({ questId: "done" });
      expect(state.sceneAssets).toHaveBeenLastCalledWith(
        { assetIds: ["scene-character"] },
        { enabled: true },
      );
    });

    it.each([
      [
        "the active objective's scene",
        true,
        ["objective-character"],
        ["objective-character"],
      ],
      ["the quest's scene when the objective has none", true, [], ["scene-character"]],
      [
        "the quest's scene for a quest without an objective order",
        false,
        ["objective-character"],
        ["scene-character"],
      ],
    ] as const)(
      "shows %s",
      async (_name, consecutiveObjectives, objectiveCharacters, assetIds) => {
        openLesson();
        const quest = dialogQuest("cast", "cast-objective", "mission");
        const [entry] = quest.userQuests as {
          quest: {
            consecutiveObjectives: boolean;
            description: string;
            content: { objectives: { sceneCharacters: readonly string[] }[] };
          };
        }[];
        entry!.quest.consecutiveObjectives = consecutiveObjectives;
        entry!.quest.content.objectives[0]!.sceneCharacters = objectiveCharacters;
        const view = show(
          TUTORIAL_STEPS_COUNT,
          { rank: "GENIN", ...quest },
          "/profile",
        );
        const region = await waitFor(() => lesson(view, "Quest cast"));
        expect(region.textContent).toContain(
          consecutiveObjectives ? "Say yes to cast" : "About cast",
        );
        expect(state.sceneAssets).toHaveBeenLastCalledWith(
          { assetIds },
          { enabled: true },
        );
      },
    );

    it("steps aside for a quest already shown in the logbook", async () => {
      openLesson();
      const quest = dialogQuest("listed", "listed-objective", "mission");
      const view = show(
        TUTORIAL_STEPS_COUNT,
        { rank: "GENIN", ...quest },
        "/profile",
        <div id="logbook-entry-listed" />,
      );
      await act(async () => {});
      expect(view.queryByRole("region", { name: "Tutorial: Quest listed" })).toBeNull();
      expect(
        view.getByText(
          "Tutorial complete. Quest guidance will appear here when available.",
        ),
      ).toBeTruthy();
    });
  });
});
