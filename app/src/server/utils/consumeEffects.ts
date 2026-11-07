import { MAX_MARRIAGE_SLOTS } from "@/drizzle/constants";
import type { Item, UserData } from "@/drizzle/schema";
import type { filterRollableBloodlines } from "@/libs/bloodline";
import type { filterRollableSageModes } from "@/libs/sageMode";
import type { fetchItemBloodlineRolls } from "@/queries/bloodline";
import {
  insertBloodlineRollsForConsume,
  insertSageModeRollsForConsume,
  insertUserSkillForConsume,
  updateBloodlineRollsForConsume,
} from "@/queries/item";
import type { fetchUserSkills } from "@/queries/skillTree";
import { serverError } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { getRandomElement } from "@/utils/array";
import { HealTag, NonCombatGainSkill } from "@/validators/combat";
import { ObjectiveReward, type ObjectiveRewardType } from "@/validators/rewards";

/**
 * Resolve a consumable's effects against the validated snapshot, rolling each chance once.
 * Nothing is written here: `mutations` run with the guarded debit that consumes the item.
 * `bloodlinePools` and `sageModePool` must be non-empty for the rolls the item can make.
 */
export const planConsumeEffects = (info: {
  effects: Item["effects"];
  user: UserData;
  ctx: { userId: string };
  bloodlinePools: ReadonlyMap<string, ReturnType<typeof filterRollableBloodlines>>;
  sageModePool: ReturnType<typeof filterRollableSageModes>;
  previousRolls: Awaited<ReturnType<typeof fetchItemBloodlineRolls>>;
  userSkills: Awaited<ReturnType<typeof fetchUserSkills>>;
}) => {
  const { user, ctx, bloodlinePools, sageModePool, previousRolls, userSkills } = info;
  const messages: string[] = [];
  const updates = {
    sageModeId: user.sageModeId,
    curHealth: user.curHealth,
    curStamina: user.curStamina,
    curChakra: user.curChakra,
    marriageSlots: user.marriageSlots,
    extraReskinSlots: user.extraReskinSlots,
  };
  const rewards: ObjectiveRewardType[] = [];
  const mutations: ((client: DrizzleClient) => PromiseLike<unknown>)[] = [];
  // Only set when THIS request rolls a new sage mode; used as the COALESCE fallback at the
  // account claim so the snapshot write never resurrects a mode a concurrent removal cleared.
  let grantedSageModeId: string | null = null;
  let changedBloodlineId: string | null | undefined;
  for (const effect of info.effects) {
    if (effect.type === "rollbloodline") {
      const randomBloodline = getRandomElement(bloodlinePools.get(effect.rank));
      if (!randomBloodline) {
        throw serverError("NOT_FOUND", "No bloodline found");
      }
      // Success?
      const roll = Math.random() * 100;
      const success = roll < effect.power;
      // Log action
      const previousRoll = previousRolls.find((r) =>
        success
          ? r.bloodlineId === randomBloodline.id
          : r.goal === effect.rank && !r.bloodlineId,
      );
      if (previousRoll) {
        mutations.push((client) =>
          updateBloodlineRollsForConsume(client, previousRoll),
        );
      } else {
        mutations.push((client) =>
          insertBloodlineRollsForConsume(client, ctx, success, randomBloodline, effect),
        );
      }
      // Message
      if (success) {
        changedBloodlineId = randomBloodline.id;
        messages.push(`You rolled a new bloodline: ${randomBloodline.name}. `);
      } else {
        messages.push(`You rolled for a new bloodline, but none was found. `);
      }
    } else if (effect.type === "rollsagemode") {
      // `updates.sageModeId` guards against a second `rollsagemode` effect on the same item
      // clobbering a grant an earlier effect in this loop already made; `user.sageModeId`
      // guards against overwriting a mode the player already owns.
      if (user.sageModeId || updates.sageModeId) {
        messages.push(
          "You already channel a sage mode; the natural energies find no room for another. ",
        );
        continue;
      }
      const randomSageMode = getRandomElement(sageModePool);
      if (!randomSageMode) {
        throw serverError("NOT_FOUND", "No sage mode found");
      }
      const roll = Math.random() * 100;
      const success = roll < effect.power;
      if (success) {
        mutations.push((client) =>
          insertSageModeRollsForConsume(client, ctx, randomSageMode),
        );
        updates.sageModeId = randomSageMode.id;
        grantedSageModeId = randomSageMode.id;
        messages.push(`You rolled a new sage mode: ${randomSageMode.name}. `);
      } else {
        messages.push(`You rolled for a new sage mode, but none was found. `);
      }
    } else if (effect.type === "noncombatconsumereward") {
      if (effect.rewardMode !== "weightedCache")
        rewards.push(ObjectiveReward.parse(effect));
    } else if (effect.type === "noncombatgainskill") {
      const parsedEffect = NonCombatGainSkill.parse(effect);
      if (parsedEffect.skillId) {
        const skill = userSkills.find((s) => s.skill.id === parsedEffect.skillId);
        if (!skill) {
          mutations.push((client) =>
            insertUserSkillForConsume(client, ctx, parsedEffect),
          );
          messages.push("You unlocked a special skill!");
        } else {
          messages.push(`You already have the skill ${skill.skill.name}.`);
        }
      }
    } else if (effect.type === "removebloodline") {
      if (Math.random() * 100 < effect.power) {
        changedBloodlineId = null;
        messages.push(`Your bloodline was removed. `);
      } else {
        messages.push(`Your bloodline could not be removed successfully.`);
      }
    } else if (effect.type === "marriageslotincrease") {
      if (updates.marriageSlots < MAX_MARRIAGE_SLOTS) {
        updates.marriageSlots += effect.power;
        if (updates.marriageSlots > MAX_MARRIAGE_SLOTS) {
          updates.marriageSlots = MAX_MARRIAGE_SLOTS;
        }
        messages.push(`Your marriage slots were increased! `);
      } else {
        messages.push(
          `Your marriage slots are already at max! Current Slots: ${updates.marriageSlots}`,
        );
      }
    } else if (effect.type === "noncombatincreasereskins") {
      updates.extraReskinSlots += effect.power;
      messages.push(
        `Your number of allowed reskins was increased by ${effect.power}! `,
      );
    } else if (effect.type === "increasejutsuslots") {
      messages.push(
        `You gained ${effect.power} extra jutsu slot${effect.power === 1 ? "" : "s"}!`,
      );
    } else if (effect.type === "heal") {
      const parsedEffect = HealTag.parse(effect);
      const poolsAffects = parsedEffect.poolsAffected || ["Health"];
      poolsAffects.forEach((pool) => {
        const { current, max, label } = HEAL_POOLS[pool];
        const previous = updates[current];
        // Heals start from the snapshot, so repeated effects replace rather than stack.
        // The stored effect decides the amount: the tag defaults calculation to percentage.
        updates[current] = Math.min(
          user[current] +
            (effect.calculation === "percentage"
              ? user[max] * (effect.power / 100)
              : effect.power),
          user[max],
        );
        messages.push(`You healed ${Math.ceil(updates[current] - previous)} ${label}`);
      });
    }
  }
  return {
    updates,
    messages,
    rewards,
    mutations,
    grantedSageModeId,
    changedBloodlineId,
  };
};

/** The user columns and message label of each pool a consumable can heal. */
const HEAL_POOLS = {
  Health: { current: "curHealth", max: "maxHealth", label: "HP" },
  Chakra: { current: "curChakra", max: "maxChakra", label: "CP" },
  Stamina: { current: "curStamina", max: "maxStamina", label: "SP" },
} as const;
