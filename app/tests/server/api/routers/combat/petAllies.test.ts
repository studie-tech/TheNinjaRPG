import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { PET_BATTLE_CONFIG } from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  jutsu,
  petSpecies,
  skillTree,
  userData,
  userJutsu,
  userPet,
  userSkill,
} from "@/drizzle/schema";
import { getEffectiveMaxPool } from "@/libs/combat/util";
import { calcHP } from "@/libs/profile";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import {
  IncreaseDamageGivenTag,
  IncreaseMaxPoolsTag,
  IncreaseStatTag,
  SummonTag,
} from "@/validators/combat";
import {
  petJutsuFixture,
  petSkillFixture,
} from "../../../../libs/pets/helpers/abilities";
import { initialPetSpecies } from "../../../../libs/pets/helpers/species";
import {
  insertDefaultAiProfile,
  insertPetSpecies,
  insertUserPets,
  insertUsers,
} from "../../../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("companion ally passives at battle initiation", () => {
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
      userSkill,
      skillTree,
      userPet,
      userData,
    );
    await insertPetSpecies(initialPetSpecies);
  });
  afterEach(() => {
    PET_BATTLE_CONFIG.enabled = previousBattleEnabled;
    vi.restoreAllMocks();
  });

  it.each(["left", "right"] as const)(
    "includes only the caster's %s team and initializes pet pools once",
    async (direction) => {
      const client = await getTestDatabase();
      await insertUsers(
        ["caster", "ally", "enemy"].map((userId) => ({
          userId,
          username: userId,
          rank: "GENIN",
          level: 5,
          status: "AWAKE",
          activePetId: userId === "ally" ? null : `${userId}-pet`,
        })),
      );
      await insertUsers([
        { userId: "summon-template", username: "Summon", isAi: true, level: 50 },
      ]);
      await insertDefaultAiProfile();
      await client.insert(jutsu).values(
        petJutsuFixture({
          id: "summon",
          jutsuType: "NORMAL",
          effects: [SummonTag.parse({ aiId: "summon-template" })],
        }),
      );
      await client.insert(userJutsu).values({
        id: "owned-summon",
        userId: "caster",
        jutsuId: "summon",
        equipped: true,
      });
      await insertUserPets(
        ["caster", "enemy"].map((userId) => ({
          id: `${userId}-pet`,
          userId,
          name: `${userId} pet`,
          generationStatus: "READY" as const,
          artRank: 1,
          avatar: "/pet.png",
          battleEnabled: true,
        })),
      );
      const allies = petSkillFixture({
        id: "allies",
        name: "Allies",
        target: "ALLIES",
        effects: [
          IncreaseStatTag.parse({
            generalTypes: ["Strength"],
            power: 20,
            friendlyFire: "FRIENDLY",
          }),
          IncreaseMaxPoolsTag.parse({
            poolsAffected: ["Health"],
            calculation: "percentage",
            power: 20,
            friendlyFire: "FRIENDLY",
          }),
          IncreaseDamageGivenTag.parse({
            calculation: "percentage",
            power: 15,
            friendlyFire: "FRIENDLY",
          }),
        ],
      });
      const self = petSkillFixture({ id: "self", name: "Self" });
      const blocked = petSkillFixture({
        id: "blocked",
        name: "Blocked",
        target: "ALLIES",
        effects: [
          IncreaseStatTag.parse({
            generalTypes: ["Strength"],
            power: 999,
            friendlyFire: "ENEMIES",
          }),
        ],
      });
      await client.insert(skillTree).values([allies, self, blocked]);
      await client.insert(userSkill).values(
        [allies, self, blocked].map((skill) => ({
          id: `owned-${skill.id}`,
          userId: "caster",
          skillId: skill.id,
          activated: true,
        })),
      );

      expect(
        (
          await initiateBattle(
            {
              client,
              userIds: direction === "left" ? ["caster", "ally"] : ["enemy"],
              targetIds: direction === "left" ? ["enemy"] : ["caster", "ally"],
            },
            "QUEST",
          )
        ).success,
      ).toBe(true);
      const initialized = (await client.query.battle.findFirst())!;
      const caster = initialized.usersState.find((actor) => actor.userId === "caster")!;
      const pet = initialized.usersState.find((actor) => actor.petId === "caster-pet")!;
      const enemyPet = initialized.usersState.find(
        (actor) => actor.petId === "enemy-pet",
      )!;
      expect(pet).toMatchObject({
        direction,
        controllerId: "caster",
        activeSkillIds: [],
      });
      expect(enemyPet).toBeDefined();
      expect(
        initialized.usersState.some(
          (actor) => actor.isSummonTemplate && actor.controllerId === "summon-template",
        ),
      ).toBe(true);
      for (const type of ["increasestat", "increasemaxpools", "increasedamagegiven"]) {
        const effects = initialized.usersEffects.filter(
          (effect) => effect.actionId === allies.id && effect.type === type,
        );
        expect(effects.map((effect) => effect.targetId).sort()).toEqual(
          ["caster", "ally", pet.userId].sort(),
        );
        for (const effect of effects) {
          expect(effect).toMatchObject({
            creatorId: caster.userId,
            level: caster.level,
            highestGenerals: caster.highestGenerals,
            fromType: "skill",
            isNew: false,
            castThisRound: false,
          });
        }
      }
      expect(
        initialized.usersEffects
          .filter((effect) => effect.actionId === self.id)
          .map((effect) => effect.targetId),
      ).toEqual(["caster"]);
      expect(
        initialized.usersEffects.filter((effect) => effect.actionId === blocked.id),
      ).toHaveLength(0);
      expect(pet.maxHealth).toBe(calcHP(pet.level));
      expect(getEffectiveMaxPool(pet, initialized.usersEffects, "Health")).toBeCloseTo(
        calcHP(pet.level) * 1.2,
      );
      expect(pet.curHealth).toBeCloseTo(
        getEffectiveMaxPool(pet, initialized.usersEffects, "Health"),
      );
      expect(enemyPet.maxHealth).toBe(calcHP(enemyPet.level));
    },
  );
});
