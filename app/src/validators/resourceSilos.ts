import { z } from "zod";
import { RewardPackageValidator } from "@/validators/rewardPackages";

/** Catalog selections shared by the staff form and server-side snapshot builder. */
export const ResourceSiloSelection = z.object({
  kind: z.enum(["package", "cache"]),
  sourceId: z.string().min(1).max(191),
  chance: z.number().min(0).max(100),
});
/** Each independent roll retains its configured reward even if the catalog source changes. */
export const ResourceSiloEntry = ResourceSiloSelection.extend({
  name: RewardPackageValidator.shape.name,
  rewards: RewardPackageValidator.shape.rewards,
});
export type ResourceSiloEntryType = z.infer<typeof ResourceSiloEntry>;
export type ResourceSiloSelectionType = z.infer<typeof ResourceSiloSelection>;
/** Only the current window's progress is usable; claims preserve progress for display. */
export type ResourceSiloProgress = {
  windowId: string;
  points: number;
  claimed: boolean;
};
