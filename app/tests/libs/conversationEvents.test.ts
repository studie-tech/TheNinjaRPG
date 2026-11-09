import { expect, it, vi } from "bun:test";
import type Pusher from "pusher-js";
import {
  type ConversationEvent,
  subscribeConversation,
} from "@/libs/conversationEvents";
import { getNewReactions } from "@/utils/chat";

it("shares cache updates and keeps the conversation live until its last surface closes", () => {
  let receive!: (event: ConversationEvent) => void;
  const channel = {
    bind: vi.fn((_event, handler) => {
      receive = handler;
    }),
    unbind: vi.fn(),
  };
  const pusher = { subscribe: vi.fn(() => channel), unsubscribe: vi.fn() };
  let reactions: Record<string, string[]> = {};
  const typing = [vi.fn(), vi.fn()];
  const handler =
    (index: number) => (event: ConversationEvent, ownsCacheUpdate: boolean) => {
      if (event.message === "reaction" && ownsCacheUpdate) {
        reactions = getNewReactions(reactions, event.emoji!, event.username!);
      }
      if (event.message === "typing") typing[index]!();
    };
  const closePage = subscribeConversation(
    pusher as never as Pusher,
    "chat",
    "same-query",
    handler(0),
  );
  const closePanel = subscribeConversation(
    pusher as never as Pusher,
    "chat",
    "same-query",
    handler(1),
  );
  expect(channel.bind).toHaveBeenCalledTimes(1);
  receive({ message: "reaction", emoji: "👍", username: "Friend" });
  expect(reactions).toEqual({ "👍": ["Friend"] });
  receive({ message: "typing" });
  expect(typing[0]).toHaveBeenCalledTimes(1);
  expect(typing[1]).toHaveBeenCalledTimes(1);

  closePage();
  expect(pusher.unsubscribe).not.toHaveBeenCalled();
  receive({ message: "reaction", emoji: "👍", username: "Friend" });
  expect(reactions).toEqual({});
  closePanel();
  expect(channel.unbind).toHaveBeenCalledWith("event", receive);
  expect(pusher.unsubscribe).toHaveBeenCalledWith("chat");
});

it("updates distinct query caches independently on a shared channel", () => {
  let receive!: (event: ConversationEvent) => void;
  const channel = {
    bind: (_event: string, handler: typeof receive) => {
      receive = handler;
    },
    unbind: vi.fn(),
  };
  const pusher = { subscribe: () => channel, unsubscribe: vi.fn() } as never as Pusher;
  const page = vi.fn();
  const team = vi.fn();
  const closePage = subscribeConversation(pusher, "chat", "page-query", page);
  const closeTeam = subscribeConversation(pusher, "chat", "team-query", team);
  const event = { message: "new" };
  receive(event);
  expect(page).toHaveBeenCalledWith(event, true);
  expect(team).toHaveBeenCalledWith(event, true);
  closePage();
  closeTeam();
});
