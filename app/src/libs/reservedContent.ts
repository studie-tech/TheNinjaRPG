import type { ContentType } from "@/drizzle/constants";
import {
  BLACKSTEEL_CHAPTERS,
  BLACKSTEEL_DEBRIEF_QUEST_ID,
  BLACKSTEEL_LEAD_QUEST_IDS,
  BLACKSTEEL_PROCTOR_AI_ID,
  BLACKSTEEL_PYRAMID_QUEST_ID,
  BLUE_BLADE_EYES_BLOODLINE_ID,
  CHUNIN_EXAM_QUEST_ID,
  CREATOR_TRIAL_FIRST_FORM,
  CS_SFX,
  HEAVENLY_SONATA_BLOODLINE_ID,
  HOME_FURNITURE_STARTERS,
  ID_ANIMATION_HEAL,
  ID_ANIMATION_HIT,
  ID_ANIMATION_SMOKE,
  ID_SFX_CLEANSE,
  ID_SFX_CLEAR,
  ID_SFX_HEAL,
  ID_SFX_HIT,
  ID_SFX_MOVE,
  ID_SFX_SMOKE,
  ID_SFX_TRANSFORMATION_BURST,
  ID_SFX_TRANSFORMATION_SURGE,
  ONBOARDING_DAILY_QUEST_IDS,
  SAGE_MODE_ACTIVATION_JUTSU_ID,
  TD_SFX,
  TERR_BOT_ID,
  TRAINING_ARENA_DUMMY_ID,
  TUTORIAL_ARENA_DUMMY_ID,
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_ITEM_ID,
  TUTORIAL_JUTSU_ID,
  TUTORIAL_STARTER_QUEST_ID,
  VILLAGE_PROTECTOR_AI_ID,
} from "@/drizzle/constants";
import { KESSEN_RESERVED_ITEM_IDS } from "@/libs/kessen/reservedContent";

/**
 * Content referenced by game code, grouped by the table that owns the ID. Add code
 * dependencies here using their source constants; cue maps include every cue automatically.
 * Staff may edit these definitions, but deleting them requires removing the code dependency.
 */
export const RESERVED_CONTENT_IDS: Readonly<
  Record<ReservedContentType, readonly string[]>
> = {
  activityStreak: [],
  ai: [
    TUTORIAL_ARENA_DUMMY_ID,
    TRAINING_ARENA_DUMMY_ID,
    VILLAGE_PROTECTOR_AI_ID,
    CREATOR_TRIAL_FIRST_FORM,
    TERR_BOT_ID,
    BLACKSTEEL_PROCTOR_AI_ID,
  ],
  asset: [
    ID_ANIMATION_SMOKE,
    ID_ANIMATION_HIT,
    ID_ANIMATION_HEAL,
    ID_SFX_SMOKE,
    ID_SFX_HIT,
    ID_SFX_HEAL,
    ID_SFX_MOVE,
    ID_SFX_CLEANSE,
    ID_SFX_CLEAR,
    ID_SFX_TRANSFORMATION_SURGE,
    ID_SFX_TRANSFORMATION_BURST,
    ...Object.values(TD_SFX),
    ...Object.values(CS_SFX),
    // Character creation and masked identities select these LPC designs by ID.
    "body",
    "head-hard",
    "head-soft",
    "head-sharp",
    "hair-short",
    "hair-long",
    "beard-long",
    "beard-full",
    "beard-stubble",
    "shirt",
    "pants",
    "sandals",
    "hood",
    "mask",
    "glasses",
    "piercing",
    "bandana",
    "tattoo",
    "scar",
  ],
  badge: [],
  bloodline: [HEAVENLY_SONATA_BLOODLINE_ID, BLUE_BLADE_EYES_BLOODLINE_ID],
  bloodline_reskin: [],
  guide: [],
  hunting: [],
  item: [
    TUTORIAL_ITEM_ID,
    ...HOME_FURNITURE_STARTERS.map(({ itemId }) => itemId),
    ...KESSEN_RESERVED_ITEM_IDS,
  ],
  item_variant: [],
  jutsu: [TUTORIAL_JUTSU_ID, SAGE_MODE_ACTIVATION_JUTSU_ID],
  jutsu_reskin: [],
  mapAsset: [],
  mapTerrain: [],
  quest: [
    TUTORIAL_STARTER_QUEST_ID,
    TUTORIAL_GENIN_EXAM_QUEST_ID,
    ...BLACKSTEEL_CHAPTERS.map(({ questId }) => questId),
    ...BLACKSTEEL_LEAD_QUEST_IDS,
    BLACKSTEEL_PYRAMID_QUEST_ID,
    BLACKSTEEL_DEBRIEF_QUEST_ID,
    CHUNIN_EXAM_QUEST_ID,
    ...ONBOARDING_DAILY_QUEST_IDS,
  ],
  rewardPackage: [],
  rewardNode: [],
  sageMode: [],
  skillTree: [],
  skillTreeFolder: [],
  splash: [],
  title: [],
  user: [TERR_BOT_ID],
};

/** Explain a reserved definition's deletion rejection using the normal mutation response. */
export const reservedContentDeletionError = (
  type: ReservedContentType,
  id: string,
): string | null => {
  // Compare conservatively across case, accents and trailing spaces so aliases cannot
  // bypass reservations on case-insensitive database lookups or shared character deletion.
  const reserved = RESERVED_CONTENT_IDS[type].some(
    (reservedId) => collator.compare(reservedId, id.trimEnd()) === 0,
  );
  return reserved
    ? "Cannot delete reserved content: game code depends on this ID. Remove its code references and reservation before deleting it."
    : null;
};

const collator = new Intl.Collator("en", { sensitivity: "base" });

/** Protect required AI and system identities at every character or account deletion entry. */
export const reservedCharacterDeletionError = (userId: string): string | null =>
  reservedContentDeletionError("ai", userId) ??
  reservedContentDeletionError("user", userId);

type ReservedContentType =
  | ContentType
  | "hunting"
  | "item_variant"
  | "rewardPackage"
  | "rewardNode"
  | "skillTreeFolder";
