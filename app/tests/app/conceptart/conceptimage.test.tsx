import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import ConceptBox_ConceptImage from "@/app/[shell]/conceptart/[imageid]/conceptimage";
import * as ContentBox from "@/layout/ContentBox";
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
const images: Record<string, ReturnType<typeof processingVideo>> = {
  first: processingVideo("first"),
  second: processingVideo("second"),
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
      toggleEmotion: { useMutation: () => ({ mutateAsync: vi.fn() }) },
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
