import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { MobileGameNav } from "@/components/layout/shared/MobileGameNav";
import { ActivityDock } from "@/layout/ActivityDock";
import { ActivityDockButton } from "@/layout/ActivityDockButton";
import * as logbook from "@/layout/Logbook";
import { chatPanelAtom } from "@/libs/chatPanel";
import { DEFAULT_MOBILE_NAV_CONFIG } from "@/libs/mobileNavConfig";
import * as context from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

let user: {
  userId: string;
  tutorialOn: boolean;
  tutorialStep: number;
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
    <p>Progress for {userQuest.quest.name}</p>
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
