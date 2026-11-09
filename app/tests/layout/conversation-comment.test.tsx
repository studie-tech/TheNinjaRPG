import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  InfiniteQueryObserver,
  QueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { ComponentProps } from "react";
import { type Control, useController } from "react-hook-form";
import * as client from "@/app/_trpc/client";
import { CommentOnConversation } from "@/layout/Comment";
import * as CommentModule from "@/layout/Comment";
import * as Avatar from "@/layout/Avatar";
import { CompactComment } from "@/layout/CompactComment";
import * as PostModule from "@/layout/Post";
import * as Confirm from "@/layout/Confirm";
import * as EmojiPicker from "@/layout/EmojiPicker";
import * as ModerationSummary from "@/layout/ModerationSummary";
import { ConversationComments } from "@/layout/ConversationComments";
import type { PostProps } from "@/layout/Post";
import * as Report from "@/layout/Report";
import * as RichInput from "@/layout/RichInput";
import type { MutateCommentSchema } from "@/validators/comments";
import * as Parse from "@/utils/parse";
import * as UserContext from "@/utils/UserContext";
import { conversationQueryOptions } from "../setup/conversationQueryOptions";
import { spyOnToasts } from "../setup/toastMock";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

const edit = vi.fn();
const api = {
  useUtils: () => ({ comments: { getConversationComments: { invalidate: vi.fn() } } }),
  profile: {
    toggleBlacklistEntry: {
      useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    },
  },
  comments: {
    editConversationComment: {
      useMutation: () => ({ mutate: edit, isPending: false }),
    },
    deleteConversationComment: {
      useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    },
  },
};
const EditorInput = ({
  control,
  disabled,
}: {
  control: Control<MutateCommentSchema>;
  disabled?: boolean;
}) => {
  const { field } = useController({ control, name: "comment" });
  return (
    <>
      <textarea aria-label="Edit message" {...field} disabled={disabled} />
      <button type="submit" disabled={disabled}>
        Save message
      </button>
    </>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(vi.spyOn(client, "api" as never), api);
  vi.spyOn(UserContext, "useUserData").mockReturnValue({
    data: { userId: "friend", role: "USER" },
  } as never);
  spyOnToasts();
  vi.spyOn(RichInput, "default").mockImplementation(EditorInput as never);
  vi.spyOn(ModerationSummary, "ModerationSummary").mockImplementation(() => null);
  vi.spyOn(Report, "default").mockImplementation(() => null);
  vi.spyOn(EmojiPicker, "EmojiPicker").mockImplementation(() => null);
  vi.spyOn(PostModule, "default").mockImplementation(({ children, options }) => (
    <div>
      {options}
      {children}
    </div>
  ));
  vi.spyOn(Confirm, "default").mockImplementation(() => null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const comment = {
  id: "message",
  conversationId: "conversation",
  content: "Saved message",
  userId: "friend",
  authorId: "friend",
  createdAt: new Date(),
  reactions: {},
  isPinned: false,
  isReported: false,
  isStaffOnly: false,
};
const user: PostProps["user"] = {
  userId: "friend",
  username: "Friend",
  avatar: null,
  level: 50,
  rank: "GENIN",
  isOutlaw: false,
  role: "USER",
  federalStatus: "NONE",
};
const message = (canEdit?: boolean) => (
  <CommentOnConversation comment={comment} user={user} canEdit={canEdit}>
    {comment.content}
  </CommentOnConversation>
);
const toggleEdit = (view: ReturnType<typeof render>) => {
  const toggle = view.container.querySelector(".lucide-square-pen");
  expect(toggle).not.toBeNull();
  fireEvent.click(toggle!);
};

describe("conversation comment editing permissions", () => {
  it("shows the saved message when an open editor loses permission and retains the draft for recovery", () => {
    const view = render(message(true));
    toggleEdit(view);
    fireEvent.change(view.getByRole("textbox", { name: "Edit message" }), {
      target: { value: "Unsent draft" },
    });

    view.rerender(message(false));
    expect(view.queryByRole("textbox", { name: "Edit message" }) === null).toBe(true);
    expect(view.queryByRole("button", { name: "Save message" }) === null).toBe(true);
    expect(view.container.querySelector(".lucide-square-pen") === null).toBe(true);
    expect(view.getByText(comment.content)).toBeTruthy();
    expect(edit).not.toHaveBeenCalled();

    view.rerender(message(true));
    expect(
      (view.getByRole("textbox", { name: "Edit message" }) as HTMLTextAreaElement)
        .value,
    ).toBe("Unsent draft");
    toggleEdit(view);
    expect(view.queryByRole("textbox", { name: "Edit message" }) === null).toBe(true);
    expect(view.getByText(comment.content)).toBeTruthy();
  });

  it("keeps normal editing and submission available when permission is omitted", async () => {
    const view = render(message());
    toggleEdit(view);
    fireEvent.change(view.getByRole("textbox", { name: "Edit message" }), {
      target: { value: "Edited message" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save message" }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(edit).toHaveBeenCalledWith({
      object_id: comment.id,
      comment: "Edited message",
      quoteIds: null,
      senderId: null,
    });
  });
});

describe("editing a message that quotes another", () => {
  const quote =
    '<blockquote author="twix" date="11/04/2026"><p>only cuz someone asked</p></blockquote>';
  const quoted = {
    ...comment,
    content: `${quote}\n\n<p>add them to the blocklist</p>`,
  };

  it("edits only the author's own text and names the quote it keeps", async () => {
    const view = render(
      <CommentOnConversation comment={quoted} user={user}>
        {quoted.content}
      </CommentOnConversation>,
    );
    toggleEdit(view);
    const box = view.getByRole("textbox", {
      name: "Edit message",
    }) as HTMLTextAreaElement;
    expect(box.value).toBe("<p>add them to the blocklist</p>");
    expect(view.getByText("Quoting twix")).toBeTruthy();
    fireEvent.change(box, { target: { value: "<p>blocklist them</p>" } });
    fireEvent.click(view.getByRole("button", { name: "Save message" }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    // The server puts the stored quote back in front.
    expect(edit.mock.calls[0]?.[0]).toMatchObject({ comment: "<p>blocklist them</p>" });
  });

  it("does the same in the compact tavern view", async () => {
    const editComment = vi.fn();
    const view = render(
      <CompactComment
        user={user!}
        comment={quoted}
        editing
        setEditing={() => {}}
        editComment={editComment}
      >
        {quoted.content}
      </CompactComment>,
    );
    const box = view.getByRole("textbox", {
      name: "Edit message",
    }) as HTMLTextAreaElement;
    expect(box.value).toBe("<p>add them to the blocklist</p>");
    expect(view.getByText("Quoting twix")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Save message" }));
    await waitFor(() => expect(editComment).toHaveBeenCalledTimes(1));
    expect(editComment.mock.calls[0]?.[0]).toMatchObject({
      comment: "<p>add them to the blocklist</p>",
    });
  });
});

describe("conversation emoji picker", () => {
  it("opens from the reaction button, survives rerenders, and closes on an outside press or a second click", async () => {
    installBrowserGlobals({ resizeObserver: true });
    const toggleReaction = vi.fn();
    const view = render(
      <CommentOnConversation
        comment={comment}
        user={user}
        toggleReaction={toggleReaction}
      >
        {comment.content}
      </CommentOnConversation>,
    );
    try {
      const trigger = view.getByRole("button", { name: "Add reaction" });
      expect(view.queryByRole("dialog")).toBeNull();
      await act(async () => {
        fireEvent.click(trigger);
      });
      await waitFor(() => expect(view.getByRole("dialog")).toBeTruthy());

      view.rerender(
        <CommentOnConversation
          comment={{ ...comment, reactions: { "👍": ["Friend"] } }}
          user={user}
          toggleReaction={toggleReaction}
        >
          {comment.content}
        </CommentOnConversation>,
      );
      expect(view.getByRole("dialog")).toBeTruthy();

      await act(flushRadixFocus);
      await act(async () => {
        fireEvent.pointerDown(document.body);
        fireEvent.click(document.body);
      });
      await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());

      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Add reaction" }));
      });
      await waitFor(() => expect(view.getByRole("dialog")).toBeTruthy());
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Add reaction" }));
      });
      await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    } finally {
      view.unmount();
      await act(flushRadixFocus);
      restoreBrowserGlobals();
    }
  });
});

type ListProps = ComponentProps<typeof ConversationComments>;
type ChatPage = NonNullable<ListProps["pages"]>[number];
type ReturnedComment = ChatPage["data"][number];
const row = (id: string): ReturnedComment => ({
  ...comment,
  ...user,
  id,
  content: `Message ${id}`,
  villageName: null,
  villageHexColor: null,
  villageKageId: null,
  displayTitle: "",
  tavernUsernameColor: "DEFAULT",
  tavernTitleColor: "DEFAULT",
  nRecruited: 0,
  tavernMessages: 0,
});
const pages = (data: ReturnedComment[]): ListProps["pages"] => [
  {
    convo: {
      id: "conversation",
      title: "Conversation",
      createdById: "friend",
      createdAt: comment.createdAt,
      updatedAt: comment.createdAt,
      isLocked: false,
      isPublic: true,
      isStaffAvailable: false,
      isEnabled: true,
      readRestriction: null,
      sendRestriction: null,
      supportTicketCreatorId: null,
      users: [],
    },
    data,
    nextCursor: null,
    restrictionMessage: null,
  },
];
const listProps = (data: ReturnedComment[]): ListProps => ({
  pages: pages(data),
  conversationId: "conversation",
  deletedCommentIds: new Set(),
  quoteIds: [],
  username: "Reader",
  canInteract: true,
  setLastElement: vi.fn(),
  onReact: vi.fn(),
  onToggleQuote: vi.fn(),
  onDeleted: vi.fn(),
});

describe("conversation comment row isolation", () => {
  const observeRows = () => {
    const renders = vi
      .spyOn(CommentModule, "CommentOnConversation")
      .mockImplementation((props) => (
        <div data-testid={props.comment.id}>
          {props.children}
          <button
            type="button"
            disabled={!props.toggleReaction}
            onClick={() => props.toggleReaction?.("👍")}
          >
            React {props.comment.id}
          </button>
          <button
            type="button"
            disabled={!props.setQuoteId}
            onClick={() => props.setQuoteId?.(props.comment.id)}
          >
            Quote {props.comment.id}
          </button>
        </div>
      ));
    const parses = vi
      .spyOn(Parse, "parseHtml")
      .mockImplementation((content) => [<span key="parsed">{content}</span>]);
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
    // Each row names its message, so a quote can jump to it.
    const rows = Array.from(view.container.querySelectorAll("[data-comment-id]"));
    expect(rows.map((element) => element.getAttribute("data-comment-id"))).toEqual([
      "1",
      "2",
      "3",
    ]);
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
      client.setQueryData<InfiniteData<ChatPage>>(
        queryKey,
        (old) =>
          old && {
            pageParams: old.pageParams,
            pages: old.pages.map((page) =>
              page.convo ? { ...page, data: mapData(page.data) } : page,
            ),
          },
      );
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

      update((data) =>
        data.map((comment) =>
          comment.id === "0"
            ? { ...comment, reactions: { "👍": ["Reader"] } }
            : comment,
        ),
      );
      view.rerender(<ConversationComments {...props} pages={cached().pages} />);
      expect(renders).toHaveBeenCalledTimes(1);
      expect(renders.mock.calls[0]?.[0].comment.id).toBe("0");
      expect(parses).not.toHaveBeenCalled();
      renders.mockClear();

      view.rerender(
        <ConversationComments {...props} pages={cached().pages} quoteIds={["1"]} />,
      );
      expect(renders).toHaveBeenCalledTimes(1);
      expect(renders.mock.calls[0]?.[0].comment.id).toBe("1");
      expect(renders.mock.calls[0]?.[0].quoteIds).toEqual(["1"]);
      expect(parses).not.toHaveBeenCalled();
      renders.mockClear();

      update((data) =>
        data.map((comment) =>
          comment.id === "0" ? { ...comment, content: "Edited" } : comment,
        ),
      );
      view.rerender(
        <ConversationComments {...props} pages={cached().pages} quoteIds={["1"]} />,
      );
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
    const props = listProps([
      first,
      first,
      { ...row("other"), conversationId: "other" },
      row("deleted"),
      last,
    ]);
    props.deletedCommentIds.add("deleted");
    const view = render(<ConversationComments {...props} />);
    expect(renders).toHaveBeenCalledTimes(2);
    expect(view.queryByTestId("other")).toBeNull();
    expect(view.queryByTestId("deleted")).toBeNull();
    expect(props.setLastElement).toHaveBeenLastCalledWith(
      view.getByTestId("last").parentElement,
    );
    renders.mockClear();

    const older = row("older");
    view.rerender(
      <ConversationComments {...props} pages={pages([first, last, older])} />,
    );
    expect(renders).toHaveBeenCalledTimes(1);
    expect(props.setLastElement).toHaveBeenLastCalledWith(
      view.getByTestId("older").parentElement,
    );
    view.rerender(
      <ConversationComments
        {...props}
        pages={pages([first, last, older])}
        canInteract={false}
      />,
    );
    expect(
      view.getByRole("button", { name: "React first" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      view.getByRole("button", { name: "Quote first" }).hasAttribute("disabled"),
    ).toBe(true);
    for (const [rendered] of renders.mock.calls.slice(-3))
      expect(rendered.canEdit).toBe(false);
  });
});

describe("compact chat identity", () => {
  it("uses Tavern title colours and preserves the custom avatar in the larger preview", async () => {
    installBrowserGlobals({ resizeObserver: true });
    const avatar = vi
      .spyOn(Avatar, "default")
      .mockImplementation((props) => (
        <img src={props.href ?? undefined} alt={props.alt} width={props.size} />
      ));
    try {
      const styledUser = {
        ...user,
        displayTitle: "Village Guardian",
        tavernTitleColor: "COBALT" as const,
        avatar: "https://example.com/custom-avatar.gif",
      };
      const view = render(
        <CompactComment
          user={styledUser}
          comment={comment}
          tavernStyling
          editing={false}
          setEditing={() => {}}
        >
          Message
        </CompactComment>,
      );
      expect(view.getByText("Village Guardian").className).toContain("bg-cyan-500");
      expect(view.getByText("Village Guardian").className).toContain("text-black");
      fireEvent.click(view.getByRole("button", { name: "Actions for Friend" }));
      const images = view.getAllByRole("img", { name: "Friend" }) as HTMLImageElement[];
      expect(
        images.some((image) => image.width === 160 && image.src === styledUser.avatar),
      ).toBe(true);
      expect(
        view.getByRole("menuitem", { name: "See profile" }).getAttribute("href"),
      ).toBe("/username/Friend");
      view.unmount();
      await act(flushRadixFocus);
    } finally {
      avatar.mockRestore();
      restoreBrowserGlobals();
    }
  });
});

describe("compact message reactions", () => {
  it("names who reacted on the button and in a tooltip, and toggles on click", async () => {
    const descriptors = ["Event", "CustomEvent", "ResizeObserver"].map((name) =>
      Object.getOwnPropertyDescriptor(globalThis, name),
    );
    Object.defineProperties(globalThis, {
      Event: { configurable: true, value: window.Event },
      CustomEvent: { configurable: true, value: window.CustomEvent },
      ResizeObserver: {
        configurable: true,
        value: class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      },
    });
    try {
      const toggleReaction = vi.fn();
      const reacted = { ...comment, reactions: { "👍": ["Ana", "Ben", "Cy"] } };
      const view = render(
        <CompactComment
          user={user}
          comment={reacted}
          editing={false}
          setEditing={() => {}}
          toggleReaction={toggleReaction}
        >
          Message
        </CompactComment>,
      );
      const reaction = view.getByRole("button", {
        name: "👍 3, reacted by Ana, Ben and Cy",
      });
      expect(reaction.className).toContain("cursor-pointer");
      act(() => fireEvent.focus(reaction));
      await waitFor(() =>
        expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(
          "3 reacted with 👍",
        ),
      );
      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(
        "Cy",
      );
      fireEvent.click(reaction);
      expect(toggleReaction).toHaveBeenCalledWith("👍");
      view.unmount();
    } finally {
      ["Event", "CustomEvent", "ResizeObserver"].forEach((name, index) => {
        const descriptor = descriptors[index];
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      });
    }
  });
});
