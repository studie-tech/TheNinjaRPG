import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { getDefaultStore } from "jotai";
import { chatPanelAtom } from "@/libs/chatPanel";
import { type ReactNode, useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as dialogComponents from "@/components/ui/dialog";
import * as sortableList from "@/components/ui/sortable-list";
import type { TutorialStepConfig } from "@/hooks/tutorial";
import * as mediaQuery from "@/hooks/useMediaQuery";
import { BattleFocusView } from "@/layout/BattleFocusView";
import * as objective from "@/layout/Objective";
import TutorialAssistant from "@/layout/TutorialAssistant";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { UserPatch } from "@/deltas/profile";
import * as routing from "@/utils/routing";
import { updateUserCache } from "@/utils/userCache";
import * as UserContext from "@/utils/UserContext";

const key = [["profile", "getUser"], { type: "query" }];
const profile = (money = 100, userId = "actor", tutorialOn = true) => ({
  userData: { userId, money, tutorialOn, tutorialStep: 0, status: "AWAKE", level: 2 } as NonNullable<UserWithRelations>,
});
function testMocks() {
  const globals = globalThis as typeof globalThis & { __tutorialAssistantMocks?: {
    client: QueryClient;
    disable: ReturnType<typeof vi.fn<() => Promise<{ success: boolean; message: string }>>>;
    updateUser: ReturnType<typeof vi.fn<(patch: UserPatch) => Promise<void>>>;
    rewardHook: ReturnType<typeof vi.fn>;
    step: TutorialStepConfig;
    stepNumber: number;
    visible: boolean;
    next: ReturnType<typeof vi.fn>;
  } };
  globals.__tutorialAssistantMocks ??= {
    client: new QueryClient(),
    disable: vi.fn(async () => ({ success: true, message: "Saved" })),
    updateUser: vi.fn(async (patch: UserPatch) => { await updateUserCache(testMocks().client, key, patch); }),
    rewardHook: vi.fn(),
    step: { id: "welcome", chapter: "student", title: "Welcome", description: "Welcome", page: "/profile" },
    next: vi.fn(), stepNumber: 0, visible: true,
  };
  return globals.__tutorialAssistantMocks;
}
const mocks = testMocks();
vi.mock("@/app/_trpc/client", () => ({ api: {
  useUtils: () => ({ profile: { getUser: {
    cancel: () => testMocks().client.cancelQueries({ queryKey: key, exact: true }),
    setData: (_input: unknown, updater: (old: ReturnType<typeof profile> | undefined) => ReturnType<typeof profile> | undefined) => testMocks().client.setQueryData(key, updater),
  } } }),
  profile: { updatePreferences: { useMutation: () => ({ mutateAsync: testMocks().disable }) } },
  gameAsset: { getSceneAssets: { useQuery: () => ({ data: [] }) } },
} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/utils/routing", () => ({ usePublicPathname: () => "/profile" }));
vi.mock("@/hooks/tutorial", () => {
  const step = { id: "welcome", chapter: "student", title: "Welcome", description: "Welcome", page: "/profile" };
  return { TUTORIAL_STEPS: [step], TUTORIAL_CHAPTERS: [{ id: "student", title: "A New Student" }], TUTORIAL_HOSPITALIZED_STEP: step, useTutorialStep: () => ({ currentStep: testMocks().step, stepNumber: testMocks().stepNumber, isAssistantVisible: testMocks().visible, setIsAssistantVisible: vi.fn(), updateTutorialStep: vi.fn(), handleNextStep: testMocks().next, handleNextStepAsync: vi.fn(async () => {}), completeTutorialAction: vi.fn(async () => {}) }) };
});
vi.mock("@/hooks/useAbVariant", () => ({ useAbVariant: () => ({ variant: "A" }) }));
vi.mock("@/layout/Logbook", () => ({ LogbookEntry: () => null, useCheckRewards: () => {
  testMocks().rewardHook();
  return { checkRewards: vi.fn(), isCheckingRewards: false };
} }));
vi.mock("@/layout/Image", () => ({ default: () => null }));
const dialogContent = ({ children }: { children: ReactNode }) => <div>{children}</div>;
const dialogMocks = { Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div role="dialog">{children}</div> : null, DialogContent: dialogContent, DialogDescription: dialogContent, DialogHeader: dialogContent, DialogTitle: dialogContent };
const componentSpies: { mockRestore: () => void }[] = [];

let close: (() => void) | undefined;
const animationFrame = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
const customEvent = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
// The assistant re-places Lemu's portrait whenever its dock resizes.
const resizeObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
beforeEach(() => {
  componentSpies.push(vi.spyOn(UserContext, "useUserData").mockImplementation(() => ({
    data: mocks.client.getQueryData<ReturnType<typeof profile>>(key)?.userData,
  }) as never));
  componentSpies.push(vi.spyOn(UserContext, "useUserDataSelector").mockImplementation((select) => {
    const data = mocks.client.getQueryData<ReturnType<typeof profile>>(key)?.userData;
    const selected = useMemo(() => data ? select(data) : undefined, [data]);
    return { data: selected, updateUser: mocks.updateUser } as never;
  }));
  localStorage.clear();
  Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: window.CustomEvent });
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  // Bun shares modules between suites; restore Objective after each test.
  componentSpies.push(vi.spyOn(objective, "Objective").mockImplementation(() => null));
  componentSpies.push(vi.spyOn(sortableList, "SortableList").mockImplementation(() => null));
  for (const [name, implementation] of Object.entries(dialogMocks)) {
    componentSpies.push(vi.spyOn(dialogComponents, name as keyof typeof dialogMocks).mockImplementation(implementation as never));
  }
  vi.clearAllMocks();
  mocks.client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.client.setQueryData(key, profile());
  mocks.disable.mockResolvedValue({ success: true, message: "Saved" });
  mocks.stepNumber = 0;
  mocks.visible = true;
  mocks.step = { id: "welcome", chapter: "student", title: "Welcome", description: "Welcome", page: "/profile" };
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: () => 0 });
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
});

describe("TutorialAssistant highlight activation", () => {
  const highlightedAssistant = () => (
    <>
      <div id="lesson-control" ref={(element) => {
        if (element) element.getBoundingClientRect = () => new DOMRect(20, 120, 160, 48);
      }} />
      <TutorialAssistant sidebarBreakpoint={768} rightSideBarOpen={false} setRightSideBarOpen={() => {}} rightSideBarRef={{ current: null }} />
    </>
  );

  it("advances on the completed click so a press cannot activate the next page", () => {
    mocks.step = { ...mocks.step, elementIds: ["lesson-control"], proceedOnHighlightClick: true };
    const view = render(highlightedAssistant());
    const control = view.getByRole("button", { name: "Continue tutorial" });
    fireEvent.pointerDown(control);
    fireEvent.touchStart(control);
    expect(mocks.next).not.toHaveBeenCalled();
    fireEvent.click(control);
    expect(mocks.next).toHaveBeenCalledTimes(1);
  });

  it("keeps the next lesson tappable when it highlights the same control", () => {
    mocks.step = { ...mocks.step, elementIds: ["lesson-control"], proceedOnHighlightClick: true };
    const view = render(highlightedAssistant());
    mocks.step = { ...mocks.step, id: "next-lesson", title: "Next lesson" };
    view.rerender(highlightedAssistant());
    expect(view.getByRole("region", { name: "Tutorial: Next lesson" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Continue tutorial" }));
    expect(mocks.next).toHaveBeenCalledTimes(1);
  });

  it("keeps the highlighted tutorial control interactive above battle focus", async () => {
    componentSpies.push(vi.spyOn(mediaQuery, "useMediaQuery").mockReturnValue(false));
    mocks.step = { ...mocks.step, elementIds: ["lesson-control"], proceedOnHighlightClick: true };
    const view = render(highlightedAssistant());
    render(
      <BattleFocusView
        battle={undefined}
        renderTimer={(exitButton) => <div><p>Timer</p>{exitButton}</div>}
        field={<p>Field</p>}
        dock={<p>Actions</p>}
        log={<p>Log</p>}
        timeline={<p>Timeline</p>}
        onShowLayout={() => {}}
      />,
    );
    const control = view.getByRole("button", { name: "Continue tutorial" });
    await waitFor(() => expect(control.closest("[inert]")).toBeNull());
    control.focus();
    expect(document.activeElement).toBe(control);
    fireEvent.click(control);
    expect(mocks.next).toHaveBeenCalledTimes(1);
  });
});
afterEach(() => {
  cleanup();
  getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" });
  for (const spy of componentSpies.splice(0)) spy.mockRestore();
  close?.();
  close = undefined;
  mocks.client.clear();
  if (customEvent) Object.defineProperty(globalThis, "CustomEvent", customEvent);
  else Reflect.deleteProperty(globalThis, "CustomEvent");
  if (animationFrame) Object.defineProperty(globalThis, "requestAnimationFrame", animationFrame);
  else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
  if (resizeObserver) Object.defineProperty(globalThis, "ResizeObserver", resizeObserver);
  else Reflect.deleteProperty(globalThis, "ResizeObserver");
});
const renderAssistant = () => render(<TutorialAssistant sidebarBreakpoint={768} rightSideBarOpen={false} setRightSideBarOpen={() => {}} rightSideBarRef={{ current: null }} />);

it("pauses tutorial controls while chatting and restores the saved lesson on close", () => {
  mocks.step = { ...mocks.step, showNextButton: true };
  const view = renderAssistant();
  expect(view.getByRole("region", { name: "Tutorial: Welcome" })).toBeTruthy();
  act(() => getDefaultStore().set(chatPanelAtom, { owner: "chat", tab: "tavern" }));
  expect(view.queryByRole("region", { name: "Tutorial: Welcome" })).toBeNull();
  fireEvent.keyDown(window, { key: "Enter" });
  expect(mocks.next).not.toHaveBeenCalled();
  expect(mocks.disable).not.toHaveBeenCalled();
  act(() => getDefaultStore().set(chatPanelAtom, { owner: null, tab: "tavern" }));
  expect(view.getByRole("region", { name: "Tutorial: Welcome" })).toBeTruthy();
  fireEvent.keyDown(window, { key: "Enter" });
  expect(mocks.next).toHaveBeenCalledTimes(1);
  expect(mocks.client.getQueryData<ReturnType<typeof profile>>(key)?.userData.tutorialOn).toBe(true);
});

it("lets Activity controls handle Enter and arrow keys without advancing the lesson", async () => {
  mocks.step = { ...mocks.step, showNextButton: true };
  const view = renderAssistant();
  fireEvent.keyDown(view.getByRole("button", { name: "Swap Chat and Activity sides" }), { key: "Enter" });
  act(() => view.getByRole("tab", { name: "Tutorial" }).focus());
  fireEvent.keyDown(view.getByRole("tab", { name: "Tutorial" }), { key: "ArrowRight" });
  expect(mocks.next).not.toHaveBeenCalled();
  await waitFor(() => expect(view.getByRole("tab", { name: "Quests" }).getAttribute("aria-selected")).toBe("true"));
  expect(document.activeElement).toBe(view.getByRole("tab", { name: "Quests" }));
  fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
  await waitFor(() => expect(view.getByRole("tab", { name: "Tutorial" }).getAttribute("aria-selected")).toBe("true"));
  expect(mocks.next).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "Enter" });
  expect(mocks.next).toHaveBeenCalledTimes(1);
});
const confirmDisable = (view: ReturnType<typeof renderAssistant>) => {
  fireEvent.click(view.getByRole("button", { name: "Skip tutorial" }));
  fireEvent.click(view.getByRole("button", { name: "Skip tutorial" }));
};
const observe = (queryFn: () => Promise<ReturnType<typeof profile>>) => {
  const observer = new QueryObserver(mocks.client, { queryKey: key, staleTime: Infinity, queryFn });
  close = observer.subscribe(() => {});
};

describe("TutorialAssistant account boundary", () => {
  it.each(["/native-sign-in", "/native-sign-in/"])("keeps tutorial and reward actions out of %s", (pathname) => {
    const route = vi.spyOn(routing, "usePublicPathname").mockReturnValue(pathname);
    const view = renderAssistant();
    expect(view.container.innerHTML).toBe("");
    expect(mocks.rewardHook).not.toHaveBeenCalled();
    route.mockRestore();
    view.rerender(<TutorialAssistant sidebarBreakpoint={768} rightSideBarOpen={false} setRightSideBarOpen={() => {}} rightSideBarRef={{ current: null }} />);
    expect(view.getByRole("button", { name: "Skip tutorial" })).toBeTruthy();
    expect(mocks.rewardHook).toHaveBeenCalled();
  });
  it("does not mount login-required reward hooks for signed-out visitors", () => {
    mocks.client.removeQueries({ queryKey: key });
    const view = renderAssistant();
    expect(view.container.innerHTML).toBe("");
    expect(mocks.rewardHook).not.toHaveBeenCalled();
  });

  it("mounts after a profile arrives and unmounts when it disappears", () => {
    mocks.client.removeQueries({ queryKey: key });
    const view = renderAssistant();
    expect(mocks.rewardHook).not.toHaveBeenCalled();

    mocks.client.setQueryData(key, profile());
    view.rerender(<TutorialAssistant sidebarBreakpoint={768} rightSideBarOpen={false} setRightSideBarOpen={() => {}} rightSideBarRef={{ current: null }} />);
    expect(mocks.rewardHook).toHaveBeenCalled();
    expect(view.getByRole("button", { name: "Skip tutorial" })).toBeTruthy();

    mocks.rewardHook.mockClear();
    mocks.client.removeQueries({ queryKey: key });
    view.rerender(<TutorialAssistant sidebarBreakpoint={768} rightSideBarOpen={false} setRightSideBarOpen={() => {}} rightSideBarRef={{ current: null }} />);
    expect(view.container.innerHTML).toBe("");
    expect(mocks.rewardHook).not.toHaveBeenCalled();
  });
});

describe("TutorialAssistant disable reconciliation", () => {
  it("releases the submission lock after a transport failure so the same tutorial can be retried", async () => {
    mocks.disable.mockRejectedValueOnce(new Error("Offline"));
    const view = renderAssistant();
    confirmDisable(view);
    await waitFor(() => expect(view.getByText("We couldn't turn off the tutorial. Your progress is unchanged; please try again.")).toBeTruthy());
    expect(mocks.updateUser).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Skip tutorial" }));
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(mocks.disable).toHaveBeenCalledTimes(2);
  });

  it("keeps an idle success fetch-free and closes the confirmation", async () => {
    const read = vi.fn(async () => profile(200, "actor", false));
    observe(read);
    const view = renderAssistant();
    confirmDisable(view);
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(mocks.client.getQueryData<ReturnType<typeof profile>>(key)).toEqual(profile(100, "actor", false));
    expect(read).not.toHaveBeenCalled();
  });

  it("restarts an unrelated pending profile refresh", async () => {
    const read = vi.fn<() => Promise<ReturnType<typeof profile>>>().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(profile(200, "actor", false));
    observe(read);
    const pending = mocks.client.invalidateQueries({ queryKey: key });
    expect(mocks.client.getQueryState(key)?.fetchStatus).toBe("fetching");
    const view = renderAssistant();
    confirmDisable(view);
    await waitFor(() => expect(mocks.client.getQueryData<ReturnType<typeof profile>>(key)).toEqual(profile(200, "actor", false)));
    await pending;
    expect(read).toHaveBeenCalledTimes(2);
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("preserves invalidated idle profile reconciliation", async () => {
    const read = vi.fn(async () => profile(200, "actor", false));
    observe(read);
    await mocks.client.invalidateQueries({ queryKey: key, refetchType: "none" });
    const view = renderAssistant();
    confirmDisable(view);
    await waitFor(() => expect(mocks.client.getQueryData<ReturnType<typeof profile>>(key)).toEqual(profile(200, "actor", false)));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("ignores a successful response after switching accounts", async () => {
    let resolve!: (result: { success: boolean; message: string }) => void;
    mocks.disable.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const view = renderAssistant();
    confirmDisable(view);
    mocks.client.setQueryData(key, profile(300, "other"));
    view.rerender(<TutorialAssistant sidebarBreakpoint={768} rightSideBarOpen={false} setRightSideBarOpen={() => {}} rightSideBarRef={{ current: null }} />);
    await act(async () => { resolve({ success: true, message: "Saved" }); });
    expect(mocks.client.getQueryData<ReturnType<typeof profile>>(key)).toEqual(profile(300, "other"));
    expect(mocks.updateUser).not.toHaveBeenCalled();
    // The account switch closes the confirmation; only the panel's skip control remains.
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.getByRole("button", { name: "Skip tutorial" })).toBeTruthy();
  });
});

it("shows a completed tutorial state and still presents available quest guidance", async () => {
  mocks.stepNumber = 100;
  mocks.visible = false;
  mocks.step = undefined as never;
  const completed = profile();
  completed.userData.tutorialStep = 100;
  completed.userData.userQuests = [];
  completed.userData.questData = [];
  mocks.client.setQueryData(key, completed);
  const view = renderAssistant();
  fireEvent.click(view.getByRole("button", { name: "Open Activity" }));
  fireEvent.mouseDown(view.getByRole("tab", { name: "Tutorial" }), { button: 0 });
  expect(view.getByText("Tutorial complete. Quest guidance will appear here when available.")).toBeTruthy();
  expect(view.getByRole("link", { name: "Open tutorial settings" }).getAttribute("href")).toContain("setting=tutorial");
  completed.userData.userQuests = [{
    id: "attempt", questId: "quest", endAt: null,
    quest: { id: "quest", name: "Current quest", questType: "starter", description: "Follow your quest", consecutiveObjectives: false, content: { objectives: [], sceneCharacters: [] } },
  }] as never;
  completed.userData.questData = [{ id: "quest", goals: [] }] as never;
  mocks.client.setQueryData(key, { userData: { ...completed.userData } });
  view.rerender(<TutorialAssistant sidebarBreakpoint={768} rightSideBarOpen={false} setRightSideBarOpen={() => {}} rightSideBarRef={{ current: null }} />);
  await waitFor(() => expect(view.getByRole("region", { name: "Tutorial: Current quest" })).toBeTruthy());
  expect(view.queryByText("Tutorial complete. Quest guidance will appear here when available.")).toBeNull();
});
