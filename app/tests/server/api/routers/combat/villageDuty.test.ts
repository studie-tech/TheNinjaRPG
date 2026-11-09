import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { prepareVillageDutyDefender } from "@/libs/combat/initiation";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import {
  fakeInitiationClient,
  makeInitiationUser,
} from "../../../../libs/combat/helpers/preload";

const owner = () =>
  makeInitiationUser({
    userId: "owner",
    villageId: "home",
    villageDutyVillageId: "home",
    villageDutyStartedAt: new Date("2026-11-09"),
    status: "ASLEEP",
    curHealth: 1,
  });
describe("village duty combat isolation", () => {
  beforeEach(() => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());
  it.each(["VILLAGE_PROTECTOR", "SHRINE_WAR"] as const)(
    "admits only the attacker for %s and never publishes a battle to the owner",
    async (battleType) => {
      const defender = { ...owner(), joinedVillageAt: new Date("2026-01-01") };
      const before = structuredClone(defender);
      const fake = fakeInitiationClient([
        makeInitiationUser({ userId: "attacker", villageId: "enemy" }),
        defender,
      ]);
      const predicates: string[] = [];
      const client = Object.create(fake.client) as DrizzleClient;
      client.update = (() => ({
        set: () => ({
          where: (predicate: Parameters<MySqlDialect["sqlToQuery"]>[0]) => {
            const query = new MySqlDialect().sqlToQuery(predicate);
            predicates.push(JSON.stringify(query));
            return Promise.resolve({ rowsAffected: 1 });
          },
        }),
      })) as unknown as DrizzleClient["update"];
      const result = await initiateBattle(
        {
          client,
          userIds: ["attacker"],
          targetIds: ["duty:owner"],
          villageDuty: { userId: "owner", villageId: "home" },
          forceDefenderVillageId: "home",
        },
        battleType,
      );
      expect(result.success).toBe(true);
      const copy = fake
        .saved()
        ?.usersState.find((u) => u.controllerId === "duty:owner");
      expect(copy?.isAi).toBe(true);
      expect(copy?.userId).not.toBe("owner");
      expect(copy?.curHealth).toBe(copy?.maxHealth);
      expect(copy?.spriteAppearance).toBeDefined();
      expect(predicates.join()).not.toContain('"owner"');
      expect(Pusher.prototype.trigger).not.toHaveBeenCalledWith(
        "owner",
        expect.anything(),
        expect.anything(),
      );
      expect(defender).toEqual(before);
    },
  );
  it("rejects a cancelled enrollment before battle writes", async () => {
    const fake = fakeInitiationClient([
      makeInitiationUser({ userId: "attacker" }),
      { ...owner(), villageDutyVillageId: null },
    ]);
    const result = await initiateBattle(
      {
        client: fake.client,
        userIds: ["attacker"],
        targetIds: ["duty:owner"],
        villageDuty: { userId: "owner", villageId: "home" },
      },
      "VILLAGE_PROTECTOR",
    );
    expect(result.success).toBe(false);
    expect(fake.saved()).toBeUndefined();
  });
  it("gives the copy independent inventory with no drops, active queues, or reward receipts", () => {
    const defender = {
      ...owner(),
      joinedVillageAt: new Date("2026-01-01"),
      items: [
        {
          id: "owned-blade",
          userId: "owner",
          dropChancePerc: 100,
          quantity: 1,
          equipped: "HAND_1",
          item: { id: "blade", itemType: "WEAPON", slot: "HAND_1", lpcProfile: "NONE" },
        },
      ],
      queue: [{ id: "job" }],
      bounties: [{ id: "bounty" }],
      activePetId: "pet",
    };
    const copy = prepareVillageDutyDefender(
      defender as unknown as Parameters<typeof prepareVillageDutyDefender>[0],
      "home",
    );
    expect(copy?.userId).toBe("duty:owner");
    expect(copy?.queue).toEqual([]);
    expect(copy?.bounties).toEqual([]);
    expect(copy?.activePetId).toBeNull();
    expect(copy?.items[0]?.dropChancePerc).toBe(0);
    expect(copy?.items[0]?.id).not.toBe("owned-blade");
    expect(defender.items[0]?.dropChancePerc).toBe(100);
    expect(defender.queue).toHaveLength(1);
    expect(defender.userId).toBe("owner");
  });
});
