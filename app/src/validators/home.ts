import { z } from "zod";
import {
  HOME_FLOOR_TILES,
  HOME_FURNITURE_MAX_PLACEMENTS,
  HOME_FURNITURE_POSITION_MAX,
  HOME_FURNITURE_POSITION_MIN,
  HOME_FURNITURE_ROTATIONS,
  HOME_MAX_ROOMS,
  HOME_ROOM_IDS,
  HOME_WALL_PAINTS,
  HomeTypes,
} from "@/drizzle/constants";
import { objectKeys } from "@/utils/typeutils";

/** Placement belongs to one UserItem row, so multiple copies of the same content item remain independent. */
export const homePlacementSchema = z.strictObject({
  id: z.string().min(1).max(191),
  x: z.number().min(HOME_FURNITURE_POSITION_MIN).max(HOME_FURNITURE_POSITION_MAX),
  y: z.number().min(HOME_FURNITURE_POSITION_MIN).max(HOME_FURNITURE_POSITION_MAX),
  /** Clockwise quarter turns select content-authored views, rather than transforming a sprite. */
  rotation: z.union(HOME_FURNITURE_ROTATIONS.map((rotation) => z.literal(rotation))),
  /** Omitted room IDs use the main room so existing saved coordinates keep their meaning. */
  room: z.enum(HOME_ROOM_IDS).optional(),
});
export type HomePlacement = z.infer<typeof homePlacementSchema>;

/** Inventory ownership and geometry are checked against the server snapshot. */
export const homeLayoutSchema = z
  .array(homePlacementSchema)
  .max(HOME_FURNITURE_MAX_PLACEMENTS * HOME_MAX_ROOMS)
  .refine(
    (placements) =>
      HOME_ROOM_IDS.every(
        (room) =>
          placements.filter((placement) => (placement.room ?? "main") === room)
            .length <= HOME_FURNITURE_MAX_PLACEMENTS,
      ),
    "Each room has reached its furniture display limit",
  )
  .refine(
    (placements) =>
      new Set(placements.map((placement) => placement.id)).size === placements.length,
    "Each furniture instance can only be placed once",
  );

/** Layout and finishes share the home tier and revision guard; omitted styles preserve saved finishes. */
export const homeFurnitureSaveInputSchema = z.strictObject({
  homeType: z.enum(HomeTypes),
  revision: z.int().nonnegative(),
  placements: homeLayoutSchema,
  styles: z
    .array(
      z.strictObject({
        room: z.enum(HOME_ROOM_IDS),
        paint: z.enum(objectKeys(HOME_WALL_PAINTS)),
        floor: z.enum(objectKeys(HOME_FLOOR_TILES)),
      }),
    )
    .max(HOME_MAX_ROOMS)
    .optional(),
});
/** Paint and flooring belong to a stable room identity independently of its placed furniture. */
export type HomeRoomStyle = NonNullable<
  z.infer<typeof homeFurnitureSaveInputSchema>["styles"]
>[number];
export const homeUpgradeInputSchema = z.object({ homeType: z.enum(HomeTypes) });
