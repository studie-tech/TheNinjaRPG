import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { MAP_WAKE_ISLAND_SECTOR, PET_BATTLE_CONFIG } from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  jutsu,
  petSpecies,
  userData,
  userJutsu,
  userPet,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import { petsRouter } from "@/server/api/routers/pets";
import type { DrizzleClient } from "@/server/db";
import { petJutsuFixture } from "../../../../libs/pets/helpers/abilities";
import { initialPetSpecies } from "../../../../libs/pets/helpers/species";
import { deferred } from "../../../../setup/deferred";
import {
  insertDefaultAiProfile,
  insertPetSpecies,
  insertUserPets,
  insertUsers,
} from "../../../../setup/factories";
import { beforeStatements, overrideQuery } from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const ownerId = "defender";

describeWithDatabase("companion battle preload consistency", () => {
  let previousBattleEnabled = PET_BATTLE_CONFIG.enabled;
  beforeEach(async () => {
    previousBattleEnabled = PET_BATTLE_CONFIG.enabled;
    PET_BATTLE_CONFIG.enabled = true;
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      petSpecies,
      battle,
      aiProfile,
      userJutsu,
      jutsu,
      userPet,
      userData,
    );
    await insertPetSpecies(initialPetSpecies);
    await insertUsers([
      {
        userId: "attacker",
        username: "Attacker",
        rank: "GENIN",
        level: 5,
        status: "AWAKE",
      },
      {
        userId: ownerId,
        username: "Defender",
        rank: "GENIN",
        level: 5,
        status: "AWAKE",
        activePetId: "first",
        petSlots: 3,
        sector: MAP_WAKE_ISLAND_SECTOR,
      },
    ]);
    const database = await getTestDatabase();
    await insertDefaultAiProfile();
    await insertUserPets(
      ["first", "second"].map((id) => ({
        id,
        userId: ownerId,
        name: id,
        generationStatus: "READY" as const,
        artRank: 1,
        avatar: "/pet.png",
        battleEnabled: true,
        jutsuIds: [`${id}-strike`],
      })),
    );
    await database
      .insert(jutsu)
      .values(
        ["first", "second"].map((id) =>
          petJutsuFixture({ id: `${id}-strike`, name: `${id} strike` }),
        ),
      );
  });
  afterEach(() => {
    PET_BATTLE_CONFIG.enabled = previousBattleEnabled;
    vi.restoreAllMocks();
  });

  it("starts battles without companion reads or actors when companion battles are disabled", async () => {
    PET_BATTLE_CONFIG.enabled = false;
    const database = await getTestDatabase();
    const petReads = vi.spyOn(database.query.userPet, "findMany");
    const jutsuReads = vi.spyOn(database.query.jutsu, "findMany");
    expect((await startBattle(database)).success).toBe(true);
    expect(petReads).not.toHaveBeenCalled();
    expect(
      jutsuReads.mock.calls.some(([options]) => typeof options?.where === "function"),
    ).toBe(false);
    const saved = (await database.query.battle.findFirst())!;
    expect(saved.usersState.filter((actor) => actor.petId)).toHaveLength(0);
    expect(saved.extraState.petIdsByOwner).toEqual({});
    expect(
      Object.keys(saved.extraState.aiProfiles).some((id) => id.startsWith("pet:")),
    ).toBe(false);
    expect(Object.keys(saved.extraState.jutsus)).not.toContain("first-strike");
    expect(
      await database.query.userPet.findFirst({ where: eq(userPet.id, "first") }),
    ).toMatchObject({ battleEnabled: true });
  });

  it("selects the active companion and its published jutsu without player ownership after both preloads precede a successful swap", async () => {
    const database = await getTestDatabase();
    const client = beforeParticipantRead(database, async () => {
      expect(
        (
          await callerForDatabase(petsRouter, ownerId, database).activatePet({
            petId: "second",
          })
        ).success,
      ).toBe(true);
    });
    expect((await startBattle(client)).success).toBe(true);
    const saved = (await database.query.battle.findFirst())!;
    const pets = saved.usersState.filter((actor) => actor.petId);
    expect(pets).toHaveLength(1);
    expect(pets[0]).toMatchObject({ petId: "second", controllerId: ownerId });
    expect(pets[0]!.jutsus.map((entry) => entry.jutsuId)).toEqual(["second-strike"]);
    expect(saved.extraState.petIdsByOwner).toEqual({ [ownerId]: "second" });
  });

  it.each(["none", "disabled", "pending"] as const)(
    "allows a stable %s companion selection without adding a combatant",
    async (state) => {
      const database = await getTestDatabase();
      if (state === "none")
        await database
          .update(userData)
          .set({ activePetId: null })
          .where(eq(userData.userId, ownerId));
      else
        await database
          .update(userPet)
          .set(
            state === "disabled"
              ? { battleEnabled: false }
              : { generationStatus: "PENDING" },
          )
          .where(eq(userPet.id, "first"));
      expect((await startBattle(database)).success).toBe(true);
      const saved = (await database.query.battle.findFirst())!;
      expect(saved.usersState.filter((actor) => actor.petId)).toHaveLength(0);
      expect(saved.extraState.petIdsByOwner).toEqual({});
    },
  );

  it("rejects an adopted active identity missing from the collection preload before claiming a battle", async () => {
    const database = await getTestDatabase();
    await database.delete(userPet);
    await database
      .update(userData)
      .set({ activePetId: null })
      .where(eq(userData.userId, ownerId));
    const input = await adoptionInput(database);
    const client = beforeParticipantRead(database, async () => {
      expect(
        (await callerForDatabase(petsRouter, ownerId, database).acquirePet(input))
          .success,
      ).toBe(true);
    });
    expect((await startBattle(client)).success).toBe(false);
    expect(await database.query.battle.findMany()).toHaveLength(0);
    const owner = (await database.query.userData.findFirst({
      where: eq(userData.userId, ownerId),
    }))!;
    expect(owner.activePetId).not.toBeNull();
    expect(owner).toMatchObject({ status: "AWAKE", battleId: null });
  });

  it.each(["adopt", "release inactive", "release active"] as const)(
    "uses the owner selection after a same-owner %s between preloads",
    async (operation) => {
      const database = await getTestDatabase();
      const input = await adoptionInput(database);
      const client = beforeParticipantRead(database, async () => {
        const caller = callerForDatabase(petsRouter, ownerId, database);
        const result =
          operation === "adopt"
            ? await caller.acquirePet(input)
            : await caller.releasePet({
                petId: operation === "release active" ? "first" : "second",
              });
        expect(result.success).toBe(true);
      });
      expect((await startBattle(client)).success).toBe(true);
      const saved = (await database.query.battle.findFirst())!;
      expect(
        saved.usersState.filter((actor) => actor.petId).map((actor) => actor.petId),
      ).toEqual(operation === "release active" ? [] : ["first"]);
    },
  );

  it("retains the final participant guard when activation follows all preload reads", async () => {
    const database = await getTestDatabase();
    const client = beforeStatements(database, userData, [
      async () => {
        expect(
          (
            await callerForDatabase(petsRouter, ownerId, database).activatePet({
              petId: "second",
            })
          ).success,
        ).toBe(true);
      },
    ]);
    expect((await startBattle(client)).success).toBe(false);
    expect(await database.query.battle.findMany()).toHaveLength(0);
    expect(
      await database.query.userData.findFirst({ where: eq(userData.userId, ownerId) }),
    ).toMatchObject({ activePetId: "second", status: "AWAKE", battleId: null });
  });

  it("keeps an already-away companion out of the frozen battle state", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({
        petTask: {
          petId: "first",
          questId: "contract",
          questHistoryId: "attempt",
          startedAt: 1,
          questVersion: 1,
          finishesAt: 2,
        },
      })
      .where(eq(userData.userId, ownerId));
    expect((await startBattle(database)).success).toBe(true);
    const saved = (await database.query.battle.findFirst())!;
    expect(saved.usersState.some((actor) => actor.petId)).toBe(false);
    expect(saved.extraState.petIdsByOwner).toEqual({});
  });

  it("rejects a dispatch that wins after battle preloads, before claiming participants", async () => {
    const database = await getTestDatabase();
    const task = {
      petId: "first",
      questId: "contract",
      questHistoryId: "attempt",
      startedAt: 1,
      questVersion: 1,
      finishesAt: 2,
    };
    const client = beforeStatements(database, userData, [
      async () => {
        await database
          .update(userData)
          .set({ petTask: task })
          .where(eq(userData.userId, ownerId));
      },
    ]);
    expect((await startBattle(client)).success).toBe(false);
    expect(await database.query.battle.findMany()).toHaveLength(0);
    expect(
      await database.query.userData.findFirst({ where: eq(userData.userId, ownerId) }),
    ).toMatchObject({ petTask: task, status: "AWAKE", battleId: null });
  });
});

const startBattle = (client: DrizzleClient) =>
  initiateBattle({ client, userIds: ["attacker"], targetIds: [ownerId] }, "QUEST");

const adoptionInput = async (database: DrizzleClient) => {
  const data = await callerForDatabase(petsRouter, ownerId, database).getPet();
  return {
    currency: "REPUTATION" as const,
    name: "Kumo",
    gender: "MALE" as const,
    dayKey: data.dayKey,
    speciesId: data.options.species[0]!.id,
    paletteIndex: data.options.palettes[0]!.index,
    characteristicIndex: data.options.characteristics[0]!.index,
    auraIndex: data.options.auras[0]!.index,
  };
};

/** Complete real companion reads before a successful account mutation and the participant read. */
const beforeParticipantRead = (
  database: DrizzleClient,
  change: () => Promise<void>,
): DrizzleClient => {
  let completed = 0;
  const { promise: preloaded, resolve: release } = deferred<void>();
  const afterRead = async <T>(read: PromiseLike<T>) => {
    const result = await read;
    if (++completed === 2) release();
    return result;
  };
  const pets = overrideQuery(database, "userPet", {
    findMany: (read, ...args) => afterRead(read(...args)),
  });
  const jutsus = overrideQuery(pets, "jutsu", {
    findMany: (read, ...args) =>
      typeof args[0]?.where === "function" ? afterRead(read(...args)) : read(...args),
  });
  return overrideQuery(jutsus, "userData", {
    findMany: async (read, ...args) => {
      await preloaded;
      await change();
      return read(...args);
    },
  });
};
