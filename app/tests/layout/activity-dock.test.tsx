import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { getDefaultStore } from "jotai";
import { ActivityDock } from "@/layout/ActivityDock";
import * as logbook from "@/layout/Logbook";
import { chatPanelAtom } from "@/libs/chatPanel";
import * as context from "@/utils/UserContext";

const eventDescriptor = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
let user: { userId: string; tutorialOn: boolean; tutorialStep: number; userQuests: unknown[]; questData: unknown[] };
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: window.CustomEvent });
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  user = { userId: "dock-reader", tutorialOn: true, tutorialStep: 0, userQuests: [], questData: [] };
  vi.spyOn(context, "useUserData").mockImplementation(() => ({ data: user }) as never);
  vi.spyOn(logbook, "LogbookEntry").mockImplementation(({ userQuest }) => <p>Progress for {userQuest.quest.name}</p>);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  if (eventDescriptor) Object.defineProperty(globalThis, "CustomEvent", eventDescriptor);
  else Reflect.deleteProperty(globalThis, "CustomEvent");
});

it("persists the chosen side and collapsed state without disabling the tutorial", () => {
  const view = render(<ActivityDock>Saved lesson</ActivityDock>);
  expect(view.getByText("Saved lesson")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Swap Chat and Activity sides" }));
  expect(view.getByRole("complementary", { name: "Activity" }).className).toContain("right-4");
  fireEvent.click(view.getByRole("button", { name: "Collapse Activity" }));
  expect(view.queryByText("Saved lesson")).toBeNull();
  expect(user.tutorialOn).toBe(true);
  view.unmount();
  const reopened = render(<ActivityDock>Saved lesson</ActivityDock>);
  expect(reopened.getByRole("button", { name: "Open Activity" })).toBeTruthy();
  expect(reopened.getByRole("complementary", { name: "Activity" }).className).toContain("right-4");
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

it("reveals the lesson when the player re-enables the tutorial in Settings", () => {
  user.tutorialOn = false;
  const view = render(<ActivityDock>Saved lesson</ActivityDock>);
  expect(view.getByRole("button", { name: "Open Activity" })).toBeTruthy();
  user = { ...user, tutorialOn: true };
  view.rerender(<ActivityDock>Saved lesson</ActivityDock>);
  expect(view.getByText("Saved lesson")).toBeTruthy();
  expect(view.getByRole("tab", { name: "Tutorial" }).getAttribute("aria-selected")).toBe("true");
});

it("pins active quest attempts, restores pins, and removes completed attempts from the list", () => {
  const quest = (id: string, name: string) => ({ id: `attempt-${id}`, questId: id, endAt: null, quest: { id, name, questType: "mission" } });
  user.userQuests = [quest("first", "First mission"), quest("second", "Second mission")];
  user.questData = [{ id: "first" }, { id: "second" }];
  const view = render(<ActivityDock>Lesson</ActivityDock>);
  fireEvent.mouseDown(view.getByRole("tab", { name: "Quests" }), { button: 0, ctrlKey: false });
  expect(view.queryByText("Lesson")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Pin Second mission" }));
  expect(view.getByText("Progress for Second mission")).toBeTruthy();
  expect(view.container.querySelector("article")?.textContent).toContain("Second mission");
  view.unmount();
  const reopened = render(<ActivityDock>Lesson</ActivityDock>);
  expect(reopened.getByRole("button", { name: "Unpin Second mission" }).getAttribute("aria-pressed")).toBe("true");
  expect(reopened.getByText("Progress for Second mission")).toBeTruthy();
  user.userQuests = [quest("first", "First mission"), { ...quest("second", "Second mission"), endAt: new Date() }];
  reopened.rerender(<ActivityDock>Lesson</ActivityDock>);
  expect(reopened.queryByRole("button", { name: "Unpin Second mission" })).toBeNull();
});
