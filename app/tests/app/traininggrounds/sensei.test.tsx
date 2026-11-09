import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as client from "@/app/_trpc/client";
import Training from "@/app/[shell]/traininggrounds/page";
import * as tutorial from "@/hooks/tutorial";
import * as ContentBox from "@/layout/ContentBox";
import * as UserRequestSystem from "@/layout/UserRequestSystem";
import * as UserSearchSelect from "@/layout/UserSearchSelect";
import * as toast from "@/libs/toast";
import * as search from "@/utils/search";
import * as UserContext from "@/utils/UserContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

type Options = {
  onSuccess: (data: { success: boolean; message: string }) => Promise<void>;
};
const captured: Record<string, Options> = {};
const invalidateRequests = vi.fn(async () => undefined);
const invalidateStudents = vi.fn(async () => undefined);
const idle = {
  useQuery: () => ({ data: undefined, isPending: false, isFetching: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
};
const user = {
  userId: "viewer",
  rank: "GENIN",
  senseiId: null,
  stealth: 0,
  sensory: 0,
  covertTrainingType: null,
  covertTrainingStartedAt: null,
  covertTrainingMinutes: null,
};

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("trainingTab:viewer", "Covert & Sensei");
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children, title }) => (
    <section aria-label={String(title)}>{children}</section>
  ));
  vi.spyOn(UserSearchSelect, "default").mockImplementation((() => null) as never);
  vi.spyOn(UserRequestSystem, "default").mockImplementation((() => null) as never);
  vi.spyOn(search, "useUserPicker").mockReturnValue({
    methods: {},
    user: undefined,
  } as never);
  vi.spyOn(tutorial, "useTutorialStep").mockReturnValue({
    currentStep: undefined,
  } as never);
  vi.spyOn(UserContext, "useRequireInVillage").mockReturnValue({
    userData: user,
    timeDiff: 0,
    access: true,
  } as never);
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: user,
    prepareUserUpdate: vi.fn(),
    updateUser: vi.fn(async () => undefined),
  } as never);
  const capture = (name: string) => ({
    useMutation: (options: Options) => {
      captured[name] = options;
      return { mutate: vi.fn(), isPending: false };
    },
  });
  const routerOf = (overrides: Record<string, unknown>) =>
    new Proxy(overrides, { get: (target, name) => target[name as string] ?? idle });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      sensei: {
        getRequests: { invalidate: invalidateRequests },
        getStudents: { invalidate: invalidateStudents },
      },
    }),
    profile: routerOf({}),
    stealth: routerOf({}),
    sensei: routerOf({
      getRequests: { useQuery: () => ({ data: [] }) },
      createRequest: capture("createRequest"),
      rejectRequest: capture("rejectRequest"),
      cancelRequest: capture("cancelRequest"),
    }),
  });
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("refreshes sensei requests after each request change", async () => {
  render(
    <AppRouterContext.Provider value={{} as never}>
      <Training />
    </AppRouterContext.Provider>,
  );
  expect(screen.getByLabelText("Covert Operations")).toBeDefined();
  const procedures = ["createRequest", "rejectRequest", "cancelRequest"];
  for (const name of procedures) {
    await act(() => captured[name]!.onSuccess({ success: false, message: "No" }));
  }
  expect(invalidateRequests).not.toHaveBeenCalled();
  for (const name of procedures) {
    await act(() => captured[name]!.onSuccess({ success: true, message: "Yes" }));
  }
  expect(invalidateRequests).toHaveBeenCalledTimes(3);
  expect(invalidateStudents).not.toHaveBeenCalled();
  expect(toast.showMutationToast).toHaveBeenCalledTimes(6);
});
