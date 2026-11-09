import { describe, expect, it } from "bun:test";
import type { DrizzleClient } from "@/server/db";
import {
  canEnterWarCamp,
  canEnterWarCampSector,
  fetchWarCampEntry,
} from "@/server/utils/warMercenary";
import { defaultWarRules } from "@/validators/war";
import { deferred } from "../../setup/deferred";

type Entry = Awaited<ReturnType<typeof fetchWarCampEntry>>;
const outsider = { userId: "visitor", villageId: "neutral", sector: 11 };
const activeWar = (overrides: Partial<Entry["wars"][number]> = {}) =>
  ({
    id: "war",
    status: "ACTIVE",
    attackerVillageId: "attacker",
    defenderVillageId: "defender",
    attackerWarHealth: 100,
    defenderWarHealth: 100,
    combatStartedAt: new Date(Date.now() - 60_000),
    endedAt: null,
    rules: defaultWarRules,
    warAllies: [],
    warMercenaries: [],
    ...overrides,
  }) as Entry["wars"][number];
const entry = (wars = [activeWar()], mercenaryWarId: string | null = null): Entry => ({
  wars,
  mercenaryWarId,
});

describe("war camp entry snapshots", () => {
  it("admits both native sides, allies and hired mercenaries, but rejects outsiders", () => {
    expect(canEnterWarCamp(entry(), outsider, 12)).toBe(false);
    for (const villageId of ["attacker", "defender"]) {
      expect(canEnterWarCamp(entry(), { ...outsider, villageId }, 12)).toBe(true);
    }
    expect(
      canEnterWarCamp(
        entry([
          activeWar({
            warAllies: [
              { villageId: "neutral", supportVillageId: "attacker" },
            ] as never,
          }),
        ]),
        outsider,
        12,
      ),
    ).toBe(true);
    expect(
      canEnterWarCamp(
        entry(
          [
            activeWar({
              warMercenaries: [
                { userId: "visitor", sideVillageId: "defender" },
              ] as never,
            }),
          ],
          "war",
        ),
        { ...outsider, villageId: null },
        12,
      ),
    ).toBe(true);
  });

  it("preserves exclusive mercenary affiliation and requires membership in every active camp war", () => {
    const native = { ...outsider, villageId: "attacker" };
    expect(canEnterWarCamp(entry([activeWar()], "another-war"), native, 12)).toBe(
      false,
    );
    expect(
      canEnterWarCamp(
        entry([
          activeWar(),
          activeWar({ id: "another-war", attackerVillageId: "other-attacker" }),
        ]),
        native,
        12,
      ),
    ).toBe(false);
  });

  it("allows unrestricted destinations and ignores inactive, expired and defeated wars", () => {
    expect(canEnterWarCamp(entry([]), outsider, 12)).toBe(true);
    for (const overrides of [
      { status: "DRAW" as const },
      { endedAt: new Date() },
      { attackerWarHealth: 0 },
      { defenderWarHealth: 0 },
      { combatStartedAt: new Date(Date.now() + 60_000) },
      {
        combatStartedAt: new Date(
          Date.now() - (defaultWarRules.durationDays + 1) * 86_400_000,
        ),
      },
    ]) {
      expect(canEnterWarCamp(entry([activeWar(overrides)]), outsider, 12)).toBe(true);
    }
  });

  it("keeps existing occupants admitted without issuing fallback reads", async () => {
    expect(canEnterWarCamp(entry(), { ...outsider, sector: 12 }, 12)).toBe(true);
    expect(
      await canEnterWarCampSector({} as DrizzleClient, { ...outsider, sector: 12 }, 12),
    ).toBe(true);
  });

  it("starts both independent reads before either resolves", async () => {
    const reads: string[] = [];
    const { promise: wars, resolve: finishWars } = deferred<Entry["wars"]>();
    const client = {
      query: {
        war: {
          findMany: () => {
            reads.push("wars");
            return wars;
          },
        },
      },
      select: () => ({
        from: () => ({
          where: () => ({}),
          innerJoin: () => ({
            where: async () => {
              reads.push("mercenary");
              return [{ warId: "war" }];
            },
          }),
        }),
      }),
    } as unknown as DrizzleClient;
    const pending = fetchWarCampEntry(client, outsider.userId, 12);
    expect(reads).toEqual(["wars", "mercenary"]);
    const resolvedWars = [activeWar()];
    finishWars(resolvedWars);
    expect(await pending).toEqual(entry(resolvedWars, "war"));
  });
});
