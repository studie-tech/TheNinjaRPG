import { describe, it, expect } from "vitest";
import { canViewConversation } from "@/utils/permissions";

// Minimal helper to construct a conversation-like object
const makeConversation = (opts?: Partial<any>) =>
  ({
    id: "convo1",
    title: "Test",
    createdById: "creator",
    isPublic: false,
    isLocked: 0,
    isStaffAvailable: true,
    users: [],
    ...(opts || {}),
  }) as any;

describe("canViewConversation", () => {
  it("allows CONTENT to view private conversations when staff is available", () => {
    const convo = makeConversation({ isPublic: false, isStaffAvailable: true, users: [] });
    expect(canViewConversation(convo, "random-user", "CONTENT")).toBe(true);
  });

  it("allows CODER to view private conversations when staff is available", () => {
    const convo = makeConversation({ isPublic: false, isStaffAvailable: true, users: [] });
    expect(canViewConversation(convo, "random-user", "CODER")).toBe(true);
  });

  it("does not allow USER to view private conversations when not in conversation", () => {
    const convo = makeConversation({ isPublic: false, isStaffAvailable: true, users: [] });
    expect(canViewConversation(convo, "random-user", "USER")).toBe(false);
  });

  it("allows USER to view public conversations", () => {
    const convo = makeConversation({ isPublic: true, isStaffAvailable: false });
    expect(canViewConversation(convo, "random-user", "USER")).toBe(true);
  });

  it("allows USER to view private conversations when in the conversation", () => {
    const convo = makeConversation({
      isPublic: false,
      isStaffAvailable: false,
      users: [{ userId: "random-user" }],
    });
    expect(canViewConversation(convo, "random-user", "USER")).toBe(true);
  });
});
