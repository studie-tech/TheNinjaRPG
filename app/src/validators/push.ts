import { z } from "zod";

export const unregisterDeviceSchema = z.object({
  token: z.string().min(32).max(512),
  /** Rotated on every bind, so a late cleanup cannot detach a newer owner. */
  widgetToken: z.string().min(32).max(64),
});
