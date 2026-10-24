import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { TAVERN_IMAGE_UPLOAD_DAILY_LIMIT } from "@/drizzle/constants";

/** Reserve a post-image attempt independently of avatars and generated pet art. */
export const createTavernUploadGuard =
  (limit: (userId: string) => Promise<{ success: boolean; reason?: string }>) =>
  async (userId: string) => {
    try {
      const result = await limit(userId);
      // The SDK resolves its timeout as success, so explicitly keep production closed.
      if (result.reason === "timeout")
        throw new Error("Unable to verify image upload allowance. Please try again.");
      return result.success;
    } catch (error) {
      // Match the existing tRPC policy for an unavailable local Redis shim.
      if (process.env.NODE_ENV !== "development") throw error;
      console.warn("Tavern upload limiter unavailable in development", error);
      return true;
    }
  };

const tavernUploadLimiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(TAVERN_IMAGE_UPLOAD_DAILY_LIMIT, "1 d"),
  prefix: "tavern-image-upload",
});

export const claimTavernImageUpload = createTavernUploadGuard((userId) =>
  tavernUploadLimiter.limit(userId),
);
