import { describe, expect, it } from "bun:test";
import { type CoopParty, transitionCoopParty } from "@/libs/coop";

const party = (overrides: Partial<CoopParty> = {}): CoopParty => ({
  leaderId: "a",
  memberIds: ["a"],
  invitedIds: [],
  readyIds: [],
  isPublic: false,
  phase: "LOBBY",
  ...overrides,
});

describe("co-op party policies", () => {
  it("allows public quest replacements, but keeps started dungeon rosters fixed", () => {
    expect(
      transitionCoopParty(
        "quest",
        party({ phase: "ACTIVE", isPublic: true }),
        "b",
        "join",
      ),
    ).toMatchObject({ success: true, party: { memberIds: ["a", "b"] } });
    expect(
      transitionCoopParty(
        "dungeon",
        party({ phase: "BETWEEN", invitedIds: ["b"] }),
        "b",
        "join",
      ).success,
    ).toBe(false);
  });
  it("reserves dungeon invitation slots without limiting quest invitations to vacant seats", () => {
    const full = party({ memberIds: ["a", "b", "c"] });
    expect(transitionCoopParty("quest", full, "a", "invite", "d").success).toBe(true);
    expect(transitionCoopParty("dungeon", full, "a", "invite", "d").success).toBe(
      false,
    );
    expect(transitionCoopParty("quest", full, "d", "join").success).toBe(false);
  });
  it("requires invitations for private parties and prevents duplicate membership", () => {
    expect(transitionCoopParty("quest", party(), "b", "join").success).toBe(false);
    expect(
      transitionCoopParty("quest", party({ isPublic: true }), "a", "join").success,
    ).toBe(false);
    expect(
      transitionCoopParty("dungeon", party({ invitedIds: ["b"] }), "b", "join"),
    ).toMatchObject({
      success: true,
      joinedUserId: "b",
      party: { memberIds: ["a", "b"], invitedIds: [] },
    });
  });
  it("transfers quest leadership, whereas a dungeon leader's departure ends the run", () => {
    const roster = party({ memberIds: ["a", "b"] });
    expect(transitionCoopParty("quest", roster, "a", "leave")).toMatchObject({
      success: true,
      ended: false,
      party: { leaderId: "b", memberIds: ["b"] },
    });
    expect(transitionCoopParty("dungeon", roster, "a", "leave")).toMatchObject({
      success: true,
      ended: true,
    });
    expect(
      transitionCoopParty("dungeon", { ...roster, phase: "BETWEEN" }, "b", "leave"),
    ).toMatchObject({ success: true, ended: true });
  });
  it("starts a solo quest, but requires three ready dungeon members and resets readiness on resume", () => {
    expect(
      transitionCoopParty("quest", party({ phase: "ACTIVE" }), "a", "start").success,
    ).toBe(true);
    expect(
      transitionCoopParty("dungeon", party({ readyIds: ["a"] }), "a", "start").success,
    ).toBe(false);
    const ready = party({ memberIds: ["a", "b", "c"], readyIds: ["a", "b", "c"] });
    expect(transitionCoopParty("dungeon", ready, "a", "start")).toMatchObject({
      success: true,
      party: { phase: "STARTING", readyIds: [] },
    });
    expect(
      transitionCoopParty("dungeon", { ...ready, phase: "PAUSED" }, "a", "resume"),
    ).toMatchObject({ success: true, party: { phase: "BETWEEN", readyIds: [] } });
  });
  it("rejects outsiders and nonleaders and never mutates a loaded snapshot", () => {
    const current = party({ memberIds: ["a", "b"], readyIds: ["a", "b"] });
    const snapshot = structuredClone(current);
    expect(transitionCoopParty("dungeon", current, "outsider", "ready").success).toBe(
      false,
    );
    expect(transitionCoopParty("quest", current, "b", "invite", "c").success).toBe(
      false,
    );
    expect(transitionCoopParty("dungeon", current, "a", "invite", "c")).toMatchObject({
      success: true,
      party: { readyIds: [] },
    });
    expect(current).toEqual(snapshot);
    expect(
      transitionCoopParty("quest", { ...current, phase: "FIGHTING" }, "b", "leave")
        .success,
    ).toBe(false);
  });
});
