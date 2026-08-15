import { describe, expect, it } from "vitest";
import { questTypeConcurrentBlockMessage } from "@/routers/quests";
import { QUESTS_CONCURRENT_LIMIT } from "@/drizzle/constants";

/** Creates a minimal user fixture with unfinished quests of the supplied types. */
const userWith = (active: { questType: string }[]) =>
  ({
    userQuests: active.map((q, i) => ({ questId: `a${i}`, endAt: null, quest: q })),
  }) as never;

describe("questTypeConcurrentBlockMessage", () => {
  it("blocks a story quest at the concurrent limit", () => {
    const active = Array.from({ length: QUESTS_CONCURRENT_LIMIT }, () => ({
      questType: "story",
    }));
    const msg = questTypeConcurrentBlockMessage(
      { questType: "story", name: "X" } as never,
      userWith(active),
    );
    expect(msg).toContain("active story");
  });

  it("allows a story quest below the limit", () => {
    expect(
      questTypeConcurrentBlockMessage(
        { questType: "story", name: "X" } as never,
        userWith([]),
      ),
    ).toBeNull();
  });

  it("does NOT block starting a mission when only a war quest is active", () => {
    expect(
      questTypeConcurrentBlockMessage(
        { questType: "mission", name: "X" } as never,
        userWith([{ questType: "war" }]),
      ),
    ).toBeNull();
  });

  it("blocks starting a war when a mission quest is active", () => {
    expect(
      questTypeConcurrentBlockMessage(
        { questType: "war", name: "X" } as never,
        userWith([{ questType: "mission" }]),
      ),
    ).not.toBeNull();
  });
});
