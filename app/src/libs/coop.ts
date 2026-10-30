import {
  DUNGEON_PARTY_SIZE,
  QUEST_PARTY_MAX_INVITATIONS,
  QUEST_PARTY_MAX_MEMBERS,
} from "@/drizzle/constants";
import type { Quest } from "@/drizzle/schema";
import type { DungeonBattleState } from "@/libs/dungeon";
import type { CoopRoster, EncounterWave } from "@/validators/coop";
import type { QuestTrackerType } from "@/validators/objectives";

/** Activity policies describe membership behavior without coupling either progress engine. */
export const coopPolicies = {
  quest: {
    minMembers: 1,
    maxMembers: QUEST_PARTY_MAX_MEMBERS,
    invitationLimit: QUEST_PARTY_MAX_INVITATIONS,
    reserveInvitations: false,
    readyCheck: false,
    mutableRoster: true,
  },
  dungeonSolo: {
    minMembers: 1,
    maxMembers: 1,
    invitationLimit: 0,
    reserveInvitations: true,
    readyCheck: true,
    mutableRoster: false,
  },
  dungeon: {
    minMembers: DUNGEON_PARTY_SIZE,
    maxMembers: DUNGEON_PARTY_SIZE,
    invitationLimit: DUNGEON_PARTY_SIZE,
    reserveInvitations: true,
    readyCheck: true,
    mutableRoster: false,
  },
} as const;

/** Normalize the two persistence adapters into the same party command contract. */
export const questCoopParty = (party: {
  leaderId: string;
  memberIds: string[];
  invitedUserIds: string[];
  isPublic: boolean;
  battleId: string | null;
}): CoopParty => ({
  leaderId: party.leaderId,
  memberIds: party.memberIds,
  invitedIds: party.invitedUserIds,
  readyIds: [],
  isPublic: party.isPublic,
  phase: party.battleId ? "FIGHTING" : "ACTIVE",
});

/**
 * Validate a command against the activity policy and return a cloned next party or a rejection.
 * This function neither mutates the input nor writes persistence; adapters must guard their
 * commit with the loaded version and apply any returned membership reservation changes.
 */
export const transitionCoopParty = (
  kind: CoopKind,
  current: CoopParty,
  actorId: string,
  action: CoopAction,
  targetId?: string,
): CoopTransition => {
  const policy = coopPolicies[kind];
  const party = structuredClone(current);
  const member = party.memberIds.includes(actorId);
  const invited = party.invitedIds.includes(actorId);
  const leader = party.leaderId === actorId;
  const reject = (message: string): CoopTransition => ({ success: false, message });
  if (["COMPLETED", "ENDED", "STARTING"].includes(party.phase))
    return reject("This activity cannot be changed.");
  if (party.phase === "FIGHTING" && !(policy.mutableRoster && action === "invite"))
    return reject("Finish the party's encounter first.");
  if (action === "join") {
    if (!invited && !party.isPublic)
      return reject("This party requires an invitation.");
  } else if (!member && !(invited && action === "decline")) {
    return reject("You are not in this party.");
  }
  if (
    ["invite", "remove", "start", "pause", "resume", "disband"].includes(action) &&
    !leader
  )
    return reject("Only the leader can do that.");
  if (
    ["invite", "join", "decline", "remove"].includes(action) &&
    !policy.mutableRoster &&
    party.phase !== "LOBBY"
  )
    return reject("Membership is fixed after the dungeon starts.");
  let joinedUserId: string | undefined;
  let removedUserId: string | undefined;
  if (action === "invite") {
    if (!targetId) return reject("Choose a player to invite.");
    if (party.memberIds.includes(targetId) || party.invitedIds.includes(targetId))
      return reject("That player is already invited or in the party.");
    if (
      party.invitedIds.length >= policy.invitationLimit ||
      (policy.reserveInvitations &&
        party.memberIds.length + party.invitedIds.length >= policy.maxMembers)
    )
      return reject("The party has no free invitation slots.");
    party.invitedIds.push(targetId);
    party.readyIds = [];
  } else if (action === "join") {
    if (member) return reject("You already belong to this party.");
    if (party.memberIds.length >= policy.maxMembers)
      return reject("The party is full.");
    party.memberIds.push(actorId);
    party.invitedIds = party.invitedIds.filter((id) => id !== actorId);
    party.readyIds = [];
    joinedUserId = actorId;
  } else if (action === "decline") {
    party.invitedIds = party.invitedIds.filter((id) => id !== actorId);
  } else if (action === "remove" || action === "leave") {
    const id = action === "leave" ? actorId : targetId;
    if (!id || (action === "remove" && id === actorId))
      return reject("Choose another party member or invitation.");
    if (
      action === "leave" &&
      !policy.mutableRoster &&
      (leader || party.phase !== "LOBBY")
    ) {
      party.phase = "ENDED";
    } else {
      if (party.memberIds.includes(id)) removedUserId = id;
      party.memberIds = party.memberIds.filter((entry) => entry !== id);
      party.invitedIds = party.invitedIds.filter((entry) => entry !== id);
      party.readyIds = [];
      if (party.leaderId === id) party.leaderId = party.memberIds[0] ?? id;
      if (!party.memberIds.length) party.phase = "ENDED";
    }
  } else if (action === "disband") {
    party.phase = "ENDED";
  } else if (action === "ready" || action === "unready") {
    if (!policy.readyCheck || !["LOBBY", "BETWEEN"].includes(party.phase))
      return reject("This activity is not accepting readiness changes.");
    party.readyIds = party.readyIds.filter((id) => id !== actorId);
    if (action === "ready") party.readyIds.push(actorId);
  } else if (action === "pause") {
    if (!policy.readyCheck || party.phase !== "BETWEEN")
      return reject("You can pause only between floors.");
    party.phase = "PAUSED";
    party.readyIds = [];
  } else if (action === "resume") {
    if (!policy.readyCheck || party.phase !== "PAUSED")
      return reject("The dungeon is not paused.");
    party.phase = "BETWEEN";
    party.readyIds = [];
  } else if (action === "start") {
    if (
      party.memberIds.length < policy.minMembers ||
      party.memberIds.length > policy.maxMembers
    )
      return reject(
        `This activity requires ${policy.minMembers === policy.maxMembers ? policy.minMembers : `${policy.minMembers}–${policy.maxMembers}`} players.`,
      );
    if (
      policy.readyCheck &&
      (!["LOBBY", "BETWEEN"].includes(party.phase) ||
        party.memberIds.some((id) => !party.readyIds.includes(id)))
    )
      return reject(`All ${policy.maxMembers} players must be ready.`);
    party.phase = "STARTING";
    party.readyIds = [];
  }
  return {
    success: true,
    party,
    joinedUserId,
    removedUserId,
    ended: party.phase === "ENDED",
  };
};

/** Activity key selecting roster capacity, readiness and membership mutability. */
export type CoopKind = keyof typeof coopPolicies;
/** Adapter phases shared by command validation; progress remains activity-specific. */
export type CoopPhase =
  | "LOBBY"
  | "ACTIVE"
  | "STARTING"
  | "FIGHTING"
  | "BETWEEN"
  | "PAUSED"
  | "COMPLETED"
  | "ENDED";
/** Normalized command input supplied by a quest or dungeon persistence adapter. */
export type CoopParty = CoopRoster & {
  leaderId: string;
  isPublic: boolean;
  phase: CoopPhase;
};
/** Supported roster, readiness and lifecycle commands; policies restrict their availability. */
export type CoopAction =
  | "invite"
  | "join"
  | "decline"
  | "remove"
  | "leave"
  | "disband"
  | "ready"
  | "unready"
  | "start"
  | "pause"
  | "resume";
/** A rejection or the next party plus reservation changes the adapter must commit. */
export type CoopTransition =
  | { success: false; message: string }
  | {
      success: true;
      party: CoopParty;
      joinedUserId?: string;
      removedUserId?: string;
      ended: boolean;
    };

/** Trusted activity snapshot supplied by the server launcher, never by a combat client. */
export type CoopEncounter =
  | {
      kind: "quest";
      battleId: string;
      id: string;
      quest: Quest;
      tracker: QuestTrackerType;
    }
  | (Omit<DungeonBattleState, "lastActionRound"> & {
      kind: "dungeon";
      battleId: string;
      dungeonId: string;
      content: import("@/validators/dungeon").DungeonContent;
      waves: EncounterWave[];
    });
