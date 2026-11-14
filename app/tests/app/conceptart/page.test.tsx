import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as navigation from "next/navigation";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import ConceptArt from "@/app/[shell]/conceptart/page";
import { COST_CONCEPT_IMAGE, COST_CONCEPT_VIDEO } from "@/drizzle/constants";
import * as ConceptImage from "@/layout/ConceptImage";
import * as Confirm from "@/layout/Confirm";
import * as ContentBox from "@/layout/ContentBox";
import * as pagination from "@/libs/pagination";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";
import { mockUserContextValue } from "../../setup/userContext";

type Options = {
  onMutate: unknown;
  onSuccess: (result: unknown, input: unknown, revision: number) => Promise<void>;
};
const captured: Record<string, Options> = {};
const mutate = { create: vi.fn(), createVideo: vi.fn() };
const push = vi.fn();
const refetch = vi.fn(async () => undefined);
const updateUser = vi.fn(async (..._args: unknown[]) => undefined);
const prepareUserUpdate = vi.fn(() => 3);
const day = 86_400_000;
const images = [
  { id: "old-liked", createdAt: new Date(1 * day), sumReaction: 9 },
  { id: "new", createdAt: new Date(3 * day), sumReaction: 1 },
  { id: "mid", createdAt: new Date(2 * day), sumReaction: 5 },
];

const mount = (reputationPoints: number) => {
  mockUserContextValue({
    data: { userId: "artist", reputationPoints, isBanned: false, isSilenced: false },
    updateUser,
    prepareUserUpdate,
  } as never);
  return render(
    <AppRouterContext.Provider value={{} as never}>
      <ConceptArt />
    </AppRouterContext.Provider>,
  );
};

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  vi.clearAllMocks();
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push } as never);
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ children, topRightContent }) => (
      <div>
        {topRightContent}
        {children}
      </div>
    ),
  );
  vi.spyOn(ConceptImage, "default").mockImplementation((() => null) as never);
  vi.spyOn(Confirm, "default").mockImplementation((({
    children,
    onAccept,
  }: {
    children: ReactNode;
    onAccept: () => void;
  }) => (
    <div>
      {children}
      <button type="button" onClick={onAccept}>
        Accept
      </button>
    </div>
  )) as never);
  const capture = (name: "create" | "createVideo") => ({
    useMutation: (options: Options) => {
      captured[name] = options;
      return { mutate: mutate[name], isPending: false };
    },
  });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ conceptart: { getAll: { refetch } } }),
    conceptart: {
      create: capture("create"),
      createVideo: capture("createVideo"),
      getAll: {
        useInfiniteQuery: () => ({
          data: { pages: [{ data: images }] },
          hasNextPage: false,
        }),
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
  });
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const openVideoTab = () =>
  fireEvent.mouseDown(screen.getByRole("tab", { name: /Video/ }), {
    button: 0,
    ctrlKey: false,
  });

it("creates images and videos only when the reputation covers their cost", async () => {
  const view = mount(COST_CONCEPT_IMAGE);
  fireEvent.change(screen.getByPlaceholderText("Describe your image..."), {
    target: { value: "A fox" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Accept" })),
  );
  expect(mutate.create).toHaveBeenCalledTimes(1);
  expect(mutate.create.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({ prompt: "A fox" }),
  );
  openVideoTab();
  fireEvent.change(screen.getByPlaceholderText("Describe your video scene..."), {
    target: { value: "A run" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Accept" })),
  );
  expect(mutate.createVideo).not.toHaveBeenCalled();
  expect(toast.showMutationToast).toHaveBeenLastCalledWith({
    success: false,
    message: `Not enough reputation points. Video costs ${COST_CONCEPT_VIDEO} points.`,
  });
  view.unmount();

  mount(COST_CONCEPT_IMAGE - 1);
  fireEvent.change(screen.getByPlaceholderText("Describe your image..."), {
    target: { value: "A fox" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Accept" })),
  );
  expect(mutate.create).toHaveBeenCalledTimes(1);
  expect(toast.showMutationToast).toHaveBeenLastCalledWith({
    success: false,
    message: "No reputation points left.",
  });
});

it("shows a created image or video among the viewer's newest art", async () => {
  mount(1000);
  const ownFilter = () =>
    document.querySelector("svg.lucide-user")?.getAttribute("class") ?? "";
  expect(ownFilter()).not.toContain("text-orange-500");
  expect(captured.create?.onMutate).toBe(prepareUserUpdate);
  expect(captured.createVideo?.onMutate).toBe(prepareUserUpdate);
  fireEvent.change(screen.getByPlaceholderText("Describe your image..."), {
    target: { value: "A fox" },
  });

  const imageResult = {
    success: true,
    message: "Created",
    imageId: "img",
    userDelta: { reputationPoints: -1 },
  };
  await act(() => captured.create!.onSuccess(imageResult, {}, 7));
  expect(toast.showMutationToast).toHaveBeenLastCalledWith(imageResult);
  expect(
    (screen.getByPlaceholderText("Describe your image...") as HTMLInputElement).value,
  ).toBe("");
  expect(ownFilter()).toContain("text-orange-500");
  expect(push).toHaveBeenLastCalledWith("/conceptart/img");

  const videoResult = {
    success: true,
    message: "Queued",
    videoId: "vid",
    userDelta: { reputationPoints: -5 },
  };
  await act(() => captured.createVideo!.onSuccess(videoResult, {}, 8));
  expect(toast.showMutationToast).toHaveBeenLastCalledWith({
    success: true,
    message: "Video generation started! You'll be redirected to see the progress.",
  });
  expect(push).toHaveBeenLastCalledWith("/conceptart/vid");
  expect(refetch).toHaveBeenCalledTimes(2);
  expect(updateUser.mock.calls).toEqual([
    [undefined, { revision: 7, delta: imageResult.userDelta }],
    [undefined, { revision: 8, delta: videoResult.userDelta }],
  ]);

  await act(() => captured.create!.onSuccess({ success: false, message: "No" }, {}, 9));
  await act(() =>
    captured.createVideo!.onSuccess({ success: false, message: "Busy" }, {}, 9),
  );
  expect(toast.showMutationToast).toHaveBeenLastCalledWith({
    success: false,
    message: "Busy",
  });
  expect(push).toHaveBeenCalledTimes(2);
  expect(updateUser).toHaveBeenCalledTimes(2);
});

it("orders the gallery newest first", () => {
  mount(1000);
  expect(
    screen.getAllByRole("link").map((link) => link.getAttribute("aria-label")),
  ).toEqual(["Image new", "Image mid", "Image old-liked"]);
});
