import type { OverworldInteractionType } from "@/drizzle/constants";
import type { NpcWalk, SectorUser } from "@/libs/sector-map/world-types";
import type { CharacterAnimation } from "@/libs/spriteAnimations";
import type { SpriteAppearance } from "@/validators/lpc";

/** What a figure of a story scene looks like, where it stands and what the player can do to it. */
export type StoryActor = {
  /** Unique within the scenes on the map at once. */
  id: string;
  name: string;
  sector: number;
  /** Where the scene happens; the renderer draws the figure while this is in view. */
  at: { x: number; y: number };
  walk: NpcWalk;
  /** The map's own control over the figure: attack, talk or none. */
  interaction?: OverworldInteractionType;
  /** A layered character, or an AI's artwork. */
  appearance?: SpriteAppearance;
  avatar?: string | null;
  sheets?: SectorUser["npcSheets"];
  scale?: number;
};

/**
 * A story figure as a map actor only this player sees, drawn whatever the map's filters
 * hide. It is no placement the server knows: what its control does comes from the scene.
 */
export const storyActorUser = (actor: StoryActor): SectorUser => ({
  userId: storyPlacementId(actor.id),
  username: actor.name,
  curHealth: 1,
  maxHealth: 1,
  avatar: actor.avatar ?? null,
  avatarLight: null,
  sector: actor.sector,
  longitude: actor.at.x,
  latitude: actor.at.y,
  location: null,
  villageId: null,
  level: 1,
  rank: "STUDENT",
  isOutlaw: false,
  isBanned: false,
  immunityUntil: NEVER,
  robImmunityUntil: NEVER,
  updatedAt: NEVER,
  allianceStatus: "NEUTRAL",
  status: "AWAKE",
  battleId: null,
  isNpc: true,
  isStoryActor: true,
  npcPlacementId: storyPlacementId(actor.id),
  npcInteractionType: actor.interaction ?? "AMBIENT",
  npcWalk: actor.walk,
  ...(actor.sheets ? { npcSheets: actor.sheets } : {}),
  ...(actor.appearance ? { spriteAppearance: actor.appearance } : {}),
  ...(actor.scale === undefined ? {} : { npcScale: actor.scale }),
});

/** The placement a figure's control reports when it is tapped. */
export const storyPlacementId = (id: string) => `${STORY_PREFIX}${id}`;

/** Whether a tapped placement is a story figure's, which the server has no placement for. */
export const isStoryPlacementId = (placementId: string | undefined) =>
  !!placementId?.startsWith(STORY_PREFIX);

/** The map actor key of a story figure, which speech and lessons hold on to. */
export const storyActorKey = (id: string) => `npc:${storyPlacementId(id)}:0:0`;

/** The artwork of an AI a figure wears on the map. */
export type StoryActorArt = {
  avatar: string | null;
  sheets?: { idle?: CharacterAnimation; move?: CharacterAnimation };
};

const STORY_PREFIX = "story-";
const NEVER = new Date(0);
