import { AttackMethods, type ContentProposalEntityType } from "@/drizzle/constants";
import type { CombatAction } from "@/libs/combat/types";
import { VisualTag } from "@/validators/combat";
import {
  type CoordinateTargeting,
  coordinateTargetingSchema,
} from "@/validators/coordinateTargeting";
import { methodSizeSchema } from "@/validators/methodSize";

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
        projectileAnimation: text(tag.projectileAnimation),
        disappearAnimation: text(tag.disappearAnimation),
        projectileSfx: text(tag.projectileSfx),
        appearSfx: text(tag.appearSfx),
        disappearSfx: text(tag.disappearSfx),
      };
      if (!Object.values(media).some(Boolean)) return [];
      // Preview drafts remain drawable while the editor reports invalid sizing.
      const scale = VisualTag.shape.animationScale.safeParse(tag.animationScale);
      const placement = placementOf(text(tag.target) || "INHERIT");
      const method = AttackMethods.find((method) => method === fields.method);
      const methodSize = methodSizeSchema.safeParse(fields.methodSize);
      const footprint =
        placement === "ground" &&
        tag.target !== "COORDINATES" &&
        method &&
        method !== "SINGLE" &&
        method !== "COORDINATES"
          ? {
              method,
              range: typeof fields.range === "number" ? fields.range : 0,
              methodSize: methodSize.success ? methodSize.data : undefined,
            }
          : undefined;
      const coordinates = coordinateTargetingSchema.safeParse(
        tag.target === "COORDINATES"
          ? tag.coordinateTargeting
          : placement === "ground" && fields.method === "COORDINATES"
            ? fields.coordinateTargeting
            : undefined,
      );
      return [
        {
          ...media,
          appearSfxPrimary: tag.appearSfxPrimary === true,
          disappearSfxPrimary: tag.disappearSfxPrimary === true,
          animationScale: scale.success ? scale.data : 1,
          projectileScale:
            typeof tag.projectileScale === "number" &&
            Number.isFinite(tag.projectileScale)
              ? Math.max(0.25, Math.min(3, tag.projectileScale))
              : 1,
          animationOffsetY:
            typeof tag.animationOffsetY === "number" &&
            Number.isFinite(tag.animationOffsetY)
              ? Math.max(-2, Math.min(2, tag.animationOffsetY))
              : 0,
          groundStyle:
            tag.groundStyle === "SURFACE" || tag.groundStyle === "DECAL"
              ? tag.groundStyle
              : "UPRIGHT",
          groundOpacity:
            typeof tag.groundOpacity === "number"
              ? Math.min(1, Math.max(0.1, tag.groundOpacity))
              : 1,
          groundFeather:
            typeof tag.groundFeather === "number"
              ? Math.min(0.3, Math.max(0, tag.groundFeather))
              : 0,
          placement,
          ...(footprint ? { footprint } : {}),
          ...(coordinates.success ? { coordinateTargeting: coordinates.data } : {}),
        } satisfies BattlefieldEffect,
      ];
    },
  );
  const targetAvatar = entityType === "AI" ? text(fields.avatar) || null : null;
  if (effects.length === 0 && !targetAvatar) return null;
  const pattern = coordinateTargetingSchema.safeParse(
    fields.method === "COORDINATES" ? fields.coordinateTargeting : undefined,
  );
  return {
    effects,
    targetAvatar,
    assets: [],
    ...(pattern.success ? { coordinateTargeting: pattern.data } : {}),
  };
};

/** Sound asset ids a scene plays, as its effects appear and end. */
export const sceneSoundIds = (scene: BattlefieldScene | null) => [
  ...new Set(
    (scene?.effects ?? []).flatMap((effect) =>
      [effect.projectileSfx, effect.appearSfx, effect.disappearSfx].filter(
        (id): id is string => !!id,
      ),
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
        effect.projectileAnimation ?? "",
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
    if (tagTarget === "COORDINATES") return "ground";
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
  projectileAnimation?: string;
  groundStyle?: "UPRIGHT" | "DECAL" | "SURFACE";
  groundOpacity?: number;
  groundFeather?: number;
  disappearAnimation: string;
  /** Sounds combat plays as the effect appears and as it ends. */
  projectileSfx?: string;
  appearSfx: string;
  disappearSfx: string;
  appearSfxPrimary?: boolean;
  disappearSfxPrimary?: boolean;
  animationScale?: number;
  projectileScale?: number;
  animationOffsetY?: number;
  placement: BattlefieldPlacement;
  coordinateTargeting?: CoordinateTargeting;
  /** Authored ground geometry, resolved by combat's targeting helper. */
  footprint?: Pick<CombatAction, "method" | "range" | "methodSize">;
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
  coordinateTargeting?: CoordinateTargeting;
  /** Raw artwork of an AI on the target tile; any other target gets a village marker. */
  targetAvatar: string | null;
  assets: BattlefieldAsset[];
};
