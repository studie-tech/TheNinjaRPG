import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  ANBU_ESPIONAGE_UPGRADE_COST,
  ANBU_MAX_ESPIONAGE_LEVEL,
  ANBU_MAX_STEALTH_LEVEL,
  ANBU_STEALTH_UPGRADE_COST,
} from "@/drizzle/constants";
import { anbuSquad, userData } from "@/drizzle/schema";
import { anbuRouter } from "@/server/api/routers/anbu";
import { insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const input = { squadId: "squad" };
const upgrades = [
  {
    name: "espionage",
    column: "espionageLevel",
    procedure: "purchaseEspionageUpgrade",
    cost: ANBU_ESPIONAGE_UPGRADE_COST,
    maxLevel: ANBU_MAX_ESPIONAGE_LEVEL,
    message: "Espionage level upgraded",
    maxedMessage: "Max espionage level reached",
  },
  {
    name: "stealth",
    column: "stealthLevel",
    procedure: "purchaseStealthUpgrade",
    cost: ANBU_STEALTH_UPGRADE_COST,
    maxLevel: ANBU_MAX_STEALTH_LEVEL,
    message: "Stealth level upgraded",
    maxedMessage: "Max stealth level reached",
  },
] as const;

describeWithDatabase("ANBU squad upgrades", () => {
  beforeEach(async () => {
    await resetTables(anbuSquad, userData);
    await insertUsers([
      { userId: "leader", username: "leader", anbuId: "squad" },
      { userId: "member", username: "member", anbuId: "squad" },
    ]);
  });

  const seedSquad = async (values: Partial<typeof anbuSquad.$inferInsert>) => {
    const db = await getTestDatabase();
    await db.insert(anbuSquad).values({
      id: "squad",
      image: "/squad.webp",
      name: "Squad",
      villageId: "village",
      leaderId: "leader",
      kageOrderId: "kage-order",
      leaderOrderId: "leader-order",
      ...values,
    });
  };
  const storedSquad = async () =>
    (await getTestDatabase()).query.anbuSquad.findFirst({
      where: eq(anbuSquad.id, "squad"),
    });

  for (const upgrade of upgrades) {
    it(`buys one ${upgrade.name} level for its cost`, async () => {
      await seedSquad({ points: upgrade.cost + 1 });
      const caller = await callerFor(anbuRouter, "leader");
      const result = await caller[upgrade.procedure](input);
      expect(result).toEqual({ success: true, message: upgrade.message });
      const squad = await storedSquad();
      expect(squad?.points).toBe(1);
      expect(squad?.[upgrade.column]).toBe(1);
    });

    it(`keeps ${upgrade.name} guards for members, balance and the level cap`, async () => {
      await seedSquad({ points: upgrade.cost, [upgrade.column]: upgrade.maxLevel });
      const member = await callerFor(anbuRouter, "member");
      expect((await member[upgrade.procedure](input)).message).toBe("Not squad leader");
      const leader = await callerFor(anbuRouter, "leader");
      expect((await leader[upgrade.procedure](input)).message).toBe(
        upgrade.maxedMessage,
      );
      const db = await getTestDatabase();
      await db.update(anbuSquad).set({ points: upgrade.cost - 1 });
      expect((await leader[upgrade.procedure](input)).message).toBe(
        "Not enough squad points",
      );
    });

    it(`stops a stale ${upgrade.name} purchase at the level cap`, async () => {
      await seedSquad({
        points: upgrade.cost * 2,
        [upgrade.column]: upgrade.maxLevel - 1,
      });
      const db = await getTestDatabase();
      // The loser read the squad below the cap, so only the write can stop it.
      const raced = beforeStatements(db, anbuSquad, [
        async () =>
          (await callerFor(anbuRouter, "leader"))
            [upgrade.procedure](input)
            .then((result) => expect(result.success).toBe(true)),
      ]);
      const result = await callerForDatabase(anbuRouter, "leader", raced)[
        upgrade.procedure
      ](input);
      expect(result).toEqual({ success: false, message: "Not enough squad points" });
      const squad = await storedSquad();
      expect(squad?.points).toBe(upgrade.cost);
      expect(squad?.[upgrade.column]).toBe(upgrade.maxLevel);
    });
  }
});
