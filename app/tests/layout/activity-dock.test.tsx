import { afterEach, beforeEach, expect, it, mock, vi } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import * as storyGuidanceHook from "@/hooks/useStoryGuidance";
import { ActivityDock } from "@/layout/ActivityDock";
import { ActivityDockButton } from "@/layout/ActivityDockButton";
import * as logbook from "@/layout/Logbook";
import { chatPanelAtom } from "@/libs/chatPanel";
import { getQuestsTabLesson } from "@/libs/questsTabLesson";
import * as storyGuidance from "@/libs/storyGuidance";
import type * as TutorialSteps from "@/libs/tutorialSteps";
import * as routing from "@/utils/routing";
import * as context from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

// Another assistant suite replaces the steps with one synthetic step, and Bun keeps
// module mocks across files. A query-suffixed import loads the real definitions again.
const realStepsPath = "../../src/libs/tutorialSteps.tsx?real";
const steps = (await import(realStepsPath)) as typeof TutorialSteps;
mock.module("@/libs/tutorialSteps", () => steps);
const { TUTORIAL_STEPS } = steps;

let user: {
  userId: string;
  rank?: string;
  tutorialOn: boolean;
  tutorialStep: number;
  status?: string;
  userQuests: unknown[];
  questData: unknown[];
};
beforeEach(() => {
  localStorage.clear();
  installBrowserGlobals({ events: ["CustomEvent"], resizeObserver: true });
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  user = {
    userId: "dock-reader",
    tutorialOn: true,
    tutorialStep: 0,
    userQuests: [],
    questData: [],
  };
  vi.spyOn(context, "useUserDataSelector").mockImplementation(
    (select) => ({ data: select(user as never) }) as never,
  );
  vi.spyOn(logbook, "LogbookEntry").mockImplementation(({ userQuest }) => (
    <p id="tutorial-objective-claim">Progress for {userQuest.quest.name}</p>
  ));
});

it("opens the same lesson from mobile navigation, closes chat, and retains a guided tab choice", () => {
  user.tutorialOn = false;
  const view = render(
    <>
      <MobileGameNav
        mobileNavConfig={DEFAULT_MOBILE_NAV_CONFIG}
        yellowButtonClassName="size-6"
        mobileNavbarButtonClassName="size-6"
      />
      <ActivityDock guidedLesson={{ id: "mobile-lesson", awaitsAnswer: false }}>
        Mobile lesson
      </ActivityDock>
    </>,
  );
  const toggle = view.getByRole("button", { name: "Activity" });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const panelId = toggle.getAttribute("aria-controls");
  expect(
    panelId &&
      document
        .getElementById(panelId)
        ?.contains(view.getByRole("tab", { name: "Tutorial" })),
  ).toBe(true);
  fireEvent.click(toggle);
  expect(view.queryByText("Mobile lesson")).toBeNull();
  act(() => getDefaultStore().set(chatPanelAtom, { owner: "chat", tab: "inbox" }));
  fireEvent.click(toggle);
  expect(getDefaultStore().get(chatPanelAtom).owner).toBeNull();
  expect(view.getByText("Mobile lesson")).toBeTruthy();
  expect(document.activeElement?.textContent).toBe("Tutorial");
  fireEvent.mouseDown(view.getByRole("tab", { name: "Quests" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  expect(view.getByRole("tab", { name: "Quests" }).getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(view.getByText("No active quests or missions.")).toBeTruthy();
  expect(document.activeElement?.textContent).toBe("Quests");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  restoreBrowserGlobals();
  document.documentElement.removeAttribute("data-mobile-activity-nav");
});

it("returns focus to the bottom Activity control when collapsed", () => {
  document.documentElement.setAttribute("data-mobile-activity-nav", "true");
  localStorage.setItem(`activityDockOpen:${user.userId}`, "false");
  const view = render(
    <>
      <ActivityDockButton />
      <ActivityDock>Desktop lesson</ActivityDock>
    </>,
  );
  const trigger = view.getByRole("button", { name: "Activity" });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  expect(view.getByText("Desktop lesson")).toBeTruthy();
  expect(document.activeElement?.textContent).toBe("Tutorial");
  fireEvent.click(view.getByRole("button", { name: "Collapse Activity" }));
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("persists the chosen side and collapsed state without disabling the tutorial", () => {
  const view = render(<ActivityDock>Saved lesson</ActivityDock>);
  expect(view.getByText("Saved lesson")).toBeTruthy();
  expect(
    view
      .getByRole("complementary", { name: "Activity" })
      .hasAttribute("data-battle-focus-layer"),
  ).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Swap Chat and Activity sides" }));
  expect(view.getByRole("complementary", { name: "Activity" }).className).toContain(
    "right-4",
  );
  fireEvent.click(view.getByRole("button", { name: "Collapse Activity" }));
  expect(view.queryByText("Saved lesson")).toBeNull();
  expect(
    view
      .getByRole("complementary", { name: "Activity" })
      .hasAttribute("data-battle-focus-layer"),
  ).toBe(false);
  expect(user.tutorialOn).toBe(true);
  view.unmount();
  const reopened = render(<ActivityDock>Saved lesson</ActivityDock>);
  expect(reopened.getByRole("button", { name: "Open Activity" })).toBeTruthy();
  expect(reopened.getByRole("complementary", { name: "Activity" }).className).toContain(
    "right-4",
  );
  fireEvent.click(reopened.getByRole("button", { name: "Open Activity" }));
  expect(reopened.getByText("Saved lesson")).toBeTruthy();
});

it("sits on the right in a tutorial fight, beside the free end of the action bar", () => {
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/combat");
  const view = render(<ActivityDock>Fight lesson</ActivityDock>);
  const dock = view.getByRole("complementary", { name: "Activity" });
  expect([...dock.classList]).toContain("right-4");
  expect([...dock.classList]).not.toContain("left-4");
  expect(
    view.queryByRole("button", { name: "Swap Chat and Activity sides" }),
  ).toBeNull();
});

it("keeps the player's own side in a fight outside the tutorial", () => {
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/combat");
  user.tutorialOn = false;
  const view = render(<ActivityDock>Fight lesson</ActivityDock>);
  const dock = view.getByRole("complementary", { name: "Activity" });
  expect([...dock.classList]).toContain("left-4");
  fireEvent.click(view.getByRole("button", { name: "Open Activity" }));
  fireEvent.click(view.getByRole("button", { name: "Swap Chat and Activity sides" }));
  expect([...dock.classList]).toContain("right-4");
});

it("keeps a reachable Activity launcher while chatting and can return to the lesson", () => {
  const view = render(<ActivityDock>Saved lesson</ActivityDock>);
  act(() => getDefaultStore().set(chatPanelAtom, { owner: "chat", tab: "tavern" }));
  expect(view.queryByText("Saved lesson")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Open Activity" }));
  expect(getDefaultStore().get(chatPanelAtom).owner).toBeNull();
  expect(view.getByText("Saved lesson")).toBeTruthy();
});

it("runs the hidden-lesson fallback whenever the lesson is out of view", () => {
  const view = render(
    <ActivityDock hiddenLesson="Hidden sync">Saved lesson</ActivityDock>,
  );
  expect(view.queryByText("Hidden sync")).toBeNull();
  act(() => getDefaultStore().set(chatPanelAtom, { owner: "chat", tab: "tavern" }));
  expect(view.getByText("Hidden sync")).toBeTruthy();
  act(() => getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" }));
  fireEvent.click(view.getByRole("button", { name: "Collapse Activity" }));
  expect(view.queryByText("Saved lesson")).toBeNull();
  expect(view.getByText("Hidden sync")).toBeTruthy();
});

it("reveals the lesson when the player re-enables the tutorial in Settings", () => {
  user.tutorialOn = false;
  const view = render(<ActivityDock>Saved lesson</ActivityDock>);
  expect(view.getByRole("button", { name: "Open Activity" })).toBeTruthy();
  user = { ...user, tutorialOn: true };
  view.rerender(<ActivityDock>Saved lesson</ActivityDock>);
  expect(view.getByText("Saved lesson")).toBeTruthy();
  expect(
    view.getByRole("tab", { name: "Tutorial" }).getAttribute("aria-selected"),
  ).toBe("true");
});

it("opens a guided lesson on the tutorial tab without changing the stored dock state", () => {
  user.tutorialOn = false;
  const view = render(
    <ActivityDock hiddenLesson="Hidden sync">Main lesson</ActivityDock>,
  );
  expect(view.getByRole("button", { name: "Open Activity" })).toBeTruthy();
  view.rerender(
    <ActivityDock
      hiddenLesson="Hidden sync"
      guidedLesson={{ id: "lesson-1", awaitsAnswer: false }}
    >
      Guided step
    </ActivityDock>,
  );
  // A guided lesson shows even with the main tutorial off, above the page's dim.
  expect(view.getByText("Guided step")).toBeTruthy();
  const dock = view.getByRole("complementary", { name: "Activity" });
  expect(dock.hasAttribute("data-battle-focus-layer")).toBe(true);
  expect(dock.className).toContain("z-[61]");
  // The main tutorial's fallback keeps running while the guided lesson has the tab.
  expect(view.getByText("Hidden sync")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Collapse Activity" }));
  expect(view.queryByText("Guided step")).toBeNull();
  // The collapse holds through the lesson's steps.
  view.rerender(
    <ActivityDock
      hiddenLesson="Hidden sync"
      guidedLesson={{ id: "lesson-1", awaitsAnswer: false }}
    >
      Next guided step
    </ActivityDock>,
  );
  expect(view.queryByText("Next guided step")).toBeNull();
  // A step that awaits an answer shows through the collapse and the chat panel.
  act(() => getDefaultStore().set(chatPanelAtom, { owner: "chat", tab: "tavern" }));
  view.rerender(
    <ActivityDock
      hiddenLesson="Hidden sync"
      guidedLesson={{ id: "lesson-1", awaitsAnswer: true }}
    >
      Pass now?
    </ActivityDock>,
  );
  expect(view.getByText("Pass now?")).toBeTruthy();
  act(() => getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" }));
  view.rerender(
    <ActivityDock
      hiddenLesson="Hidden sync"
      guidedLesson={{ id: "lesson-1", awaitsAnswer: false }}
    >
      Next guided step
    </ActivityDock>,
  );
  expect(view.queryByText("Next guided step")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Open Activity" }));
  expect(view.getByText("Next guided step")).toBeTruthy();
  // Another lesson opens again; the stored state is still the player's own.
  view.rerender(
    <ActivityDock
      hiddenLesson="Hidden sync"
      guidedLesson={{ id: "lesson-2", awaitsAnswer: false }}
    >
      Second lesson
    </ActivityDock>,
  );
  expect(view.getByText("Second lesson")).toBeTruthy();
  view.rerender(<ActivityDock hiddenLesson="Hidden sync">Main lesson</ActivityDock>);
  expect(view.getByRole("button", { name: "Open Activity" })).toBeTruthy();
});

it("raises no story news for a Genin who turned the tutorial off", () => {
  user = { ...user, rank: "GENIN", tutorialOn: false };
  vi.spyOn(storyGuidanceHook, "useStoryGuidance").mockReturnValue({
    item: {},
  } as never);
  vi.spyOn(storyGuidance, "getDockAttentionKey").mockReturnValue("chapter-8");
  const view = render(<ActivityDock>Saved lesson</ActivityDock>);
  expect(view.getByRole("button", { name: "Open Activity" }).textContent).toBe(
    "Activity",
  );
  expect(view.queryByText("Story news")).toBeNull();
});

it("pins active quest attempts, restores pins, and removes completed attempts from the list", () => {
  const quest = (id: string, name: string) => ({
    id: `attempt-${id}`,
    questId: id,
    endAt: null,
    quest: { id, name, questType: "mission" },
  });
  user.userQuests = [
    quest("first", "First mission"),
    quest("second", "Second mission"),
  ];
  user.questData = [{ id: "first" }, { id: "second" }];
  const view = render(<ActivityDock>Lesson</ActivityDock>);
  fireEvent.mouseDown(view.getByRole("tab", { name: "Quests" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(view.queryByText("Lesson")).toBeNull();
  expect(
    view
      .getByRole("complementary", { name: "Activity" })
      .hasAttribute("data-battle-focus-layer"),
  ).toBe(false);
  fireEvent.click(view.getByRole("button", { name: "Pin Second mission" }));
  expect(view.getByText("Progress for Second mission")).toBeTruthy();
  expect(view.container.querySelector("article")?.textContent).toContain(
    "Second mission",
  );
  view.unmount();
  const reopened = render(<ActivityDock>Lesson</ActivityDock>);
  expect(
    reopened
      .getByRole("button", { name: "Unpin Second mission" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(reopened.getByText("Progress for Second mission")).toBeTruthy();
  user.userQuests = [
    quest("first", "First mission"),
    { ...quest("second", "Second mission"), endAt: new Date() },
  ];
  reopened.rerender(<ActivityDock>Lesson</ActivityDock>);
  expect(reopened.queryByRole("button", { name: "Unpin Second mission" })).toBeNull();
});

/** Puts the player on a Quests-tab lesson, the first by default; returns its quest id. */
const onQuestsTabLesson = (
  index = TUTORIAL_STEPS.findIndex((step) => step.questsTab),
) => {
  const questId = String(TUTORIAL_STEPS[index]!.relatedValue);
  user.tutorialStep = index;
  user.userQuests = [
    lessonQuest("other", "Other mission"),
    lessonQuest(questId, "The Trials"),
  ];
  user.questData = [
    { id: "other", goals: [] },
    { id: questId, goals: [{ id: "a", done: true, collected: false }] },
  ];
  return questId;
};
const lessonQuest = (id: string, name: string) => ({
  id: `attempt-${id}`,
  questId: id,
  endAt: null,
  quest: { id, name, questType: "starter" },
});

it("leads a lesson's answer or claim through the Quests tab and hands back after it", () => {
  const questId = onQuestsTabLesson();
  const view = render(<ActivityDock>Lesson</ActivityDock>);
  const questsTab = view.getByRole("tab", { name: "Quests" });
  expect(questsTab.closest("[data-tutorial-dock-highlight]")).toBeTruthy();
  fireEvent.mouseDown(questsTab, { button: 0, ctrlKey: false });
  expect(view.getByText(getQuestsTabLesson(user)!.prompt)).toBeTruthy();
  // The lesson's quest comes first, already open.
  const first = view.container.querySelector("article");
  expect(first?.textContent).toContain("The Trials");
  expect(view.getByText("Progress for The Trials")).toBeTruthy();
  // Claiming moves the quest on, and the dock returns to the lesson.
  user.questData = [
    { id: "other", goals: [] },
    { id: questId, goals: [{ id: "a", done: true, collected: true }] },
  ];
  view.rerender(<ActivityDock>Lesson</ActivityDock>);
  expect(view.getByText("Lesson")).toBeTruthy();
});

it.each(
  TUTORIAL_STEPS.flatMap((step, index) => (step.questsTab ? [[step.id, index]] : [])),
)("dims the page and points at the Quests tab for %s", (_, index) => {
  const step = TUTORIAL_STEPS[Number(index)]!;
  onQuestsTabLesson(Number(index));
  vi.spyOn(routing, "usePublicPathname").mockReturnValue(
    step.page === "*" ? "/profile" : step.page,
  );
  const view = render(<ActivityDock>Lesson</ActivityDock>);
  const dim = () =>
    document.querySelector("body > [data-battle-focus-layer][aria-hidden]");
  const questsTab = view.getByRole("tab", { name: "Quests" });
  expect(questsTab.closest("[data-tutorial-dock-highlight]")).toBeTruthy();
  expect(dim()).toBeTruthy();
  fireEvent.mouseDown(questsTab, { button: 0, ctrlKey: false });
  expect(document.querySelector("[data-tutorial-dock-highlight]")).toBeNull();
  expect(dim()).toBeNull();
  expect(view.getByText(getQuestsTabLesson(user)!.prompt)).toBeTruthy();
});

it("leaves the Quests tab unmarked where the lesson points elsewhere", () => {
  for (const [path, status] of [
    ["/combat", "AWAKE"],
    ["/pets", "HOSPITALIZED"],
  ]) {
    onQuestsTabLesson();
    vi.spyOn(routing, "usePublicPathname").mockReturnValue(path!);
    user.status = status!;
    const view = render(<ActivityDock>Lesson</ActivityDock>);
    expect(view.getByText("Lesson")).toBeTruthy();
    expect(document.querySelector("[data-tutorial-dock-highlight]")).toBeNull();
    view.unmount();
  }
});

it("spotlights the claim and its callout in the Quests tab", () => {
  onQuestsTabLesson();
  const rect = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "getBoundingClientRect",
  );
  HTMLElement.prototype.getBoundingClientRect = () => new DOMRect(10, 20, 200, 40);
  try {
    const view = render(<ActivityDock>Lesson</ActivityDock>);
    fireEvent.mouseDown(view.getByRole("tab", { name: "Quests" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(document.querySelector("[data-spotlight-keep]")).toBeTruthy();
    // The callout is uncovered beside the claim, and wears no ring of its own.
    expect(document.querySelectorAll('mask rect[fill="black"]').length).toBe(2);
    expect(document.querySelectorAll(".border-dashed").length).toBe(0);
  } finally {
    if (rect)
      Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", rect);
    else Reflect.deleteProperty(HTMLElement.prototype, "getBoundingClientRect");
  }
});

it("brings the claim into view when Quests opens", () => {
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/traininggrounds");
  onQuestsTabLesson();
  vi.spyOn(logbook, "LogbookEntry").mockImplementation(() => (
    <div data-quest-claim="">Claim reward</div>
  ));
  // The claim sits 120px below the bottom of the scrolling list.
  const rect = (top: number, bottom: number) => new DOMRect(0, top, 200, bottom - top);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.questClaim === undefined ? rect(0, 440) : rect(500, 560);
  });
  const view = render(<ActivityDock>Lesson</ActivityDock>);
  fireEvent.mouseDown(view.getByRole("tab", { name: "Quests" }), {
    button: 0,
    ctrlKey: false,
  });
  const panel = view.getByRole("tabpanel");
  // Its ring has room under it.
  expect(panel.scrollTop).toBe(132);
  // Later updates leave the player's own scrolling alone.
  panel.scrollTop = 0;
  view.rerender(<ActivityDock>Lesson</ActivityDock>);
  expect(panel.scrollTop).toBe(0);
});

it("gives Quests the lesson's height on a phone and the lesson's text size when narrow", () => {
  const offsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 330,
  });
  try {
    const view = render(<ActivityDock>Lesson</ActivityDock>);
    fireEvent.mouseDown(view.getByRole("tab", { name: "Quests" }), {
      button: 0,
      ctrlKey: false,
    });
    const panel = view.getByRole("tabpanel");
    expect(panel.style.getPropertyValue("--activity-dock-lesson-height")).toBe("330px");
    expect(panel.className).toContain(
      "max-md:h-[max(var(--activity-dock-lesson-height),16rem)]",
    );
    expect(panel.className).toContain("@max-[34rem]/dock:[&_.text-sm]:text-lg");
  } finally {
    if (offsetHeight)
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
  }
});

it("keeps the Story tab after the tutorial below the page's dialogs", () => {
  user = { ...user, rank: "GENIN", tutorialStep: TUTORIAL_STEPS.length };
  const view = render(<ActivityDock>Story so far</ActivityDock>);
  fireEvent.click(view.getByRole("button", { name: "Open Activity" }));
  expect(view.getByText("Story so far")).toBeTruthy();
  expect(view.getByRole("complementary", { name: "Activity" }).className).not.toContain(
    "z-[61]",
  );
});

it("steps a lesson below a modal it does not teach, and stays above one it does", async () => {
  const target = TUTORIAL_STEPS.findIndex((step) => !!step.elementIds?.length);
  user.tutorialStep = target;
  const view = render(<ActivityDock>Lesson</ActivityDock>);
  const dock = view.getByRole("complementary", { name: "Activity" });
  expect(dock.className).toContain("z-[61]");
  // A modal dialog hides the rest of the page, the dock included.
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("data-state", "open");
  await act(async () => {
    document.body.append(dialog);
    view.container.setAttribute("aria-hidden", "true");
  });
  expect(dock.className).not.toContain("z-[61]");
  // The lesson's own target inside the dialog keeps the lesson on top.
  const taught = document.createElement("button");
  taught.id = TUTORIAL_STEPS[target]!.elementIds![0]!;
  await act(async () => {
    dialog.append(taught);
  });
  expect(dock.className).toContain("z-[61]");
  await act(async () => {
    dialog.remove();
    view.container.removeAttribute("aria-hidden");
  });
  expect(dock.className).toContain("z-[61]");
});

it("fits the open dock to the gutter beside the centre column on a wide screen", () => {
  const column = document.createElement("div");
  column.setAttribute("data-reading-surface", "");
  document.body.append(column);
  const matchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query === "(min-width: 1280px)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as never;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return (
      this === column
        ? { left: 358, right: 1058, width: 700 }
        : { left: 15, right: 435, width: 420 }
    ) as DOMRect;
  });
  try {
    const view = render(<ActivityDock>Lesson</ActivityDock>);
    const panel = view.container.querySelector<HTMLElement>(
      "[data-activity-dock] > div",
    );
    expect(panel?.style.width).toBe("min(var(--activity-dock-width, 420px), 335px)");
  } finally {
    window.matchMedia = matchMedia;
    column.remove();
  }
});

it("returns from Quests to the lesson when the step moves on there", () => {
  user.tutorialStep = TUTORIAL_STEPS.findIndex((step) => !step.questsTab);
  const view = render(<ActivityDock>Lesson</ActivityDock>);
  fireEvent.mouseDown(view.getByRole("tab", { name: "Quests" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(view.queryByText("Lesson")).toBeNull();
  // A lesson that does not send the player here leaves the tab its own hint.
  expect(
    view.getByText("Pin the objectives you want to keep at the top."),
  ).toBeTruthy();
  user.tutorialStep += 1;
  view.rerender(<ActivityDock>Lesson</ActivityDock>);
  expect(view.getByText("Lesson")).toBeTruthy();
});

it("keeps Quests open on a new step answered there, showing that step's prompt", () => {
  const index = TUTORIAL_STEPS.findIndex((step) => step.questsTab);
  onQuestsTabLesson();
  user.tutorialStep = index - 1;
  const view = render(<ActivityDock>Lesson</ActivityDock>);
  fireEvent.mouseDown(view.getByRole("tab", { name: "Quests" }), {
    button: 0,
    ctrlKey: false,
  });
  user.tutorialStep = index;
  view.rerender(<ActivityDock>Lesson</ActivityDock>);
  expect(view.queryByText("Lesson")).toBeNull();
  expect(view.getByText(getQuestsTabLesson(user)!.prompt)).toBeTruthy();
});
