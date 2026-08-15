// @vitest-environment node

import type { SQL } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import { QUESTS_CONCURRENT_LIMIT } from "@/drizzle/constants";
import { quest } from "@/drizzle/schema";
import {
  fetchUncompletedQuests,
  questTypeConcurrentBlockMessage,
} from "../../src/server/api/routers/quests";

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
    "preserves the shared %s concurrent limit extracted from startQuest",
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
    "preserves the single-active limit for %s quests",
    (questType) => {
      expect(
        questTypeConcurrentBlockMessage(
          { questType, name: "Next" } as never,
          userWith([{ questType }]),
        ),
      ).not.toBeNull();
    },
  );

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

describe("fetchUncompletedQuests date-window compatibility", () => {
  it("prefilters currently active quests instead of future or expired quests", async () => {
    let predicate: SQL | undefined;
    const orderBy = vi.fn().mockResolvedValue([]);
    const client = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          leftJoin: vi.fn(() => ({
            where: vi.fn((value: SQL) => {
              predicate = value;
              return { orderBy };
            }),
          })),
        })),
      })),
    };

    await fetchUncompletedQuests(
      client as never,
      {
        userId: "user-1",
        rank: "JONIN",
        role: "USER",
        level: 50,
        villageId: "village-1",
        bloodlineId: null,
      } as never,
      "mission",
    );

    if (!predicate) throw new Error("query predicate was not captured");
    const rendered = new QueryBuilder()
      .select()
      .from(quest)
      .where(predicate)
      .toSQL().sql;
    expect(rendered).toMatch(/startsAt[^)]*<= \?/i);
    expect(rendered).toMatch(/endsAt[^)]*>= \?/i);
  });
});
