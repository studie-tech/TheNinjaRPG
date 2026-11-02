import type { GameAssetType } from "@/drizzle/constants";

/** User-facing media labels shared by library browsing and editing. */
export const assetTypeLabels: Record<GameAssetType, string> = {
  STATIC: "Static artwork",
  ANIMATION: "Animations",
  SCENE_BACKGROUND: "Backgrounds",
  SCENE_CHARACTER: "Characters",
  SFX: "Sound effects",
  MUSIC: "Music",
  LPC: "LPC characters",
};

/** Library sort choices using the getAll endpoint's accepted values. */
export const assetSortOptions = [
  { value: "newest", label: "Newest first" },
  { value: "name-asc", label: "Name: A–Z" },
  { value: "name-desc", label: "Name: Z–A" },
  { value: "oldest", label: "Oldest first" },
] as const;

/** Preserve library query state while rejecting external URLs, other routes and fragments. */
export const getAssetLibraryReturnTo = (value: string | null) =>
  value && /^\/manual\/asset(?:\?[^#]*)?$/.test(value) ? value : "/manual/asset";
