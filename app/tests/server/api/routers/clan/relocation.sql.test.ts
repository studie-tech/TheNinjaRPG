import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { MAP_RESERVED_SECTORS } from "@/drizzle/constants";
import {
  clan,
  sector,
  sectorMap,
  userData,
  village,
  villageStructure,
  war,
  warAlly,
} from "@/drizzle/schema";
import { clanRouter } from "@/server/api/routers/clan";
import { villageRouter } from "@/server/api/routers/village";
import {
  fetchPublishedSectorMaps,
  invalidatePublishedMapCache,
} from "@/server/utils/sectorMap";
import { insertClans, insertUsers } from "../../../../setup/factories";
import { huntingMap } from "../../../../setup/hunting";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const input = { clanId: "faction", sector: 1500 };

describeWithDatabase("Stronghold relocation", () => {
  beforeEach(async () => {
    await resetTables(
      warAlly,
      war,
      sector,
      clan,
      userData,
      village,
      sectorMap,
      villageStructure,
    );
    invalidatePublishedMapCache();
    const db = await getTestDatabase();
    await db.insert(sectorMap).values(
      [1500, 1501].map((sector) => ({
        id: `map-${sector}`,
        sector,
        name: "Destination",
        status: "PUBLISHED" as const,
        width: 32,
        height: 32,
        normalizedJson: { ...huntingMap(), sector, width: 32, height: 32 },
      })),
    );

    await db.insert(village).values({
      id: "home",
      name: "Home",
      sector: 301,
      kageId: "leader",
      type: "STRONGHOLD",
    });
    await insertClans([
      {
        id: "faction",
        name: "Faction",
        villageId: "home",
        leaderId: "leader",
        hasHideout: true,
      },
    ]);
    await insertUsers([
      {
        userId: "leader",
        username: "Leader",
        villageId: "home",
        clanId: "faction",
        isOutlaw: true,
      },
      {
        userId: "member",
        username: "Member",
        villageId: "home",
        clanId: "faction",
        isOutlaw: true,
      },
    ]);
    await db.insert(sector).values([
      { sector: 301, villageId: "home", shrineLevel: 3 },
      { sector: 302, villageId: "home", shrineLevel: 2 },
    ]);
  });

  it("moves the home shrine once, preserves territory, balances and player positions", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(clanRouter, "leader");
    const original = await db.query.userData.findFirst();
    expect((await caller.relocateStronghold(input)).success).toBe(true);
    expect(await db.query.village.findFirst()).toMatchObject({
      sector: 1500,
      strongholdRelocatedAt: expect.any(Date),
    });
    expect(await db.query.sector.findMany()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sector: 1500, villageId: "home", shrineLevel: 3 }),
        expect.objectContaining({ sector: 302, villageId: "home", shrineLevel: 2 }),
      ]),
    );
    expect(await db.query.userData.findFirst()).toMatchObject({
      sector: original?.sector,
    });
    expect((await caller.relocateStronghold({ ...input, sector: 1501 })).success).toBe(
      false,
    );
    expect(await db.query.village.findFirst()).toMatchObject({ sector: 1500 });
  });

  it("relocates a stronghold whose home shrine is absent", async () => {
    const db = await getTestDatabase();
    await db.delete(sector).where(eq(sector.sector, 301));
    expect(
      (await (await callerFor(clanRouter, "leader")).relocateStronghold(input)).success,
    ).toBe(true);
    expect(await db.query.village.findFirst()).toMatchObject({ sector: 1500 });
    expect(await db.query.sector.findMany()).toHaveLength(1);
  });

  it("does not move a foreign-owned home shrine", async () => {
    const db = await getTestDatabase();
    await db.update(sector).set({ villageId: "enemy" }).where(eq(sector.sector, 301));
    expect(
      (await (await callerFor(clanRouter, "leader")).relocateStronghold(input)).success,
    ).toBe(false);
  });

  it("rejects missing maps and destinations too small for the settlement", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(clanRouter, "leader");
    expect((await caller.relocateStronghold({ ...input, sector: 1600 })).success).toBe(
      false,
    );
    await db.insert(villageStructure).values({
      id: "hall",
      villageId: "home",
      name: "Hall",
      route: "/townhall",
      image: "",
      longitude: 50,
      latitude: 50,
      hasPage: 1,
    });
    expect((await caller.relocateStronghold(input)).success).toBe(false);
    expect(await db.query.village.findFirst()).toMatchObject({
      sector: 301,
      strongholdRelocatedAt: null,
    });
  });

  it("rechecks a cached destination after another instance unpublishes it", async () => {
    const db = await getTestDatabase();
    await fetchPublishedSectorMaps(db, [1500]);
    await db
      .update(sectorMap)
      .set({ status: "ARCHIVED" })
      .where(eq(sectorMap.sector, 1500));
    expect(
      (await (await callerFor(clanRouter, "leader")).relocateStronghold(input)).success,
    ).toBe(false);
    expect(await db.query.village.findFirst()).toMatchObject({
      sector: 301,
      strongholdRelocatedAt: null,
    });
  });

  it("allows only the current outlaw faction leader", async () => {
    const member = await callerFor(clanRouter, "member");
    expect((await member.relocateStronghold(input)).success).toBe(false);
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ isOutlaw: false })
      .where(eq(userData.userId, "leader"));
    expect(
      (await (await callerFor(clanRouter, "leader")).relocateStronghold(input)).success,
    ).toBe(false);
  });

  it("rejects a hideout, reserved sectors, invalid sectors and the current home", async () => {
    const caller = await callerFor(clanRouter, "leader");
    for (const destination of [MAP_RESERVED_SECTORS[0]!, 1_000_000, 301]) {
      expect(
        (await caller.relocateStronghold({ ...input, sector: destination })).success,
      ).toBe(false);
    }
    await (await getTestDatabase()).update(village).set({ type: "HIDEOUT" });
    expect((await caller.relocateStronghold(input)).success).toBe(false);
  });

  it.each(["settlement", "territory"])(
    "rejects an occupied %s without consuming relocation",
    async (kind) => {
      const db = await getTestDatabase();
      if (kind === "settlement")
        await db
          .insert(village)
          .values({ id: "other", name: "Other", sector: 1500, kageId: "other" });
      else await db.insert(sector).values({ sector: 1500, villageId: "other" });
      expect(
        (await (await callerFor(clanRouter, "leader")).relocateStronghold(input))
          .success,
      ).toBe(false);
      expect(
        await db.query.village.findFirst({ where: eq(village.id, "home") }),
      ).toMatchObject({ sector: 301, strongholdRelocatedAt: null });
      expect(
        await db.query.sector.findFirst({ where: eq(sector.sector, 301) }),
      ).toMatchObject({ shrineLevel: 3 });
    },
  );

  it.each(["direct", "ally", "destination"])(
    "blocks %s war participation",
    async (kind) => {
      const db = await getTestDatabase();
      await db.insert(war).values({
        id: "conflict",
        attackerVillageId: kind === "direct" ? "home" : "other",
        defenderVillageId: "enemy",
        status: "ACTIVE",
        type: "SECTOR_WAR",
        sector: kind === "destination" ? 1500 : 400,
      });
      if (kind === "ally") {
        await db.insert(war).values({
          id: "finished",
          attackerVillageId: "other",
          defenderVillageId: "enemy",
          status: "DRAW",
          type: "SECTOR_WAR",
        });
        await db.insert(warAlly).values([
          {
            id: "active-ally",
            warId: "conflict",
            villageId: "home",
            supportVillageId: "other",
            tokensPaid: 0,
          },
          {
            id: "past-ally",
            warId: "finished",
            villageId: "home",
            supportVillageId: "other",
            tokensPaid: 0,
          },
        ]);
      }
      expect(
        (await (await callerFor(clanRouter, "leader")).relocateStronghold(input))
          .success,
      ).toBe(false);
    },
  );

  it("allows exactly one concurrent relocation", async () => {
    const caller = await callerFor(clanRouter, "leader");
    const results = await Promise.all([
      caller.relocateStronghold(input),
      caller.relocateStronghold({ ...input, sector: 1501 }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const db = await getTestDatabase();
    const home = await db.query.village.findFirst();
    expect(
      await db.query.sector.findFirst({ where: eq(sector.sector, home!.sector) }),
    ).toMatchObject({ villageId: "home", shrineLevel: 3 });
  });

  it("includes captured sectors and homes without shrine rows in globe ownership", async () => {
    const db = await getTestDatabase();
    await db
      .insert(village)
      .values({ id: "other", name: "Other", sector: 1500, kageId: "other" });
    const result = await (await callerFor(villageRouter, "leader")).getSectorOwnerships(
      { onlyOwnWar: true },
    );
    expect(result.sectors).toEqual(
      expect.arrayContaining([
        { sector: 301, villageId: "home" },
        { sector: 302, villageId: "home" },
        { sector: 1500, villageId: "other" },
      ]),
    );
    expect(result.sectors.filter((entry) => entry.sector === 301)).toHaveLength(1);
  });
});
