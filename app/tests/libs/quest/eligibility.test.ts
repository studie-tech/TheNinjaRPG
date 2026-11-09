
import { describe, expect, it } from "bun:test";
import { QUESTS_CONCURRENT_LIMIT } from "@/drizzle/constants";
import { questTypeConcurrentBlockMessage } from "@/libs/quest/missionHall";
import type { DrizzleClient } from "@/server/db";
import { fetchUncompletedQuests } from "@/server/utils/questAssignment";
import { planetScaleFixture } from "../../setup/planetscale";

/** Creates a minimal user fixture with unfinished quests of the supplied types. */
const userWith = (active: { questType: string; endAt?: Date | null }[]) =>
  ({
    userQuests: active.map((q, i) => ({
      questId: `a${i}`,
      questType: q.questType,
      endAt: q.endAt ?? null,
      quest: { questType: q.questType, name: `${q.questType}-${i}` },
    })),
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

  it.each(["story", "hunting", "gathering", "anbu", "event"])(
    "enforces the shared %s concurrent limit",
    (questType) => {
      const active = Array.from({ length: QUESTS_CONCURRENT_LIMIT }, () => ({
        questType,
      }));
      expect(
        questTypeConcurrentBlockMessage(
          { questType, name: "Next" } as never,
          userWith(active),
        ),
      ).toContain(`active ${questType}`);
    },
  );

  it.each(["battlepyramid", "starter"])(
    "enforces the single-active limit for %s quests",
    (questType) => {
      expect(
        questTypeConcurrentBlockMessage(
          { questType, name: "Next" } as never,
          userWith([{ questType }]),
        ),
      ).not.toBeNull();
    },
  );

  it("tells the player where to abandon an unfinished Battle Pyramid run", () => {
    const msg = questTypeConcurrentBlockMessage(
      { questType: "battlepyramid", name: "Next" } as never,
      userWith([{ questType: "battlepyramid" }]),
    );
    expect(msg).toBe(
      "You have an unfinished Battle Pyramid run (battlepyramid-0). Go to Battle Arena → Battle Pyramid and abandon it to start this quest.",
    );
  });

  it("ignores completed history rows when enforcing concurrency", () => {
    expect(
      questTypeConcurrentBlockMessage(
        { questType: "story", name: "Next" } as never,
        userWith(
          Array.from({ length: QUESTS_CONCURRENT_LIMIT }, () => ({
            questType: "story",
            endAt: new Date(),
          })),
        ),
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

  it.each(["mission", "crime", "errand", "medical", "pvp"])(
    "blocks the mission-family slot when %s is active",
    (activeType) => {
      expect(
        questTypeConcurrentBlockMessage(
          { questType: "medical", name: "Next" } as never,
          userWith([{ questType: activeType }]),
        ),
      ).not.toBeNull();
    },
  );

  it("lets unrelated quest types coexist", () => {
    expect(
      questTypeConcurrentBlockMessage(
        { questType: "story", name: "Next" } as never,
        userWith([{ questType: "hunting" }, { questType: "mission" }]),
      ),
    ).toBeNull();
  });
});

describe("fetchUncompletedQuests date window", () => {
  it("prefilters currently active quests instead of future or expired quests", async () => {
    const { database, statements } = planetScaleFixture(() => ({ rows: [] }));
    await fetchUncompletedQuests(
      database as unknown as DrizzleClient,
      {
        userId: "user-1",
        rank: "JONIN",
        role: "USER",
        level: 50,
        villageId: "village-1",
        bloodlineId: null,
      } as never,
      "tier",
    );

    // The PlanetScale client inlines bound values, so the window bounds arrive as literals.
    expect(statements[0]).toMatch(/startsAt[^)]*<= '/i);
    expect(statements[0]).toMatch(/endsAt[^)]*>= '/i);
  });
});
