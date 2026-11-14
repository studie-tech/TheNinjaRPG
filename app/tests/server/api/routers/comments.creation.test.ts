import { afterEach, expect, it, vi } from "bun:test";
import * as pusher from "@/libs/pusher";
import { createConvo } from "@/server/api/routers/comments";
import type { DrizzleClient } from "@/server/db";
import * as social from "@/server/utils/push/social";
import { deferred } from "../../../setup/deferred";

afterEach(() => vi.restoreAllMocks());

it.each([false, true])(
  "publishes the inbox event only after successful storage (failure: %s)",
  async (fail) => {
    const { promise: stored, resolve: finish } = deferred<void>();
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let completed = 0;
    const write = async () => {
      await stored;
      if (fail) throw new Error("Storage failed");
      completed++;
      return { rowsAffected: 1 };
    };
    const client = {
      insert: () => ({ values: write }),
      update: () => ({ set: () => ({ where: write }) }),
    } as unknown as DrizzleClient;
    const trigger = vi.fn(async () => {
      expect(completed).toBe(4);
    });
    vi.spyOn(pusher, "getServerPusher").mockReturnValue({ trigger } as never);
    const notify = vi
      .spyOn(social, "notifyPrivateConversation")
      .mockImplementation(() => {});
    const pending = createConvo({
      client,
      senderUserId: "sender",
      authorUserId: "sender",
      receiverUserIds: ["recipient"],
      title: "Test chat",
      content: "Hello there",
      convoId: "chat",
    });
    expect(trigger).not.toHaveBeenCalled();
    // Another write delays publication while a profile can already read the counter.
    now = 4_000;
    finish();
    if (fail) {
      await expect(pending).rejects.toThrow("Storage failed");
      expect(trigger).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    } else {
      expect(await pending).toBe("chat");
      expect(trigger).toHaveBeenCalledWith("recipient", "event", {
        type: "newInbox",
        conversationId: "chat",
        countedAt: 1_000,
      });
      expect(notify).toHaveBeenCalledTimes(1);
    }
  },
);
