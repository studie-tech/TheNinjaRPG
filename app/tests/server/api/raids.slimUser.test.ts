// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { Quest } from "@/drizzle/schema";
import { isRaidListedForVillage } from "@/libs/raids";
import { fetchRaidJoinUser, fetchRaidListUser } from "@/server/utils/raidUser";
import { RaidObjective, type QuestContentType } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";

const villageId = "village-1";
const now = new Date("2026-06-01T00:00:00.000Z");

type RaidListingInput = {
  content: Quest["content"];
  raidEndsAt: Date | null;
  raidCaptureDeadline: Date | null;
  raidGracePeriodEnd: Date | null;
};

const raid = (
  task: "open_raid" | "exclusive_raid",
  sector: number,
  extras: {
    raidEndsAt?: Date | null;
    raidCaptureDeadline?: Date | null;
    raidGracePeriodEnd?: Date | null;
  } = {},
): RaidListingInput => ({
  raidEndsAt: extras.raidEndsAt ?? new Date("2026-12-01T00:00:00.000Z"),
  raidCaptureDeadline: extras.raidCaptureDeadline ?? null,
  raidGracePeriodEnd: extras.raidGracePeriodEnd ?? null,
  content: {
    objectives: [
      RaidObjective.parse({
        id: `${task}-${sector}`,
        task,
        sector,
        opponentAIs: [{ ids: ["ai-1"], number: 100, quantity: 1 }],
      }),
    ],
    reward: ObjectiveReward.parse({}),
    sceneBackground: "",
    sceneCharacters: [],
  } satisfies QuestContentType,
});

describe("raid list/join slim user fetches", () => {
  it("loads only villageId and owned sectors for the list", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await fetchRaidListUser({ query: { userData: { findFirst } } } as never, "user-1");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: { villageId: true },
        with: {
          village: {
            columns: { id: true },
            with: { sectors: { columns: { sector: true } } },
          },
        },
      }),
    );
  });

  it("loads only ban, status, sector, and villageId for join guards", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await fetchRaidJoinUser({ query: { userData: { findFirst } } } as never, "user-1");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: {
          villageId: true,
          sector: true,
          status: true,
          isBanned: true,
        },
      }),
    );
    const columns = findFirst.mock.calls[0]?.[0]?.columns as Record<string, boolean>;
    expect(Object.keys(columns).sort()).toEqual(
      ["isBanned", "sector", "status", "villageId"].sort(),
    );
  });
});

describe("isRaidListedForVillage", () => {
  const owned = new Set([7]);
  const attacker = new Set([12]);

  it("hides ended raids", () => {
    expect(
      isRaidListedForVillage(
        raid("open_raid", 3, { raidEndsAt: new Date("2020-01-01T00:00:00.000Z") }),
        villageId,
        owned,
        attacker,
        now,
      ),
    ).toBe(false);
  });

  it("lists open raids without village membership", () => {
    expect(isRaidListedForVillage(raid("open_raid", 3), null, new Set(), new Set(), now)).toBe(
      true,
    );
  });

  it("lists exclusive raids the village owns", () => {
    expect(isRaidListedForVillage(raid("exclusive_raid", 7), villageId, owned, attacker, now)).toBe(
      true,
    );
    expect(isRaidListedForVillage(raid("exclusive_raid", 9), villageId, owned, attacker, now)).toBe(
      false,
    );
  });

  it("lists exclusive raids for attackers after the shrine falls", () => {
    expect(
      isRaidListedForVillage(raid("exclusive_raid", 12), villageId, new Set(), attacker, now),
    ).toBe(true);
  });

  it("hides exclusive raids with no villageId", () => {
    expect(isRaidListedForVillage(raid("exclusive_raid", 7), null, owned, attacker, now)).toBe(
      false,
    );
  });

  it("hides exclusive raids after the capture deadline when there is no grace period", () => {
    expect(
      isRaidListedForVillage(
        raid("exclusive_raid", 7, {
          raidCaptureDeadline: new Date("2020-01-01T00:00:00.000Z"),
          raidGracePeriodEnd: null,
        }),
        villageId,
        owned,
        attacker,
        now,
      ),
    ).toBe(false);
  });

  it("keeps exclusive raids visible during grace for current owners", () => {
    expect(
      isRaidListedForVillage(
        raid("exclusive_raid", 7, {
          raidCaptureDeadline: new Date("2020-01-01T00:00:00.000Z"),
          raidGracePeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
        }),
        villageId,
        owned,
        attacker,
        now,
      ),
    ).toBe(true);
  });
});
