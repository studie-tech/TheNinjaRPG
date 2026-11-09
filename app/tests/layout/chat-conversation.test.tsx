import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ChatConversation } from "@/layout/ChatConversation";
import * as conversation from "@/layout/Conversation";
import * as comments from "@/layout/ConversationComments";
import * as input from "@/layout/RichInput";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("follows the player's own message and its server replacement without counting either as unseen", () => {
  let allComments = [{ id: "old", authorId: "friend" }];
  const getValues = () => "";
  const setValue = vi.fn();
  vi.spyOn(conversation, "useConversation").mockImplementation(
    () =>
      ({
        userData: { userId: "me" },
        conversation: { id: "chat", title: "Chat" },
        allComments,
        comments: { pages: [] },
        quoteIds: [],
        typingUsers: new Map(),
        getValues,
        setValue,
        canComposeMessage: true,
        errors: {},
      }) as never,
  );
  vi.spyOn(comments, "ConversationComments").mockReturnValue(<></>);
  vi.spyOn(input, "default").mockReturnValue(<></>);
  const view = render(<ChatConversation convoId="chat" />);
  const log = view.getByRole("log");
  Object.defineProperties(log, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 100 },
  });
  log.scrollTop = 0;
  fireEvent.scroll(log);
  allComments = [{ id: "incoming", authorId: "friend" }, ...allComments];
  view.rerender(<ChatConversation convoId="chat" />);
  expect(view.getByRole("button", { name: /1 new message/ })).toBeTruthy();
  allComments = [{ id: "optimistic", authorId: "me" }, ...allComments];
  view.rerender(<ChatConversation convoId="chat" />);
  expect(log.scrollTop).toBe(1000);
  expect(view.queryByRole("button", { name: /new message/ })).toBeNull();
  allComments = [{ id: "saved", authorId: "me" }, ...allComments.slice(1)];
  view.rerender(<ChatConversation convoId="chat" />);
  expect(log.scrollTop).toBe(1000);
  expect(view.queryByRole("button", { name: /new message/ })).toBeNull();
});
