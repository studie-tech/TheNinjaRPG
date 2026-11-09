/** Exercise application removal/recovery with real query/tRPC state and controlled transport failures. */

import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import * as navigation from "next/navigation";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import Thread from "@/app/[shell]/forum/[boardid]/[threadid]/thread";
import { FORUM_THREAD_POSTS_PER_PAGE } from "@/drizzle/constants";
import * as Confirm from "@/layout/Confirm";
import * as ContentBox from "@/layout/ContentBox";
import * as Forum from "@/layout/Forum";
import * as Link from "@/layout/Link";
import * as Post from "@/layout/Post";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { TrpcTestProviders, testApi } from "../../setup/trpc";

type ThreadData = RouterOutputs["comments"]["getForumComments"];
let queryClient: QueryClient;
let posts: Extract<ThreadData, { thread: object }>["data"];
let failReads: boolean;
let rejectRemoval: boolean;
let moderator: boolean;
let refreshDuringRemoval: boolean;
let removalPaths: string[];
let requestedPages: number[];
let savedObserver: PropertyDescriptor | undefined;

beforeEach(() => {
  failReads = false;
  rejectRemoval = false;
  moderator = false;
  refreshDuringRemoval = false;
  removalPaths = [];
  requestedPages = [];
  posts = ["opening", "reply"].map((id) => ({
    id,
    authorId: "reader",
    content: `<p>${id} content</p>`,
    createdAt: new Date(),
    reactions: [],
    user: null,
  })) as unknown as typeof posts;
  savedObserver = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: function () {
      return { observe() {}, unobserve() {}, disconnect() {} };
    },
  });
  vi.spyOn(navigation, "useSearchParams").mockReturnValue(
    new URLSearchParams() as never,
  );
  vi.spyOn(navigation, "useRouter").mockReturnValue({
    replace: vi.fn(),
    push: vi.fn(),
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    comments: testApi.comments,
    forum: testApi.forum,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(UserContext, "useUserData").mockImplementation(
    () =>
      ({
        data: {
          userId: moderator ? "moderator" : "reader",
          level: 50,
          role: moderator ? "MODERATOR" : "USER",
        },
      }) as never,
  );
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(Link, "default").mockImplementation(({ children, href }) => (
    <a href={String(href)}>{children}</a>
  ));
  vi.spyOn(Post, "default").mockImplementation(({ children, options }) => (
    <div>
      {options}
      {children}
    </div>
  ));
  vi.spyOn(Confirm, "default").mockImplementation(({ onAccept, proceed_label }) => (
    <button onClick={onAccept as never}>{proceed_label}</button>
  ));
  vi.spyOn(Forum, "ForumNavigation").mockImplementation(() => <></>);
  vi.spyOn(Forum, "ForumWatchButton").mockImplementation(() => null);
  vi.spyOn(Forum, "ForumComposer").mockImplementation(() => <></>);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  if (savedObserver)
    Object.defineProperty(globalThis, "IntersectionObserver", savedObserver);
  else Reflect.deleteProperty(globalThis, "IntersectionObserver");
});

/** Build the server page from mutable fixture posts so later reads can represent removal or restoration. */
function threadPage(cursor = 0): ThreadData {
  return {
    thread: {
      id: "topic",
      boardId: "board",
      userId: "reader",
      title: "Discussion",
      tags: [],
      kind: "DISCUSSION",
      nPosts: posts.length,
    },
    board: {
      id: "board",
      name: "Strategy",
      permissions: { read: true, remove: true, moderate: moderator },
    },
    data: posts.slice(
      cursor * FORUM_THREAD_POSTS_PER_PAGE,
      (cursor + 1) * FORUM_THREAD_POSTS_PER_PAGE,
    ),
    totalComments: posts.length,
    totalPages: Math.ceil(posts.length / FORUM_THREAD_POSTS_PER_PAGE),
    nextCursor:
      (cursor + 1) * FORUM_THREAD_POSTS_PER_PAGE < posts.length ? cursor + 1 : null,
  } as unknown as ThreadData;
}

/** Mount the actual discussion with an in-memory transport that can reject reads after successful writes. */
function renderThread() {
  const trpcClient = testApi.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            let data: unknown = [];
            if (op.path === "comments.getForumComments") {
              const cursor = (op.input as { cursor: number }).cursor;
              requestedPages.push(cursor);
              if (failReads) {
                observer.error(
                  TRPCClientError.from(new Error("Discussion refresh interrupted")),
                );
                return;
              }
              data = threadPage(cursor);
            }
            if (
              op.path === "comments.deleteForumComment" ||
              op.path === "forum.moderatePost"
            ) {
              removalPaths.push(op.path);
              data = {
                success: !rejectRemoval,
                message: rejectRemoval ? "This post is locked" : "Post removed",
              };
              if (!rejectRemoval) {
                const input = op.input as { id?: string; postId?: string };
                posts = posts.filter((post) => post.id !== (input.id ?? input.postId));
                if (refreshDuringRemoval) {
                  void queryClient.invalidateQueries().then(() => {
                    failReads = true;
                    observer.next({ result: { data } });
                    observer.complete();
                  });
                  return;
                }
                failReads = true;
              }
            }
            observer.next({ result: { data } });
            observer.complete();
          }),
    ],
  });
  return render(
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      <Thread threadId="topic" initialPage={threadPage()} />
    </TrpcTestProviders>,
  );
}

it.each([false, true])(
  "keeps confirmed removal hidden during failed refresh and permits a fresh restoration (moderator=%s)",
  async (isModerator) => {
    moderator = isModerator;
    const restored = posts[1]!;
    const view = renderThread();
    await waitFor(() => expect(requestedPages.length).toBe(1));
    const reply = view.container.querySelector("#post-reply")!;
    if (moderator) {
      fireEvent.change(
        within(reply as HTMLElement).getByLabelText("Moderation reason"),
        { target: { value: "Off topic reply" } },
      );
      fireEvent.click(
        within(reply as HTMLElement).getByRole("button", {
          name: "Remove with reason",
        }),
      );
    } else
      fireEvent.click(
        within(reply as HTMLElement).getByRole("button", { name: "Remove post" }),
      );
    await waitFor(() => expect(view.container.querySelector("#post-reply")).toBeNull());
    expect(removalPaths).toEqual([
      moderator ? "forum.moderatePost" : "comments.deleteForumComment",
    ]);
    expect(view.getByText("1 post")).toBeTruthy();
    expect(view.getByText("opening content")).toBeTruthy();
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Try again" })).toBeTruthy(),
    );
    failReads = false;
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(view.queryByRole("button", { name: "Try again" })).toBeNull(),
    );
    expect(view.container.querySelector("#post-reply")).toBeNull();
    posts.push(restored);
    await queryClient.invalidateQueries();
    await waitFor(() => expect(view.getByText("reply content")).toBeTruthy());
    expect(view.getByText("2 posts")).toBeTruthy();
  },
);

it("retains the post and total when the server rejects removal", async () => {
  rejectRemoval = true;
  const view = renderThread();
  const reply = view.container.querySelector("#post-reply")!;
  fireEvent.click(
    within(reply as HTMLElement).getByRole("button", { name: "Remove post" }),
  );
  expect(await view.findByRole("alert")).toHaveProperty(
    "textContent",
    "This post is locked",
  );
  expect(view.getByText("reply content")).toBeTruthy();
  expect(view.getByText("2 posts")).toBeTruthy();
});

it("does not subtract a removal already received by an intervening fresh read", async () => {
  refreshDuringRemoval = true;
  const view = renderThread();
  await waitFor(() => expect(requestedPages.length).toBe(1));
  const reply = view.container.querySelector("#post-reply")!;
  fireEvent.click(
    within(reply as HTMLElement).getByRole("button", { name: "Remove post" }),
  );
  await waitFor(() =>
    expect(view.getByRole("button", { name: "Try again" })).toBeTruthy(),
  );
  expect(view.container.querySelector("#post-reply")).toBeNull();
  expect(view.getByText("1 post")).toBeTruthy();
  expect(view.getByText("opening content")).toBeTruthy();
});

it("returns from an emptied final page to the reconciled cached previous page when refresh fails", async () => {
  const opening = posts[0]!;
  posts = [
    ...Array.from({ length: FORUM_THREAD_POSTS_PER_PAGE }, (_, index) => ({
      ...opening,
      id: `opening-${index}`,
    })),
    posts[1]!,
  ];
  const view = renderThread();
  await waitFor(() => expect(requestedPages.length).toBe(1));
  fireEvent.click(view.getAllByRole("button", { name: "2" })[0]!);
  const replyText = await view.findByText("reply content");
  fireEvent.click(
    within(replyText.closest("article")!).getByRole("button", { name: "Remove post" }),
  );
  await waitFor(() => expect(view.container.querySelector("#post-reply")).toBeNull());
  expect(view.getByText(`${FORUM_THREAD_POSTS_PER_PAGE} posts`)).toBeTruthy();
  expect(view.getAllByText("opening content")).toHaveLength(
    FORUM_THREAD_POSTS_PER_PAGE,
  );
  await waitFor(() => expect(requestedPages.at(-1)).toBe(0));
  expect(view.queryByRole("button", { name: "2" })).toBeNull();
});
