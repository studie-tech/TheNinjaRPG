import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import ConceptBox_ConceptImage from "@/app/[shell]/conceptart/[imageid]/conceptimage";
import * as ContentBox from "@/layout/ContentBox";
import * as Report from "@/layout/Report";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";

const finalize = vi.fn();
const statusQueries: { id: string; enabled: boolean }[] = [];
const processingVideo = (id: string) => ({
  id,
  userId: "artist",
  mediaType: "video",
  done: false,
  replicateId: `prediction-${id}`,
  status: "processing",
  image: null,
  user: { username: "artist", avatar: null },
});
const toggleEmotion = vi.fn();
const images: Record<string, Record<string, unknown>> = {
  first: processingVideo("first"),
  second: processingVideo("second"),
  done: {
    id: "done",
    userId: "artist",
    mediaType: "image",
    done: true,
    status: "succeeded",
    image: "https://utfs.io/f/done.png",
    prompt: "A ninja",
    n_likes: 2,
    n_loves: 0,
    n_laugh: 0,
    likes: [],
    user: { username: "artist", avatar: null },
  },
};
const statuses: Record<string, unknown> = {
  first: { readyToFinalize: true, progress: 40 },
};

beforeEach(() => {
  finalize.mockClear();
  statusQueries.length = 0;
  vi.spyOn(navigation, "useRouter").mockReturnValue({ replace: vi.fn() } as never);
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: undefined } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      conceptart: { get: { invalidate: vi.fn() }, getAll: { invalidate: vi.fn() } },
    }),
    conceptart: {
      get: {
        useQuery: ({ id }: { id: string }) => ({ data: images[id], isLoading: false }),
      },
      checkVideoStatusRead: {
        useQuery: ({ id }: { id: string }, { enabled }: { enabled: boolean }) => {
          statusQueries.push({ id, enabled });
          return { data: statuses[id] };
        },
      },
      finalizeVideoUpload: {
        useMutation: () => ({ mutate: finalize, isPending: false }),
      },
      toggleEmotion: { useMutation: () => ({ mutateAsync: toggleEmotion }) },
      delete: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("starts each image's video tracking fresh when the detail page moves to another image", () => {
  const view = render(<ConceptBox_ConceptImage imageid="first" />);
  expect(finalize).toHaveBeenCalledWith({ id: "first" });
  expect(screen.getByText("40%")).toBeTruthy();

  view.rerender(<ConceptBox_ConceptImage imageid="second" />);
  expect(statusQueries.at(-1)).toEqual({ id: "second", enabled: true });
  expect(screen.queryByText("40%")).toBeNull();
});

it("asks a signed-out visitor to sign in instead of silently ignoring a reaction", () => {
  const shown = vi
    .spyOn(toast, "showMutationToast")
    .mockImplementation(() => undefined);
  vi.spyOn(Report, "default").mockImplementation(() => null);
  render(<ConceptBox_ConceptImage imageid="done" />);
  fireEvent.click(screen.getByRole("button", { name: "Add heart reaction" }));
  expect(toggleEmotion).not.toHaveBeenCalled();
  expect(shown).toHaveBeenCalledWith(
    expect.objectContaining({ success: false, title: "Sign in to react" }),
  );
});
