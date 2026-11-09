import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock, vi } from "bun:test";
import { getDefaultStore } from "jotai";
import * as navigation from "next/navigation";
import { type ReactNode, useMemo } from "react";
import * as client from "@/app/_trpc/client";
import * as sortableList from "@/components/ui/sortable-list";
import { OrderedQuestTypesInTutorial, TUTORIAL_STEPS_COUNT } from "@/drizzle/constants";
import type * as TutorialHooks from "@/hooks/tutorial";
import type * as TutorialSteps from "@/libs/tutorialSteps";
import * as abVariant from "@/hooks/useAbVariant";
import * as image from "@/layout/Image";
import * as logbook from "@/layout/Logbook";
import { chatPanelAtom } from "@/libs/chatPanel";
import { dialogChoiceContentId } from "@/libs/objectives";
import { getTutorialChapterProgress } from "@/libs/tutorial";
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
const { TUTORIAL_CHAPTERS, TUTORIAL_HOSPITALIZED_STEP, TUTORIAL_STEPS } = steps;
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
  setRightSideBarOpen: vi.fn(),
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
  spies.push(
    vi.spyOn(abVariant, "useAbVariant").mockReturnValue({ variant: "A" } as never),
  );
  spies.push(vi.spyOn(image, "default").mockImplementation((() => null) as never));
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
        useMutation: () => ({
          mutate: state.updateStep,
          mutateAsync: state.saveStep,
          isPending: false,
        }),
      },
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
  cleanup();
  vi.useRealTimers();
  for (const spy of spies.splice(0)) spy.mockRestore();
  restoreDialogs();
  restoreBrowserGlobals();
});

const assistant = (sidebarBreakpoint = 768, rightSideBarOpen = false) => (
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
  breakpoint?: number,
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

      const description = textOf(
        typeof step.description === "string"
          ? parseHtml(step.description)
          : step.description,
      );
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

      // The highlight surrounds the step's first target and only captures clicks that advance.
      const highlightButton = target
        ? view.getByRole("button", { name: step.action ?? "Continue tutorial" })
        : null;
      if (target) {
        const hole = highlightButton!.parentElement!.parentElement!;
        expect(hole.style.transform).toBe("translate(32px, 292px)");
        expect(highlightButton!.className.includes("pointer-events-auto")).toBe(
          !!step.proceedOnHighlightClick,
        );
        expect(!!overlay()?.querySelector(".animate-ping")).toBe(
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
      if (target)
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

describe("step overrides", () => {
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

  it("celebrates a formed bond and points at the new companion", () => {
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
  });

  it("explains greyed-out ramen to a player with full stamina and chakra", () => {
    const index = TUTORIAL_STEPS.findIndex((step) => step.advanceOn === "buyRamen");
    const view = show(index, { curStamina: 100, curChakra: 100 });
    const region = lesson(view, TUTORIAL_STEPS[index]!.title);
    expect(region.textContent).toContain("Your stamina and chakra are full right now");
    expect(region.textContent).toContain("Tap Next.");
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
  it("sends the player to the step's page and tries once more", async () => {
    vi.useFakeTimers();
    const index = TUTORIAL_STEPS.findIndex((step) => step.page === "/village");
    const view = show(index, {}, "/profile");
    expect(state.push).toHaveBeenCalledWith("/village");
    expect(state.setRightSideBarOpen).toHaveBeenCalledWith(false);
    expect(
      view.queryByRole("region", { name: `Tutorial: ${TUTORIAL_STEPS[index]!.title}` }),
    ).toBeNull();
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

  it("leaves an unrelated battle alone on a step outside the fight", () => {
    show(0, { status: "BATTLE", battleId: "fight" }, "/profile");
    expect(state.replace).not.toHaveBeenCalled();
  });
});

describe("highlight placement", () => {
  const index = TUTORIAL_STEPS.findIndex(
    (step) => step.id === "student-academy-building",
  );
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

describe("mobile game menu", () => {
  const index = TUTORIAL_STEPS.findIndex((step) => step.requiresGameMenu);

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
      "On phones, the location and main menus live in the game menu.",
    );
    fireEvent.click(view.getByRole("button", { name: "Open menu" }));
    expect(state.setRightSideBarOpen).toHaveBeenCalledWith(true);
    state.setRightSideBarOpen.mockClear();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(state.setRightSideBarOpen).toHaveBeenCalledWith(true);
    expect(state.saveStep).not.toHaveBeenCalled();
  });

  it("falls back to a dialog when the menu button is missing", () => {
    const view = show(index, {}, undefined, null, 4000);
    expect(view.getByText("Continue the tutorial")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Open menu" }));
    expect(state.setRightSideBarOpen).toHaveBeenCalledWith(true);
  });
});

it("offers a way past a step whose action never lands", async () => {
  vi.useFakeTimers();
  const index = TUTORIAL_STEPS.findIndex((step) => step.advanceOn === "arenaStart");
  const view = show(index);
  expect(view.queryByRole("button", { name: "Skip this step" })).toBeNull();
  act(() => vi.advanceTimersByTime(60_000));
  expect(view.getByText("Stuck here?")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Skip this step" }));
  vi.useRealTimers();
  await waitFor(() => expect(state.saveStep).toHaveBeenCalledWith({ step: index + 1 }));
});

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
    const index = TUTORIAL_STEPS.findIndex((step) => step.advanceOn === "questDialog");
    const step = TUTORIAL_STEPS[index]!;
    const view = show(
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

  it("claims a finished objective's reward from the lesson", () => {
    const index = TUTORIAL_STEPS.findIndex(
      (step) =>
        step.advanceOn === "questReward" && typeof step.objectiveId === "string",
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
              reward: { reward_rank: "NONE", reward_exp: 0, reward_money: 0 },
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
    const view = show(index, quest("train_jutsu", true));
    fireEvent.click(
      view.getByRole("button", { name: "Claim Genin rank + 1,200 XP + 300 ryo" }),
    );
    expect(state.checkRewards).toHaveBeenCalledWith({ questId });
    cleanup();
    // Winning pays the quest's own reward, here nothing beyond the finished quest.
    fireEvent.click(
      show(index, quest("win_quest", true)).getByRole("button", {
        name: "Claim reward",
      }),
    );
    expect(state.checkRewards).toHaveBeenLastCalledWith({ questId });
    cleanup();
    const pending = show(index, quest("train_jutsu", false));
    expect(pending.getByText("Objective:", { exact: false }).textContent).toBe(
      "Objective: Train a jutsu",
    );
    expect(pending.queryByRole("button", { name: /^Claim/ })).toBeNull();
  });

  describe("after the tutorial", () => {
    const openLesson = () => {
      localStorage.setItem("activityDockOpen:actor", "true");
      localStorage.setItem("activityDockTab:actor", JSON.stringify("tutorial"));
    };

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

      fireEvent.click(view.getByRole("button", { name: "Skip tutorial" }));
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
