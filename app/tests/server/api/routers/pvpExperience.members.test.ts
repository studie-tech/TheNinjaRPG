import { beforeEach, expect, it } from "bun:test";
import { anbuSquad, clan, userData } from "@/drizzle/schema";
import { fetchSquad } from "@/queries/anbu";
import { fetchClan } from "@/queries/clan";

import { insertClans, insertUsers } from "../../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("PvP experience in member lists", () => {
  beforeEach(async () => {
    await resetTables(userData, anbuSquad, clan);
    const database = await getTestDatabase();
    await database.insert(anbuSquad).values({
      id: "xp-squad",
      name: "XP Squad",
      image: "/squad.png",
      villageId: "village",
      kageOrderId: "kage-order",
      leaderOrderId: "squad-order",
      pvpActivity: 42,
    });
    await insertClans([
      {
        id: "xp-clan",
        name: "XP Clan",
        villageId: "village",
        leaderId: "xp-member",
        leaderOrderId: "clan-order",
        pvpActivity: 17,
      },
    ]);
    await insertUsers([
      {
        userId: "xp-member",
        username: "XpMember",
        anbuId: "xp-squad",
        clanId: "xp-clan",
        pvpExperience: 1234.5,
        pvpStreak: 4,
      },
    ]);
  });

  it("returns player XP while preserving separate clan and squad activity totals", async () => {
    const database = await getTestDatabase();
    const [squad, playerClan] = await Promise.all([
      fetchSquad(database, "xp-squad"),
      fetchClan(database, "xp-clan"),
    ]);
    expect(squad?.pvpActivity).toBe(42);
    expect(playerClan?.pvpActivity).toBe(17);
    for (const members of [squad?.members, playerClan?.members]) {
      expect(members).toHaveLength(1);
      expect(members?.[0]).toMatchObject({
        userId: "xp-member",
        pvpExperience: 1234.5,
      });
      expect(members?.[0]).not.toHaveProperty("pvpActivity");
    }
  });
});
