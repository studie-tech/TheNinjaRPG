import type { MPVP_BATTLE_TYPES } from "@/drizzle/constants";

type LobbyType = (typeof MPVP_BATTLE_TYPES)[number];

export type QueuedActivity =
  | { kind: "RAID"; sector: number | null }
  | { kind: "SHRINE"; lobbyId: string; sector: number | null }
  | { kind: "CLAN" | "TERRITORY"; lobbyId: string }
  | { kind: "RANKED" | "DUNGEON" | "CARAVAN" | "UNKNOWN" };

/**
 * Name the activity behind a QUEUED status. Reservations come first because leaving a lobby
 * cannot release them. The raid exit also removes a seat whose lobby was deleted.
 */
export const getQueuedActivity = (rows: {
  hasDungeon: boolean;
  hasEscort: boolean;
  hasRanked: boolean;
  seat?: {
    clanBattleId: string;
    clanBattle: { battleType: LobbyType; sector: number | null } | null;
  };
}): QueuedActivity => {
  if (rows.hasDungeon) return { kind: "DUNGEON" };
  if (rows.hasEscort) return { kind: "CARAVAN" };
  if (rows.seat) {
    const { clanBattle, clanBattleId: lobbyId } = rows.seat;
    if (clanBattle?.battleType === "SHRINE_BATTLE")
      return { kind: "SHRINE", lobbyId, sector: clanBattle.sector };
    if (clanBattle?.battleType === "CLAN_BATTLE") return { kind: "CLAN", lobbyId };
    if (clanBattle?.battleType === "TERRITORY_WAR")
      return { kind: "TERRITORY", lobbyId };
    return { kind: "RAID", sector: clanBattle?.sector ?? null };
  }
  if (rows.hasRanked) return { kind: "RANKED" };
  return { kind: "UNKNOWN" };
};

/** Player-facing wording and the page that hosts the activity, if it has one. */
export const describeQueuedActivity = (
  activity: QueuedActivity,
): { text: string; href?: string; linkLabel?: string } => {
  const at =
    "sector" in activity && activity.sector !== null
      ? ` in sector ${activity.sector}`
      : "";
  switch (activity.kind) {
    case "RAID":
      return {
        text: `You are queued with a raid team${at}.`,
        href: "/travel",
        linkLabel: "Open map",
      };
    case "SHRINE":
      return {
        text: `You are queued for a shrine battle${at}.`,
        href: "/shrine",
        linkLabel: "Open shrine",
      };
    case "CLAN":
      return {
        text: "You are queued for a clan battle.",
        href: "/clanhall",
        linkLabel: "Open hall",
      };
    case "TERRITORY":
      return {
        text: "You are queued with a Territory War team.",
        href: "/territory-war",
        linkLabel: "Open teams",
      };
    case "RANKED":
      return {
        text: "You are queued for ranked PvP.",
        href: "/battlearena#PVP%20Rank",
        linkLabel: "Open arena",
      };
    case "DUNGEON":
      return {
        text: "Your dungeon party is holding you.",
        href: "/dungeon",
        linkLabel: "Open dungeon",
      };
    case "CARAVAN":
      return {
        text: "You are escorting a caravan.",
        href: "/warehouse",
        linkLabel: "Open warehouse",
      };
    case "UNKNOWN":
      return {
        text: "Your queue has already ended. Your status resets within ten minutes.",
      };
  }
};
