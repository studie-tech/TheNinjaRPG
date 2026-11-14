import type { ItemSlot } from "@/drizzle/constants";
import { isCompatibleEquipSlot } from "@/libs/item";
import type { LpcColor, SpriteAppearance, SpriteLayer } from "@/validators/lpc";
import type { LpcConfig } from "@/validators/lpcAsset";
import { getCharacterAttributes } from "@/validators/register";

/** Preview a design in its visual role, matching base skin while preserving unrelated outfit layers. */
export const previewSpriteDesign = (
  base: SpriteAppearance,
  id: string,
  config: LpcConfig,
  color: string,
  eyes: string,
  solo: boolean,
): SpriteAppearance => {
  const layer: SpriteLayer = {
    profile: id,
    color,
    eyes,
    slot: config.replacementSlot === "none" ? "preview" : config.replacementSlot,
  };
  if (solo) return { ...base, layers: [layer] };
  const baseRole = ["body", "head", "hair", "beard"].includes(config.category)
    ? config.category
    : null;
  return {
    ...base,
    layers: [
      ...base.layers
        .filter(
          (entry) =>
            entry.profile !== id &&
            (!baseRole || entry.slot !== baseRole) &&
            (config.replacementSlot === "none" ||
              entry.slot !== config.replacementSlot),
        )
        .map((entry) =>
          (config.category === "body" || config.category === "head") &&
          (entry.slot === "body" || entry.slot === "head")
            ? { ...entry, color }
            : entry,
        ),
      layer,
    ],
  };
};

/** Validate new staff assignments while permitting an existing hidden design to remain assigned. */
export const lpcSelectionError = (
  profile: string | null | undefined,
  previous: string | null | undefined,
  asset:
    | { id: string; type: string; hidden: boolean; lpcConfig: LpcConfig | null }
    | null
    | undefined,
) => {
  if (!profile || profile === "AUTO" || profile === "NONE") return null;
  // MySQL lookup is case-insensitive, but the renderer indexes exact design IDs.
  if (
    !asset ||
    asset.id !== profile ||
    asset.type !== "LPC" ||
    !asset.lpcConfig ||
    !["equipment", "headgear"].includes(asset.lpcConfig.category)
  )
    return "Choose an existing LPC equipment design.";
  if (asset.hidden && profile !== previous) return "Choose a visible LPC design.";
  return null;
};

/** Saved variant fields inherit the item independently; names and IDs never select artwork. */
export const resolveItemSprite = (item: SpriteItem, variant?: SpriteVariant | null) => {
  const profile =
    variant?.lpcProfile && variant.lpcProfile !== "AUTO"
      ? variant.lpcProfile
      : item.lpcProfile && item.lpcProfile !== "AUTO"
        ? item.lpcProfile
        : "NONE";
  return { profile, color: variant?.lpcColor ?? item.lpcColor ?? "gray" };
};

/**
 * Compose visual selections from a query snapshot or unsaved creation choices.
 * Server callers supply authoritative inputs and replace masked identities before publishing.
 */
export const resolveSpriteAppearance = (user: SpriteUser): SpriteAppearance => {
  const choices = getCharacterAttributes(
    (user.attributes ?? []).map((value) =>
      typeof value === "string" ? value : value.attribute,
    ),
  );
  const attributes = new Set(choices.traits.map((value) => value.toLowerCase()));
  const body = user.spriteBodyStyle ?? (user.gender === "Female" ? "female" : "male");
  const layers = new Map<string, SpriteLayer>();
  const put = (slot: string, profile: string, value: string, eyes?: string) =>
    layers.set(slot, {
      slot,
      profile,
      color: value,
      ...(eyes ? { eyes } : {}),
    });
  const skin =
    (
      {
        light: "light",
        dark: "black",
        olive: "olive",
        alibino: "ivory",
        albino: "ivory",
      } as Record<string, string>
    )[choices.Skin.toLowerCase()] ?? "light";
  const hair = choices.Hair.toLowerCase().replace("blonde", "yellow");
  put("body", "body", skin);
  put("shirt", "shirt", "black");
  put("legs", "pants", "black");
  put("feet", "sandals", "brown");
  put(
    "head",
    attributes.has("sharp features")
      ? "head-sharp"
      : attributes.has("hard features")
        ? "head-hard"
        : attributes.has("soft features")
          ? "head-soft"
          : body === "female"
            ? "head-soft"
            : "head-hard",
    skin,
    choices.Eyes.toLowerCase().replace("blonde", "yellow"),
  );
  // Existing accounts can contain contradictory traits. A stable priority makes them reproducible.
  if (!attributes.has("bald"))
    put("hair", attributes.has("long hair") ? "hair-long" : "hair-short", hair);
  const beard = attributes.has("long beard")
    ? "beard-long"
    : attributes.has("full beard")
      ? "beard-full"
      : attributes.has("stubble")
        ? "beard-stubble"
        : null;
  if (beard) put("beard", beard, hair);
  for (const [attribute, profile] of [
    ["glasses", "glasses"],
    ["piercing", "piercing"],
    ["hat", "bandana"],
    ["tattoo", "tattoo"],
    ["scar", "scar"],
  ])
    if (attributes.has(attribute!))
      put(profile!, profile!, profile === "piercing" ? "silver" : "black");
  return withSpriteEquipment(
    { version: 1, body, layers: [...layers.values()] },
    Object.values(resolveSpriteEquipment(user.items, user.cosmeticSlots)),
  );
};

/**
 * Resolve worn visuals by item-instance ID, preserving two equipped copies of one item.
 * Accept either a selected variant join or the full variant list; battle initiation captures this lookup.
 */
export const resolveSpriteEquipment = (
  items: SpriteUser["items"],
  cosmetics?: SpriteUser["cosmeticSlots"],
) => {
  const result: Record<string, SpriteLayer> = {};
  const equipped = [...(items ?? [])]
    .filter(
      (entry) =>
        entry.equipped &&
        entry.equipped !== "NONE" &&
        (entry.quantity ?? 1) > 0 &&
        !entry.isInAuction &&
        !entry.storedAtHome &&
        (!entry.craftingFinishedAt ||
          new Date(entry.craftingFinishedAt).getTime() <= Date.now()),
    )
    .sort(
      (a, b) =>
        (a.equipped ?? "").localeCompare(b.equipped ?? "") ||
        (a.item?.id ?? "").localeCompare(b.item?.id ?? ""),
    );
  for (const owned of equipped) {
    if (!owned.item || !owned.equipped) continue;
    const variant =
      owned.activeVariant ??
      owned.item.variants?.find((v) => v.id === owned.activeVariantId);
    const cosmetic = cosmetics?.find(
      (entry) =>
        entry.slot === owned.equipped &&
        entry.item &&
        isCompatibleEquipSlot(entry.slot as ItemSlot, entry.item.slot),
    );
    const visual = cosmetic?.item
      ? resolveItemSprite(cosmetic.item, cosmetic.variant)
      : resolveItemSprite(owned.item, variant);
    if (visual.profile === "NONE") continue;
    // Recipes retain physical equipment slots; the saved design controls clothing replacement at render time.
    const slot = owned.equipped;
    result[owned.id ?? owned.item.id ?? owned.equipped] = {
      slot,
      profile: visual.profile,
      color: visual.color,
      ...(owned.equipped === "HAND_2" ? { mirror: true } : {}),
    };
  }
  return result;
};

/** Compose equipment slots without mutating the captured base used after gear is removed. */
export const withSpriteEquipment = (
  base: SpriteAppearance,
  equipment: SpriteLayer[],
): SpriteAppearance => {
  const layers = new Map(
    base.layers.map((layer) => [layer.slot ?? layer.profile, layer]),
  );
  for (const layer of equipment) layers.set(layer.slot ?? layer.profile, layer);
  return { ...base, layers: [...layers.values()] };
};

/** Uniform recipes omit personal traits and equipment so masked identities remain anonymous. */
export const anonymousSpriteAppearance = (anbu = false): SpriteAppearance => ({
  version: 1,
  body: "male",
  layers: [
    { profile: "body", color: "light" },
    { profile: "head-hard", color: "light", eyes: "black" },
    { profile: "pants", color: "black" },
    { profile: "shirt", color: "black" },
    { profile: "sandals", color: "black" },
    { profile: anbu ? "mask" : "hood", color: "black" },
  ],
});

/** Visual fields shared by selected-variant joins and full catalogue entries. */
export type SpriteVariant = {
  image?: string | null;
  id?: string;
  name?: string;
  lpcProfile?: string | null;
  lpcColor?: LpcColor | null;
};
/** Minimal content inputs accepted from both lean and full inventory queries. */
export type SpriteItem = SpriteVariant & {
  slot?: string;
  itemType?: string;
  weaponType?: string;
  variants?: SpriteVariant[];
};
/** Resolver inputs shared by creation drafts and private server snapshots; never a public DTO. */
export type SpriteUser = {
  cosmeticSlots?: {
    slot: string;
    item?: SpriteItem | null;
    variant?: SpriteVariant | null;
  }[];
  gender?: string;
  spriteBodyStyle?: "male" | "female" | null;
  attributes?: (string | { attribute: string })[];
  items?: {
    id?: string;
    equipped?: string;
    quantity?: number;
    craftingFinishedAt?: Date | string | null;
    isInAuction?: boolean;
    storedAtHome?: boolean;
    activeVariantId?: string | null;
    activeVariant?: SpriteVariant | null;
    item?: SpriteItem;
  }[];
};
