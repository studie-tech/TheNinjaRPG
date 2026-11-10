import { VILLAGE_DUTY_MIN_RANK, VILLAGE_DUTY_WANDER_RADIUS } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import {
  anonymousSpriteAppearance,
  resolveSpriteAppearance,
} from "@/libs/lpc/appearance";
import { isOpenWanderTile } from "@/libs/overworldWander";
import { hasRequiredRank } from "@/libs/rank";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import type { SectorUser } from "@/libs/sector-map/world-types";
import type { listVillageDutyPatrols } from "@/queries/villageDuty";

/** Give patrols and combat copies an identity that cannot claim their owner's account row. */
export const villageDutyActorId = (userId: string) => `duty:${userId}`;

/** Enrollment belongs to one membership tenure and never makes a banned or outlaw account a defender. */
export const isOnVillageDuty = (
  user: Pick<
    UserData,
    | "villageId"
    | "villageDutyVillageId"
    | "villageDutyStartedAt"
    | "joinedVillageAt"
    | "rank"
    | "isAi"
    | "isBanned"
    | "isOutlaw"
  >,
  villageId = user.villageId,
) =>
  !!villageId &&
  user.villageId === villageId &&
  user.villageDutyVillageId === villageId &&
  !!user.villageDutyStartedAt &&
  user.villageDutyStartedAt >= user.joinedVillageAt &&
  !user.isAi &&
  !user.isBanned &&
  !user.isOutlaw &&
  hasRequiredRank(user.rank, VILLAGE_DUTY_MIN_RANK);

/** Publish copies on walkable village tiles without revealing their owners' current positions or activities. */
export const villageDutyPatrols = (
  users: Awaited<ReturnType<typeof listVillageDutyPatrols>>,
  map: NormalizedSectorMap,
  sector: number,
  viewerVillageId: string | null,
): SectorUser[] => {
  const tiles = map.tiles.filter(
    (tile) => tile.zone === "village" && isOpenWanderTile(map, tile.x, tile.y, false),
  );
  if (!tiles.length) return [];
  return users.flatMap((user) => {
    let hash = 0;
    for (const char of user.userId)
      hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
    const tile = tiles[hash % tiles.length];
    if (!tile) return [];
    const masked = !!user.anbuId && user.villageId !== viewerVillageId;
    return [
      {
        userId: villageDutyActorId(user.userId),
        villageDutyUserId: masked ? undefined : user.userId,
        isVillageDuty: true,
        username: masked ? "ANBU Protector" : user.username,
        isMasked: masked,
        avatar: masked ? (user.anbuSquad?.image ?? null) : user.avatar,
        avatarLight: masked ? (user.anbuSquad?.image ?? null) : user.avatarLight,
        spriteAppearance: masked
          ? anonymousSpriteAppearance(true)
          : resolveSpriteAppearance(user),
        curHealth: user.maxHealth,
        maxHealth: user.maxHealth,
        sector,
        longitude: tile.x,
        latitude: tile.y,
        location: "Village",
        villageId: user.villageId,
        level: user.level,
        experience: user.experience,
        rank: user.rank,
        isOutlaw: false,
        isBanned: false,
        immunityUntil: new Date(0),
        robImmunityUntil: new Date(0),
        updatedAt: user.villageDutyStartedAt ?? new Date(0),
        allianceStatus: user.villageId === viewerVillageId ? "ALLY" : "NEUTRAL",
        status: "AWAKE",
        battleId: null,
        npcWander: {
          seed: villageDutyActorId(user.userId),
          anchor: { x: tile.x, y: tile.y },
          radius: VILLAGE_DUTY_WANDER_RADIUS,
          wildOnly: false,
          villageOnly: true,
        },
      } satisfies SectorUser,
    ];
  });
};
