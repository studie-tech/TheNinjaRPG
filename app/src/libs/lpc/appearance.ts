import contentMappings from "@/libs/lpc/content.json";
import type {
  LpcColor,
  LpcEquipmentProfile,
  SpriteAppearance,
  SpriteLayer,
} from "@/validators/lpc";
import { colors, skin_colors } from "@/validators/register";

/** Persisted content mappings take precedence over family defaults; staff overrides take precedence over both. */
export const resolveItemSprite = (item: SpriteItem, variant?: SpriteVariant | null) => {
  const saved = (
    contentMappings as Record<string, { profile: LpcEquipmentProfile; color: LpcColor }>
  )[item.id ?? ""];
  const profile =
    variant?.lpcProfile && variant.lpcProfile !== "AUTO"
      ? variant.lpcProfile
      : item.lpcProfile && item.lpcProfile !== "AUTO"
        ? item.lpcProfile
        : (saved?.profile ?? inferItemProfile(item));
  // Variant names intentionally participate even when they use the base item's silhouette.
  const color =
    variant?.lpcColor ??
    (variant ? inferItemColor(variant.name ?? "") : null) ??
    item.lpcColor ??
    saved?.color ??
    inferItemColor(item.name ?? "") ??
    "gray";
  return { profile, color };
};

/** Every slot and weapon family has an explicit mapping, including non-wearable content. */
export const inferItemProfile = (item: SpriteItem): LpcEquipmentProfile => {
  const name = (item.name ?? "").normalize("NFKC").toLowerCase();
  if (
    [
      "FURNITURE",
      "MATERIAL",
      "COOKING",
      "MEAL",
      "CONSUMABLE",
      "CRYSTAL",
      "OTHER",
    ].includes(item.itemType ?? "")
  )
    return "NONE";
  if (/mask|balaclava|veil/.test(name) && !/blade|edge|break/.test(name)) return "mask";
  if (/crown/.test(name)) return "crown";
  if (/cloak|shroud/.test(name)) return "cloak";
  if (/necklace|amulet|pendant|medallion/.test(name)) return "necklace";
  if (/earring/.test(name)) return "piercing";
  if (/bracelet/.test(name)) return "bracelet";
  if (/\bring\b/.test(name)) return "ring";
  if (/beads/.test(name)) return "beads";
  if (/sash|sealing cord/.test(name)) return "sash";
  if (
    /gem|crystal|shard|marrow|talisman|charm|crest|pride|aegis/.test(name) &&
    item.weaponType === "NONE"
  )
    return "gem";
  const weapons: Record<string, LpcEquipmentProfile> = {
    SWORD: /katana|tachi|masamune|yaiba/.test(name) ? "katana" : "sword",
    DAGGER: "dagger",
    AXE: "axe",
    HAMMER: "hammer",
    STAFF: "staff",
    POLEARM: "spear",
    SICKLE: "sickle",
    FLAIL: "flail",
    CHAIN: "flail",
    BOW: "bow",
    FAN: "fan",
    SHURIKEN: "shuriken",
    FIST_WEAPON: "gloves",
  };
  if (item.weaponType && weapons[item.weaponType]) return weapons[item.weaponType]!;
  if (/sword|blade|edge|fang|kaiken/.test(name)) return "sword";
  if (/kunai|dart|knife/.test(name)) return "dagger";
  if (/rod|conduit/.test(name)) return "staff";
  switch (item.slot) {
    case "HEAD":
      return /hood|zukin/.test(name)
        ? "hood"
        : /helm/.test(name)
          ? "helmet"
          : "bandana";
    case "CHEST":
      return /jacket/.test(name)
        ? "leather"
        : /coat|shozoku|robe/.test(name)
          ? "robe"
          : "plate";
    case "LEGS":
      return /skirt|tasset/.test(name)
        ? "skirt"
        : /hakama|pants/.test(name)
          ? "pants"
          : "leggings";
    case "FEET":
      return /greave/.test(name)
        ? "footarmour"
        : /sandal|sole/.test(name)
          ? "sandals"
          : /tabi/.test(name)
            ? "tabi"
            : "boots";
    case "HAND":
      return item.itemType === "ARMOR" || item.itemType === "ACCESSORY"
        ? "armarmour"
        : "dagger";
    case "WAIST":
      return "belt";
    case "KEYSTONE":
      return "gem";
    case "THROWN":
      return "shuriken";
    case "ITEM":
      return item.itemType === "WEAPON" ? "gem" : "necklace";
    default:
      return "NONE";
  }
};

export const inferItemColor = (name: string): LpcColor | null => {
  const value = name.toLowerCase();
  const colors: [RegExp, LpcColor][] = [
    [/crimson|blood|fire|flam|ember|molten|scorch|red|wrath/, "red"],
    [/azure|blue|sky|storm|frost|ice|yuki|snow/, "blue"],
    [/forest|grove|leaf|sylvan|gaea|earth|thorn|green/, "green"],
    [/void|shadow|night|black|obsidian|dusk|eclipse/, "black"],
    [/purple|cosmic|aether/, "purple"],
    [/sun|solar|gold|pride/, "gold"],
    [/silver|white|diamond|crystal|mercy/, "silver"],
    [/wood|rugged|leather|brown/, "brown"],
    [/orange|kitsune/, "orange"],
  ];
  return colors.find(([pattern]) => pattern.test(value))?.[1] ?? null;
};

/** Resolves solely from an authoritative snapshot; no URLs, inventory IDs or private stats leave this boundary. */
export const resolveSpriteAppearance = (user: SpriteUser): SpriteAppearance => {
  const attributes = new Set(
    (user.attributes ?? []).map((value) =>
      (typeof value === "string" ? value : value.attribute).toLowerCase(),
    ),
  );
  const color = (suffix: string, fallback: string) => {
    const choices = new Set([
      ...(suffix === "skin" ? skin_colors : colors).map((value) => value.toLowerCase()),
      ...(suffix === "skin" ? ["albino"] : ["green", "yellow"]),
    ]);
    return (
      [...attributes]
        .filter((a) => a.endsWith(` ${suffix}`) && choices.has(a.split(" ")[0] ?? ""))
        .sort()[0]
        ?.split(" ")[0]
        ?.replace("blonde", "yellow") ?? fallback
    );
  };
  const body = user.spriteBodyStyle ?? (user.gender === "Female" ? "female" : "male");
  const layers = new Map<string, SpriteLayer>();
  const put = (
    slot: string,
    profile: string,
    value: string,
    eyes?: string,
    mirror?: boolean,
  ) =>
    layers.set(slot, {
      slot,
      profile,
      color: value,
      ...(eyes ? { eyes } : {}),
      ...(mirror ? { mirror } : {}),
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
    )[color("skin", "light")] ?? "light";
  const hair = color("hair", "black");
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
    color("eyes", "blue"),
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
    Object.values(resolveSpriteEquipment(user.items)),
  );
};

/** The item-instance lookup is captured at initiation, so breaking/consuming gear needs no query. */
export const resolveSpriteEquipment = (items: SpriteUser["items"]) => {
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
    const visual = resolveItemSprite(owned.item, variant);
    if (visual.profile === "NONE") continue;
    const slot =
      (
        {
          HEAD: "bandana",
          CHEST: "shirt",
          LEGS: "legs",
          FEET: "feet",
          WAIST: "waist",
        } as Record<string, string>
      )[owned.equipped] ?? owned.equipped;
    result[owned.id ?? owned.item.id ?? owned.equipped] = {
      slot,
      profile: visual.profile,
      color: visual.color,
      ...(owned.equipped === "HAND_2" ? { mirror: true } : {}),
    };
  }
  return result;
};

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

export type SpriteVariant = {
  id?: string;
  name?: string;
  lpcProfile?: string | null;
  lpcColor?: LpcColor | null;
};
export type SpriteItem = SpriteVariant & {
  slot?: string;
  itemType?: string;
  weaponType?: string;
  variants?: SpriteVariant[];
};
export type SpriteUser = {
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
