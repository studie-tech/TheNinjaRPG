import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { TAVERN_IMAGE_UPLOAD_DAILY_LIMIT } from "@/drizzle/constants";
import { strictRateLimit } from "@/server/utils/rateLimit";

const tavernUploadLimiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(TAVERN_IMAGE_UPLOAD_DAILY_LIMIT, "1 d"),
  prefix: "tavern-image-upload",
});

/**
 * Reserve a daily post-image attempt through the shared Redis limiter. Post-image
 * attempts remain independent of avatar and generated-pet allowances.
 */
export const claimTavernImageUpload = (userId: string) =>
  strictRateLimit("image upload", () => tavernUploadLimiter.limit(userId));
