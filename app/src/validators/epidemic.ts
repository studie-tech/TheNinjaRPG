import { z } from "zod";

/** GET /v0/sound-effects/search (Epidemic Sound Partner Content API). */
export const epidemicSfxSearchResponse = z.object({
  soundEffects: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      /** Seconds, as for tracks. */
      length: z.number(),
    }),
  ),
});

/** GET /v0/sound-effects/{id}/download: a signed MP3 link that expires. */
export const epidemicDownloadResponse = z.object({
  url: z.url(),
  expires: z.string(),
});
