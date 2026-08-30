import { z } from "zod";
import {
  LIVE_ACTIVITY_KINDS,
  PUSH_CATEGORIES,
  PUSH_PLATFORMS,
} from "@/drizzle/constants";

/**
 * APNs tokens are 64 hex characters; FCM registration tokens are longer and documented as
 * variable length, so the upper bound matches the column rather than either format.
 */
export const registerDeviceSchema = z.object({
  token: z.string().min(32).max(512),
  platform: z.enum(PUSH_PLATFORMS),
  appVersion: z.string().max(32).optional(),
  locale: z.string().max(16).optional(),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const unregisterDeviceSchema = z.object({
  token: z.string().min(32).max(512),
});

export const setPushPreferenceSchema = z.object({
  category: z.enum(PUSH_CATEGORIES),
  enabled: z.boolean(),
});
export type SetPushPreferenceInput = z.infer<typeof setPushPreferenceSchema>;

export const registerActivitySchema = z.object({
  activityId: z.string().min(1).max(191),
  kind: z.enum(LIVE_ACTIVITY_KINDS),
  /** APNs token addressing this one activity, not the device. */
  pushToken: z.string().min(32).max(512),
  endsAt: z.date(),
});

export const endActivitySchema = z.object({
  kind: z.enum(LIVE_ACTIVITY_KINDS),
});
