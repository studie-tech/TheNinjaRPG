import { describe, expect, it, vi } from "bun:test";
import { fetchConversation } from "@/server/api/routers/comments";
import type { DrizzleClient } from "@/server/db";
import { deferred } from "../../../setup/deferred";

describe("conversation read scheduling", () => {
  it("starts the reader policy before a public title lookup resolves", async () => {
    const { promise: conversation, resolve: resolveConversation } = deferred<unknown>();
    const { promise: policies, resolve: resolvePolicies } = deferred<unknown[]>();
    const findConversation = vi.fn(() => conversation);
    const findPolicies = vi.fn(() => policies);
    const client = {
      query: {
        conversation: { findFirst: findConversation },
        parentalControl: { findMany: findPolicies },
      },
    } as unknown as DrizzleClient;

    const pending = fetchConversation({ client, title: "Global", userId: "reader" });
    const startedTogether =
      findConversation.mock.calls.length === 1 && findPolicies.mock.calls.length === 1;
    resolveConversation({
      id: "public",
      isPublic: true,
      isStaffAvailable: false,
      users: [],
    });
    resolvePolicies([{ userId: "reader", enabled: true, tavernDisabled: true }]);

    const result = await pending;
    expect(startedTogether).toBe(true);
    expect(result?.readRestriction).toContain("disabled");
    expect(result?.sendRestriction).toBe(result?.readRestriction);
    expect(findPolicies).toHaveBeenCalledTimes(1);
  });
});
