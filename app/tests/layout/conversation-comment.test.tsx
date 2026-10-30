import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { InfiniteQueryObserver, QueryClient, type InfiniteData } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import { type Control, useController } from "react-hook-form";
import { CommentOnConversation } from "@/layout/Comment";
import * as CommentModule from "@/layout/Comment";
import * as Confirm from "@/layout/Confirm";
import { ConversationComments } from "@/layout/ConversationComments";
import type { PostProps } from "@/layout/Post";
import type { MutateCommentSchema } from "@/validators/comments";
import * as Parse from "@/utils/parse";
import { ensureDom } from "../setup/dom.mjs";
import { conversationQueryOptions } from "../setup/conversationQueryOptions";
import { createToastMock } from "../setup/toastMock";

const edit = vi.fn();
vi.mock("@/app/_trpc/client", () => ({
  api: {
    useUtils: () => ({ comments: { getConversationComments: { invalidate: vi.fn() } } }),
    comments: {
      editConversationComment: { useMutation: () => ({ mutate: edit, isPending: false }) },
      deleteConversationComment: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock("@/utils/UserContext", () => ({ useUserData: () => ({ data: { userId: "friend", role: "USER" } }) }));
vi.mock("@/libs/toast", createToastMock);
vi.mock("@/layout/Post", () => ({
  default: ({ children, options }: { children: ReactNode; options?: ReactNode }) => <div>{options}{children}</div>,
}));
vi.mock("@/layout/RichInput", () => ({
  default: ({ control, disabled }: { control: Control<MutateCommentSchema>; disabled?: boolean }) => {
    const { field } = useController({ control, name: "comment" });
    return <><textarea aria-label="Edit message" {...field} disabled={disabled} /><button type="submit" disabled={disabled}>Save message</button></>;
  },
}));
vi.mock("@/layout/ModerationSummary", () => ({ ModerationSummary: () => null }));
vi.mock("@/layout/Report", () => ({ default: () => null }));
vi.mock("@/layout/EmojiPicker", () => ({ default: () => null }));

let confirmSpy: { mockRestore: () => void };
let rowSpy: { mockRestore: () => void } | undefined;
let parseSpy: { mockRestore: () => void } | undefined;
beforeEach(() => {
  ensureDom();
  vi.clearAllMocks();
  confirmSpy = vi.spyOn(Confirm, "default").mockImplementation(() => null);
});
afterEach(() => {
  cleanup();
  confirmSpy.mockRestore();
  rowSpy?.mockRestore();
  parseSpy?.mockRestore();
  rowSpy = undefined;
  parseSpy = undefined;
});

const comment = {
  id: "message", conversationId: "conversation", content: "Saved message",
  userId: "friend", authorId: "friend", createdAt: new Date(), reactions: {},
  isPinned: false, isReported: false, isStaffOnly: false,
};
const user: PostProps["user"] = {
  userId: "friend", username: "Friend", avatar: null, level: 50, rank: "GENIN",
  isOutlaw: false, role: "USER", federalStatus: "NONE",
};
const message = (canEdit?: boolean) => <CommentOnConversation comment={comment} user={user} canEdit={canEdit}>{comment.content}</CommentOnConversation>;
const toggleEdit = (view: ReturnType<typeof render>) => {
  const toggle = view.container.querySelector(".lucide-square-pen");
  expect(toggle).not.toBeNull();
  fireEvent.click(toggle!);
};

describe("conversation comment editing permissions", () => {
  it("shows the saved message when an open editor loses permission and retains the draft for recovery", () => {
    const view = render(message(true));
    toggleEdit(view);
    fireEvent.change(view.getByRole("textbox", { name: "Edit message" }), { target: { value: "Unsent draft" } });

    view.rerender(message(false));
    expect(view.queryByRole("textbox", { name: "Edit message" }) === null).toBe(true);
    expect(view.queryByRole("button", { name: "Save message" }) === null).toBe(true);
    expect(view.container.querySelector(".lucide-square-pen") === null).toBe(true);
    expect(view.getByText(comment.content)).toBeTruthy();
    expect(edit).not.toHaveBeenCalled();

    view.rerender(message(true));
    expect((view.getByRole("textbox", { name: "Edit message" }) as HTMLTextAreaElement).value).toBe("Unsent draft");
    toggleEdit(view);
    expect(view.queryByRole("textbox", { name: "Edit message" }) === null).toBe(true);
    expect(view.getByText(comment.content)).toBeTruthy();
  });

  it("keeps normal editing and submission available when permission is omitted", async () => {
    const view = render(message());
    toggleEdit(view);
    fireEvent.change(view.getByRole("textbox", { name: "Edit message" }), { target: { value: "Edited message" } });
    fireEvent.click(view.getByRole("button", { name: "Save message" }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(edit).toHaveBeenCalledWith({ object_id: comment.id, comment: "Edited message", quoteIds: null, senderId: null });
  });
});

describe("conversation emoji outside-click listener", () => {
  it("listens only while open, survives rerenders, and cleans up on close and unmount", async () => {
    // jsdom's document proxy does not retain an instance-level Bun spy.
    const add = vi.spyOn(window.EventTarget.prototype, "addEventListener");
    const remove = vi.spyOn(window.EventTarget.prototype, "removeEventListener");
    const toggleReaction = vi.fn();
    const view = render(<CommentOnConversation comment={comment} user={user} toggleReaction={toggleReaction}>{comment.content}</CommentOnConversation>);
    const mousedownAdds = () => add.mock.calls.filter(([event], i) => event === "mousedown" && add.mock.contexts[i] === document);
    const mousedownRemoves = () => remove.mock.calls.filter(([event], i) => event === "mousedown" && remove.mock.contexts[i] === document);
    try {
      expect(mousedownAdds()).toHaveLength(0);
      await act(async () => { fireEvent.click(view.container.querySelector(".lucide-smile-plus")!); });
      await waitFor(() => expect(mousedownAdds()).toHaveLength(1));

      view.rerender(<CommentOnConversation comment={{ ...comment, reactions: { "👍": ["Friend"] } }} user={user} toggleReaction={toggleReaction}>{comment.content}</CommentOnConversation>);
      expect(mousedownAdds()).toHaveLength(1);
      expect(mousedownRemoves()).toHaveLength(0);

      fireEvent.mouseDown(document.body);
      await waitFor(() => expect(mousedownRemoves()).toHaveLength(1));
      expect(mousedownRemoves()[0]?.[1]).toBe(mousedownAdds()[0]?.[1]);
      fireEvent.click(view.container.querySelector(".lucide-smile-plus")!);
      await waitFor(() => expect(mousedownAdds()).toHaveLength(2));
      view.unmount();
      expect(mousedownRemoves()).toHaveLength(2);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });
});

type ListProps = ComponentProps<typeof ConversationComments>;
type ChatPage = NonNullable<ListProps["pages"]>[number];
type ReturnedComment = ChatPage["data"][number];
const row = (id: string): ReturnedComment => ({
  ...comment, ...user, id, content: `Message ${id}`,
  villageName: null, villageHexColor: null, villageKageId: null, displayTitle: "",
  tavernUsernameColor: "DEFAULT", tavernTitleColor: "DEFAULT", nRecruited: 0, tavernMessages: 0,
});
const pages = (data: ReturnedComment[]): ListProps["pages"] => [{
  convo: {
    id: "conversation", title: "Conversation", createdById: "friend",
    createdAt: comment.createdAt, updatedAt: comment.createdAt,
    isLocked: false, isPublic: true, isStaffAvailable: false, isEnabled: true,
    readRestriction: null, sendRestriction: null, supportTicketCreatorId: null, users: [],
  }, data, nextCursor: null, restrictionMessage: null,
}];
const listProps = (data: ReturnedComment[]): ListProps => ({
  pages: pages(data), conversationId: "conversation", deletedCommentIds: new Set(),
  quoteIds: [], username: "Reader", canInteract: true, setLastElement: vi.fn(),
  onReact: vi.fn(), onToggleQuote: vi.fn(), onDeleted: vi.fn(),
});

describe("conversation comment row isolation", () => {
  const observeRows = () => {
    const renders = vi.spyOn(CommentModule, "CommentOnConversation").mockImplementation((props) => (
      <div data-testid={props.comment.id}>
        {props.children}
        <button type="button" disabled={!props.toggleReaction} onClick={() => props.toggleReaction?.("👍")}>React {props.comment.id}</button>
        <button type="button" disabled={!props.setQuoteId} onClick={() => props.setQuoteId?.(props.comment.id)}>Quote {props.comment.id}</button>
      </div>
    ));
    const parses = vi.spyOn(Parse, "parseHtml").mockImplementation((content) => [<span key="parsed">{content}</span>]);
    rowSpy = renders;
    parseSpy = parses;
    return { renders, parses };
  };

  it("lists compact chat oldest first and loads older history from the top", () => {
    observeRows();
    const setLastElement = vi.fn();
    // Pages arrive newest first.
    const view = render(
      <ConversationComments
        {...listProps([row("3"), row("2"), row("1")])}
        compact
        setLastElement={setLastElement}
      />,
    );
    const ids = Array.from(view.container.querySelectorAll("[data-testid]")).map(
      (element) => element.getAttribute("data-testid"),
    );
    expect(ids).toEqual(["1", "2", "3"]);
    const sentinel = setLastElement.mock.calls.find(([element]) => element)?.[0];
    expect(sentinel?.textContent).toContain("Message 1");
  });

  it("renders only changed cached rows in a 100-message history and reparses only changed content", () => {
    const { renders, parses } = observeRows();
    const history = Array.from({ length: 100 }, (_, i) => row(String(i)));
    const props = listProps(history);
    const client = new QueryClient();
    const queryKey = ["conversation-comments"];
    const observer = new InfiniteQueryObserver(client, {
      ...conversationQueryOptions<ChatPage>("Conversation.tsx"),
      queryKey,
      initialPageParam: null,
      enabled: false,
      initialData: { pages: props.pages!, pageParams: [null] },
    });
    const cached = () => client.getQueryData<InfiniteData<ChatPage>>(queryKey)!;
    // Follow the immutable page writer used by incoming messages and optimistic sends.
    const update = (mapData: (data: ReturnedComment[]) => ReturnedComment[]) => {
      client.setQueryData<InfiniteData<ChatPage>>(queryKey, (old) => old && ({
        pageParams: old.pageParams,
        pages: old.pages.map((page) => page.convo ? { ...page, data: mapData(page.data) } : page),
      }));
    };
    const view = render(<ConversationComments {...props} pages={cached().pages} />);
    try {
      expect(renders).toHaveBeenCalledTimes(100);
      expect(parses).toHaveBeenCalledTimes(100);
      renders.mockClear();
      parses.mockClear();

      const incoming = row("new");
      const beforeInsert = cached();
      update((data) => [incoming, ...data]);
      expect(beforeInsert.pages[0]?.data).toEqual(history);
      view.rerender(<ConversationComments {...props} pages={cached().pages} />);
      expect(renders).toHaveBeenCalledTimes(1);
      expect(parses).toHaveBeenCalledTimes(1);
      expect(renders.mock.calls[0]?.[0].comment.id).toBe("new");
      renders.mockClear();
      parses.mockClear();

      update((data) => data.map((comment) => comment.id === "0" ? { ...comment, reactions: { "👍": ["Reader"] } } : comment));
      view.rerender(<ConversationComments {...props} pages={cached().pages} />);
      expect(renders).toHaveBeenCalledTimes(1);
      expect(renders.mock.calls[0]?.[0].comment.id).toBe("0");
      expect(parses).not.toHaveBeenCalled();
      renders.mockClear();

      view.rerender(<ConversationComments {...props} pages={cached().pages} quoteIds={["1"]} />);
      expect(renders).toHaveBeenCalledTimes(1);
      expect(renders.mock.calls[0]?.[0].comment.id).toBe("1");
      expect(renders.mock.calls[0]?.[0].quoteIds).toEqual(["1"]);
      expect(parses).not.toHaveBeenCalled();
      renders.mockClear();

      update((data) => data.map((comment) => comment.id === "0" ? { ...comment, content: "Edited" } : comment));
      view.rerender(<ConversationComments {...props} pages={cached().pages} quoteIds={["1"]} />);
      expect(renders).toHaveBeenCalledTimes(1);
      expect(parses).toHaveBeenCalledTimes(1);
      expect(view.getByText("Edited")).toBeTruthy();
      fireEvent.click(view.getByRole("button", { name: "React 0" }));
      expect(props.onReact).toHaveBeenCalledWith({ commentId: "0", emoji: "👍" });
      fireEvent.click(view.getByRole("button", { name: "Quote 1" }));
      expect(props.onToggleQuote).toHaveBeenCalledWith("1");
    } finally {
      observer.destroy();
      client.clear();
    }
  });

  it("keeps filters and the pagination ref outside row memoization, and updates permissions", () => {
    const { renders } = observeRows();
    const first = row("first");
    const last = row("last");
    const props = listProps([first, first, { ...row("other"), conversationId: "other" }, row("deleted"), last]);
    props.deletedCommentIds.add("deleted");
    const view = render(<ConversationComments {...props} />);
    expect(renders).toHaveBeenCalledTimes(2);
    expect(view.queryByTestId("other")).toBeNull();
    expect(view.queryByTestId("deleted")).toBeNull();
    expect(props.setLastElement).toHaveBeenLastCalledWith(view.getByTestId("last").parentElement);
    renders.mockClear();

    const older = row("older");
    view.rerender(<ConversationComments {...props} pages={pages([first, last, older])} />);
    expect(renders).toHaveBeenCalledTimes(1);
    expect(props.setLastElement).toHaveBeenLastCalledWith(view.getByTestId("older").parentElement);
    view.rerender(<ConversationComments {...props} pages={pages([first, last, older])} canInteract={false} />);
    expect(view.getByRole("button", { name: "React first" }).hasAttribute("disabled")).toBe(true);
    expect(view.getByRole("button", { name: "Quote first" }).hasAttribute("disabled")).toBe(true);
    for (const [rendered] of renders.mock.calls.slice(-3)) expect(rendered.canEdit).toBe(false);
  });
});
