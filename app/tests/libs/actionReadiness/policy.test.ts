import { describe, expect, it } from "bun:test";
import { UserStatuses } from "@/drizzle/constants";
import { actionStatusMessage, canAttemptAwakeAction, shouldPrepareAction } from "@/libs/actionReadiness";

describe("character action readiness", () => {
  it("names the actual status and keeps other players distinct", () => {
    expect(actionStatusMessage("HOSPITALIZED")).toBe("You are in the hospital. Check out before taking this action.");
    expect(actionStatusMessage("ASLEEP")).toContain("asleep");
    expect(actionStatusMessage("BATTLE")).toContain("in battle");
    expect(actionStatusMessage("TRAVEL")).toContain("traveling");
    expect(actionStatusMessage("QUEUED")).toContain("queued");
    expect(actionStatusMessage("HOSPITALIZED", "Opponent")).toStartWith("Opponent is in the hospital");
  });
  it("lets recovery-capable clicks reach the server without allowing other activities", () => {
    for (const status of UserStatuses) {
      expect(canAttemptAwakeAction({status, autoWakeUp: true})).toBe(["AWAKE", "ASLEEP", "HOSPITALIZED"].includes(status));
    }
    expect(canAttemptAwakeAction({status: "ASLEEP", autoWakeUp: false})).toBe(false);
    expect(canAttemptAwakeAction({status: "HOSPITALIZED", autoWakeUp: false})).toBe(true);
    expect(canAttemptAwakeAction(undefined)).toBe(false);
  });
  it("covers action families and preserves sleep for passive controls", () => {
    for (const path of ["combat.startArenaBattle", "travel.moveInSector", "train.startTraining", "occupation.craftItem", "farming.harvestAll", "quests.checkRewards", "coop.quest.startEncounter", "pets.feedPet", "pvpRank.queueForRankedPvp", "kage.checkInDefense"]) expect(shouldPrepareAction(path, {})).toBe(true);
    for (const path of ["home.toggleSleep", "profile.getUser", "profile.updatePreferences", "combat.performAction", "combat.toggleAutoCombat", "raids.leaveRaidQueue", "comments.create", "quests.checkLocationQuest"]) expect(shouldPrepareAction(path, {})).toBe(false);
  });
  it("distinguishes inputs on mixed activity and cleanup endpoints", () => {
    expect(shouldPrepareAction("train.updateEnergyTrainingQueue", { expectedEntries: [], entries: [{stat: "offence", energy: 40}] })).toBe(true);
    expect(shouldPrepareAction("train.updateEnergyTrainingQueue", { expectedEntries: [{stat: "offence", energy: 40}], entries: [] })).toBe(false);
    expect(shouldPrepareAction("train.updateMasteryTrainingQueue", { expectedEntries: [{stat: "Fire", speed: "15min"}], entries: [{stat: "Fire", speed: "30min"}] })).toBe(true);
    expect(shouldPrepareAction("quests.startQuest", { questId: "story" })).toBe(false);
    expect(shouldPrepareAction("coop.dungeon.act", { action: "accept" })).toBe(true);
    expect(shouldPrepareAction("coop.dungeon.act", { action: "leave" })).toBe(false);
    expect(shouldPrepareAction("hunting.sessionAction", { action: "prepare" })).toBe(true);
    expect(shouldPrepareAction("hunting.sessionAction", { action: "finish" })).toBe(false);
    expect(shouldPrepareAction("profile.useUnusedExperiencePoints", { Fire: 10 })).toBe(true);
    expect(shouldPrepareAction("profile.useUnusedExperiencePoints", { offence: 10 })).toBe(false);
  });
});
