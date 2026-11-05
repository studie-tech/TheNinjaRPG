import type { UserStatus } from "@/drizzle/constants";
import { BasicElementName } from "@/drizzle/constants";
import { isOrderedSubsequence } from "@/libs/queue";

/** Shared status feedback for actions that require an available character. */
export const actionStatusMessage = (status: UserStatus, name = "You") => {
  const are = name === "You" ? "are" : "is";
  const states: Record<UserStatus, string> = {
    AWAKE: "awake",
    ASLEEP: "asleep. Wake up before taking this action",
    HOSPITALIZED: "in the hospital. Check out before taking this action",
    TRAVEL: "traveling. Finish traveling before taking this action",
    BATTLE: "in battle. Finish the battle before taking this action",
    QUEUED: "queued for battle. Leave the queue before taking this action",
  };
  return `${name} ${are} ${states[status]}.`;
};

export const AUTO_WAKE_MESSAGE = "This action woke you up.";
export const AUTO_CHECKOUT_MESSAGE =
  "This action checked you out of the hospital for free.";

// Only player-initiated actions with awake prerequisites belong here. Queue controls,
// combat turns, messages, preferences and background settlement retain their own lifecycle.
export const AWAKE_ACTIONS = new Set([
  "bloodline.roll",
  "clan.leaveClan",
  "clan.fightLeader",
  "clan.challengeClan",
  "clan.joinClanBattle",
  "combat.battleArenaHeal",
  "combat.startArenaBattle",
  "combat.attackUser",
  "combat.startShrineBattle",
  "coop.dungeon.create",
  "farming.plantSeed",
  "farming.waterPlot",
  "farming.applyFertilizer",
  "farming.harvestPlot",
  "farming.plantAllEmpty",
  "farming.waterAll",
  "farming.fertilizeAll",
  "farming.harvestAll",
  "farming.sellCrop",
  "farming.buyShopItem",
  "farming.extractSeeds",
  "hospital.userHeal",
  "hunting.accept",
  "hunting.start",
  "item.evolveItem",
  "item.consumeVariantToken",
  "item.mergeStacks",
  "item.mergeAllStacks",
  "item.consume",
  "item.repair",
  "item.repairAll",
  "item.useRepairItem",
  "item.useRepairAll",
  "jutsu.evolveJutsu",
  "jutsu.startTraining",
  "kage.checkInDefense",
  "kage.startDefense",
  "occupation.craftItem",
  "occupation.imbueItem",
  "overworldAi.interactWithOverworldAi",
  "pets.unlockSlot",
  "pets.activatePet",
  "pets.updateAbilities",
  "pets.feedPet",
  "pets.acquirePet",
  "pets.generateAppearance",
  "pets.releasePet",
  "pets.updatePet",
  "pets.updateAiConfig",
  "pets.assignExperience",
  "pets.rankUp",
  "coop.quest.create",
  "coop.quest.join",
  "coop.quest.startEncounter",
  "quests.startRandom",
  "quests.startQuest",
  "quests.startPetTask",
  "quests.checkRewards",
  "quests.retryBattle",
  "pvpRank.queueForRankedPvp",
  "raids.readyToQueue",
  "raids.joinRaidQueue",
  "sageMode.removeSageMode",
  "shrine.challengeShrine",
  "shrine.joinShrineBattle",
  "sparring.acceptChallenge",
  "stealth.activateStealth",
  "stealth.useSensory",
  "stealth.trainCovert",
  "territoryWar.createTeam",
  "territoryWar.joinTeam",
  "tournament.joinMatch",
  "tournament.participateEvent",
  "train.selectTrainedElement",
  "train.startTraining",
  "train.startMasteryTraining",
  "train.stopMasteryTraining",
  "travel.robPlayer",
  "travel.startGlobalMove",
  "travel.moveInSector",
  "village.buyFood",
  "village.leaveVillage",
  "village.joinVillage",
  "village.swapVillage",
  "war.startWarMission",
  "war.completeWarMission",
  "war.attackWarCamp",
]);

/** Mixed-purpose endpoints prepare only inputs whose own action needs an awake actor. */
export const shouldPrepareAction = (path: string, input: unknown) => {
  const values =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (
    path === "train.updateEnergyTrainingQueue" ||
    path === "train.updateMasteryTrainingQueue"
  ) {
    return (
      Array.isArray(values.entries) &&
      Array.isArray(values.expectedEntries) &&
      !isOrderedSubsequence(values.entries, values.expectedEntries)
    );
  }
  if (path === "coop.dungeon.act") return values.action === "accept";
  if (path === "hunting.sessionAction") return values.action === "prepare";
  if (path === "profile.useUnusedExperiencePoints") {
    return BasicElementName.some(
      (element) => typeof values[element] === "number" && Number(values[element]) > 0,
    );
  }
  return AWAKE_ACTIONS.has(path);
};

/** Let explicit actions reach the server's recovery gate; other activity stays blocked. */
export const canAttemptAwakeAction = (
  user: { status: UserStatus; autoWakeUp?: boolean } | null | undefined,
) =>
  !!user &&
  (user.status === "AWAKE" ||
    user.status === "HOSPITALIZED" ||
    (user.status === "ASLEEP" && user.autoWakeUp !== false));

/** Project availability for client-side prerequisite hints; the server validates real status. */
export const actionPrerequisiteUser = <
  T extends { status: UserStatus; autoWakeUp?: boolean },
>(
  user: T,
): T => (canAttemptAwakeAction(user) ? { ...user, status: "AWAKE" } : user);
