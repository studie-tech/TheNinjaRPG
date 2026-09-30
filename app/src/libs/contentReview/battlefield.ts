import type { ContentProposalEntityType } from "@/drizzle/constants";

/**
 * What a jutsu, item, bloodline, AI or battlefield asset draws in combat, with every effect
 * placed the way `libs/combat/actions.ts` places it: SELF tags land on the caster, and the
 * other tags land on the tile of a ground action or on the target of any other action.
 * Bloodline and worn-item effects sit on their owner, and an AI's own effects on the AI.
 * Returns null when the entity neither draws nor plays anything on the battlefield.
 */
export const battlefieldSceneOf = (
  entityType: ContentProposalEntityType,
  entityId: string | null,
  fields: Record<string, unknown>,
): BattlefieldScene | null => {
  if (entityType === "GAME_ASSET") return assetScene(entityId, fields);
  const placementOf = placementRule(entityType, fields);
  const effects = (Array.isArray(fields.effects) ? fields.effects : []).flatMap(
    (effect: unknown) => {
      const tag = (effect ?? {}) as Record<string, unknown>;
      const media = {
        staticAssetPath: text(tag.staticAssetPath),
        staticAnimation: text(tag.staticAnimation),
        appearAnimation: text(tag.appearAnimation),
        disappearAnimation: text(tag.disappearAnimation),
        appearSfx: text(tag.appearSfx),
        disappearSfx: text(tag.disappearSfx),
      };
      if (!Object.values(media).some(Boolean)) return [];
      return [{ ...media, placement: placementOf(text(tag.target) || "INHERIT") }];
    },
  );
  const targetAvatar = entityType === "AI" ? text(fields.avatar) || null : null;
  if (effects.length === 0 && !targetAvatar) return null;
  return { effects, targetAvatar, assets: [] };
};

/** Sound asset ids a scene plays, as its effects appear and end. */
export const sceneSoundIds = (scene: BattlefieldScene | null) => [
  ...new Set(
    (scene?.effects ?? []).flatMap((effect) =>
      [effect.appearSfx, effect.disappearSfx].filter(Boolean),
    ),
  ),
];

/** Asset ids a scene draws from the catalog. */
export const sceneAssetIds = (scene: BattlefieldScene | null) => [
  ...new Set(
    (scene?.effects ?? []).flatMap((effect) =>
      [
        effect.staticAssetPath,
        effect.staticAnimation,
        effect.appearAnimation,
        effect.disappearAnimation,
      ].filter(Boolean),
    ),
  ),
];

/** Placement of each effect tag of this entity, given the tag's own target. */
const placementRule =
  (entityType: ContentProposalEntityType, fields: Record<string, unknown>) =>
  (tagTarget: string): BattlefieldPlacement => {
    if (entityType === "AI") return "target";
    if (entityType === "BLOODLINE") return "caster";
    if (entityType === "ITEM" && WORN_ITEM_TYPES.includes(text(fields.itemType))) {
      return "caster";
    }
    const actionTarget = text(fields.target);
    if (tagTarget === "SELF" || actionTarget === "SELF") return "caster";
    if (actionTarget === "GROUND" || actionTarget === "EMPTY_GROUND") return "ground";
    return "target";
  };

/**
 * Scene of a battlefield asset: an animation loops on a tile and plays once on a fighter, and
 * a static asset covers a tile. Assets of other types draw nothing.
 */
const assetScene = (
  entityId: string | null,
  fields: Record<string, unknown>,
): BattlefieldScene | null => {
  const type = text(fields.type);
  if (!entityId || (type !== "ANIMATION" && type !== "STATIC")) return null;
  const blank = {
    staticAssetPath: "",
    staticAnimation: "",
    appearAnimation: "",
    disappearAnimation: "",
    appearSfx: "",
    disappearSfx: "",
  };
  const image = text(fields.image);
  return {
    effects:
      type === "STATIC"
        ? [{ ...blank, staticAssetPath: entityId, placement: "ground" }]
        : [
            { ...blank, staticAnimation: entityId, placement: "ground" },
            { ...blank, appearAnimation: entityId, placement: "target" },
          ],
    targetAvatar: null,
    assets: image
      ? [
          {
            id: entityId,
            name: text(fields.name),
            image,
            frames: Number(fields.frames) || 1,
            speed: Number(fields.speed) || 1,
          },
        ]
      : [],
  };
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Width of the combat canvas the battlefield preview reproduces. The combat view fills the
 * main column, which is 688 px wide on any desktop and 370 px on a 390 px wide phone.
 */
export const BATTLEFIELD_VIEWPORTS = { desktop: 688, phone: 370 } as const;

/** Item types whose effects sit on the wearer for the whole battle. */
const WORN_ITEM_TYPES = ["ARMOR", "ACCESSORY", "KEYSTONE"];

/** Screen a battlefield preview reproduces. */
export type BattlefieldViewport = keyof typeof BATTLEFIELD_VIEWPORTS;

/** Where combat draws an effect: on its caster, on the fighter it targets, or on a tile. */
export type BattlefieldPlacement = "caster" | "target" | "ground";

/** One effect as combat draws it: the asset ids it shows and plays (empty when unset). */
export type BattlefieldEffect = {
  staticAssetPath: string;
  staticAnimation: string;
  appearAnimation: string;
  disappearAnimation: string;
  /** Sounds combat plays as the effect appears and as it ends. */
  appearSfx: string;
  disappearSfx: string;
  placement: BattlefieldPlacement;
};

/** Asset drawn from these values instead of its catalog row, for a suggested asset edit. */
type BattlefieldAsset = {
  id: string;
  name: string;
  image: string;
  frames: number;
  speed: number;
};

/** Everything the battlefield preview draws for one version of an entity. */
export type BattlefieldScene = {
  effects: BattlefieldEffect[];
  /** Raw artwork of an AI on the target tile; any other target gets a village marker. */
  targetAvatar: string | null;
  assets: BattlefieldAsset[];
};
