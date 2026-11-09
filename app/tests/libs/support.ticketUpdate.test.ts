import { describe, expect, it } from "bun:test";
import {
  getNextClosedAt,
  getStatusAfterComment,
  getTicketUpdateActivities,
} from "@/libs/support";

const now = new Date("2026-10-08T10:00:00Z");
const earlier = new Date("2026-10-01T10:00:00Z");

describe("getNextClosedAt", () => {
  it("stamps closedAt when a ticket is resolved or closed", () => {
    expect(getNextClosedAt("IN_PROGRESS", "RESOLVED", null, now)).toEqual(now);
    expect(getNextClosedAt("OPEN", "CLOSED", null, now)).toEqual(now);
  });

  it("keeps the original closedAt when moving between resolved and closed", () => {
    expect(getNextClosedAt("RESOLVED", "CLOSED", earlier, now)).toEqual(earlier);
    expect(getNextClosedAt("CLOSED", "CLOSED", earlier, now)).toEqual(earlier);
  });

  it("stamps a closed ticket that never got a closedAt", () => {
    expect(getNextClosedAt("RESOLVED", "CLOSED", null, now)).toEqual(now);
  });

  it("clears closedAt when a ticket is reopened", () => {
    expect(getNextClosedAt("CLOSED", "OPEN", earlier, now)).toBeNull();
    expect(getNextClosedAt("RESOLVED", "OPEN", earlier, now)).toBeNull();
  });

  it("leaves closedAt alone without a status change", () => {
    expect(getNextClosedAt("RESOLVED", undefined, earlier, now)).toEqual(earlier);
    expect(getNextClosedAt("OPEN", undefined, null, now)).toBeNull();
  });
});

describe("getTicketUpdateActivities", () => {
  const ticket = {
    status: "OPEN" as const,
    priority: "MEDIUM" as const,
    category: "BUG_REPORT" as const,
    assignedToUserId: null,
    isPublic: true,
    tags: ["bug", "combat"],
    description: "Original description",
  };

  it("logs visibility changes", () => {
    expect(getTicketUpdateActivities(ticket, { isPublic: false })).toEqual([
      {
        action: "UPDATED",
        oldValue: "public",
        newValue: "private",
        metadata: { field: "isPublic" },
      },
    ]);
  });

  it("logs each added and removed tag", () => {
    expect(getTicketUpdateActivities(ticket, { tags: ["bug", "quests"] })).toEqual([
      { action: "TAGGED", newValue: "quests" },
      { action: "UNTAGGED", oldValue: "combat" },
    ]);
  });

  it("logs description edits without storing the text", () => {
    expect(getTicketUpdateActivities(ticket, { description: "New text" })).toEqual([
      { action: "UPDATED", metadata: { field: "description" } },
    ]);
  });

  it("returns nothing when no field changes", () => {
    expect(
      getTicketUpdateActivities(ticket, {
        status: "OPEN",
        isPublic: true,
        tags: ["combat", "bug"],
        description: "Original description",
      }),
    ).toEqual([]);
  });

  it("keeps logging status, priority, category and assignment changes", () => {
    expect(
      getTicketUpdateActivities(ticket, {
        status: "CLOSED",
        priority: "HIGH",
        category: "OTHER",
        assignedToUserId: "staff-1",
      }).map((activity) => activity.action),
    ).toEqual(["STATUS_CHANGED", "PRIORITY_CHANGED", "CATEGORY_CHANGED", "ASSIGNED"]);
  });
});

describe("getStatusAfterComment", () => {
  const creator = { isCreator: true, isStaff: false };
  const staff = { isCreator: false, isStaff: true };
  const otherPlayer = { isCreator: false, isStaff: false };

  it("keeps an unanswered ticket open when its creator replies", () => {
    expect(getStatusAfterComment("OPEN", creator)).toBeUndefined();
  });

  it("hands a ticket staff picked up back to them when its creator replies", () => {
    expect(getStatusAfterComment("IN_PROGRESS", creator)).toBe("WAITING_FOR_STAFF");
    expect(getStatusAfterComment("WAITING_FOR_USER", creator)).toBe(
      "WAITING_FOR_STAFF",
    );
    expect(getStatusAfterComment("WAITING_FOR_STAFF", creator)).toBeUndefined();
  });

  it("treats a staff member replying on their own ticket as the creator", () => {
    expect(
      getStatusAfterComment("OPEN", { isCreator: true, isStaff: true }),
    ).toBeUndefined();
  });

  it("puts an active ticket in progress when staff reply", () => {
    expect(getStatusAfterComment("OPEN", staff)).toBe("IN_PROGRESS");
    expect(getStatusAfterComment("WAITING_FOR_STAFF", staff)).toBe("IN_PROGRESS");
    expect(getStatusAfterComment("WAITING_FOR_USER", staff)).toBe("IN_PROGRESS");
    expect(getStatusAfterComment("IN_PROGRESS", staff)).toBeUndefined();
  });

  it("leaves the status alone for other players and closed tickets", () => {
    expect(getStatusAfterComment("OPEN", otherPlayer)).toBeUndefined();
    expect(getStatusAfterComment("IN_PROGRESS", otherPlayer)).toBeUndefined();
    for (const status of ["RESOLVED", "CLOSED"] as const) {
      expect(getStatusAfterComment(status, creator)).toBeUndefined();
      expect(getStatusAfterComment(status, staff)).toBeUndefined();
    }
  });
});
