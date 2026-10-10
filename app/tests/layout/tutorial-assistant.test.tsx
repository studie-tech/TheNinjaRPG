import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TutorialAssistant from "@/layout/TutorialAssistant";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { type UserPatch, updateUserCache } from "@/utils/userCache";
import { ensureDom } from "../setup-dom.mjs";

const key = [["profile", "getUser"], { type: "query" }];
const profile = (money = 100, userId = "actor", tutorialOn = true) => ({
  userData: { userId, money, tutorialOn, tutorialStep: 0, status: "AWAKE", level: 2 } as NonNullable<UserWithRelations>,
});
function testMocks() {
  const globals = globalThis as typeof globalThis & { __tutorialAssistantMocks?: {
    client: QueryClient;
    disable: ReturnType<typeof vi.fn<() => Promise<{ success: boolean; message: string }>>>;
    updateUser: ReturnType<typeof vi.fn<(patch: UserPatch) => Promise<void>>>;
  } };
  globals.__tutorialAssistantMocks ??= {
    client: new QueryClient(),
    disable: vi.fn(async () => ({ success: true, message: "Saved" })),
    updateUser: vi.fn(async (patch: UserPatch) => { await updateUserCache(testMocks().client, key, patch); }),
  };
  return globals.__tutorialAssistantMocks;
}
const mocks = testMocks();
vi.mock("@/utils/UserContext", () => ({
  useUserData: () => ({ data: testMocks().client.getQueryData<ReturnType<typeof profile>>(key)?.userData, updateUser: testMocks().updateUser }),
}));
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
  const step = { id: "welcome", title: "Welcome", description: "Welcome", page: "/profile" };
  return { TUTORIAL_STEPS: [step], TUTORIAL_HOSPITALIZED_STEP: step, useTutorialStep: () => ({ currentStep: step, currentStepNumber: 0, isAssistantVisible: true, setIsAssistantVisible: vi.fn(), updateTutorialStep: vi.fn() }) };
});
vi.mock("@/hooks/useAbVariant", () => ({ useAbVariant: () => ({ variant: "A" }) }));
vi.mock("@/layout/Logbook", () => ({ useCheckRewards: () => ({ checkRewards: vi.fn(), isCheckingRewards: false }) }));
vi.mock("@/layout/Image", () => ({ default: () => null }));
vi.mock("@/layout/Objective", () => ({ Objective: () => null }));
vi.mock("@/components/ui/sortable-list", () => ({ SortableList: () => null }));
vi.mock("@/components/ui/dialog", () => {
  const Content = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div role="dialog">{children}</div> : null, DialogContent: Content, DialogDescription: Content, DialogHeader: Content, DialogTitle: Content };
});

let close: (() => void) | undefined;
const animationFrame = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
beforeEach(() => {
  ensureDom();
  vi.clearAllMocks();
  mocks.client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.client.setQueryData(key, profile());
  mocks.disable.mockResolvedValue({ success: true, message: "Saved" });
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: () => 0 });
});
afterEach(() => {
  cleanup();
  close?.();
  close = undefined;
  mocks.client.clear();
  if (animationFrame) Object.defineProperty(globalThis, "requestAnimationFrame", animationFrame);
  else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
});
const renderAssistant = () => render(<TutorialAssistant rightSideBarOpen={false} setRightSideBarOpen={() => {}} rightSideBarRef={{ current: null }} />);
const confirmDisable = (view: ReturnType<typeof renderAssistant>) => {
  fireEvent.click(view.getByRole("button", { name: "Disable tutorial" }));
  fireEvent.click(view.getByRole("button", { name: "Skip Tutorial" }));
};
const observe = (queryFn: () => Promise<ReturnType<typeof profile>>) => {
  const observer = new QueryObserver(mocks.client, { queryKey: key, staleTime: Infinity, queryFn });
  close = observer.subscribe(() => {});
};

describe("TutorialAssistant disable reconciliation", () => {
  it("keeps an idle success fetch-free and closes the confirmation", async () => {
    const read = vi.fn(async () => profile(200, "actor", false));
    observe(read);
    const view = renderAssistant();
    confirmDisable(view);
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(mocks.client.getQueryData(key)).toEqual(profile(100, "actor", false));
    expect(read).not.toHaveBeenCalled();
  });

  it("restarts an unrelated pending profile refresh", async () => {
    const read = vi.fn<() => Promise<ReturnType<typeof profile>>>().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(profile(200, "actor", false));
    observe(read);
    const pending = mocks.client.invalidateQueries({ queryKey: key });
    expect(mocks.client.getQueryState(key)?.fetchStatus).toBe("fetching");
    const view = renderAssistant();
    confirmDisable(view);
    await waitFor(() => expect(mocks.client.getQueryData(key)).toEqual(profile(200, "actor", false)));
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
    await waitFor(() => expect(mocks.client.getQueryData(key)).toEqual(profile(200, "actor", false)));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("ignores a successful response after switching accounts", async () => {
    let resolve!: (result: { success: boolean; message: string }) => void;
    mocks.disable.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const view = renderAssistant();
    confirmDisable(view);
    mocks.client.setQueryData(key, profile(300, "other"));
    view.rerender(<TutorialAssistant rightSideBarOpen={false} setRightSideBarOpen={() => {}} rightSideBarRef={{ current: null }} />);
    await act(async () => { resolve({ success: true, message: "Saved" }); });
    expect(mocks.client.getQueryData(key)).toEqual(profile(300, "other"));
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(view.getByRole("button", { name: "Skip Tutorial" })).toBeTruthy();
  });
});
