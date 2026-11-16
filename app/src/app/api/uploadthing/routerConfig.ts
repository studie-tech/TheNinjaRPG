import { TAVERN_IMAGE_MAX_SIZE_MB } from "@/drizzle/constants";

/**
 * What extractRouterConfig(ourFileRouter) returns, for NextSSRPlugin in the shell layout,
 * so upload buttons know each route's limits without fetching them. The file router
 * itself would load its moderation, thumbnail and database modules into every page
 * render; tests/app/api/uploadthing/routerConfig.test.ts keeps the two in step.
 */
export const UPLOAD_ROUTER_CONFIG = [
  uploadRoute("lpcSheetUploader", "image", "8MB"),
  uploadRoute("spriteAnimationUploader", "image", "8MB"),
  uploadRoute("imageUploader", "image", "512KB"),
  uploadRoute("conceptArtFrameUploader", "image", "256KB"),
  uploadRoute("tavernUploader", "image", `${TAVERN_IMAGE_MAX_SIZE_MB}MB`),
  uploadRoute("anbuUploader", "image", "512KB"),
  uploadRoute("clanUploader", "image", "512KB"),
  uploadRoute("tournamentUploader", "image", "512KB"),
  uploadRoute("avatarNormalUploader", "image", "512KB"),
  uploadRoute("avatarSilverUploader", "image", "1MB"),
  uploadRoute("avatarGoldUploader", "image", "2MB"),
  uploadRoute("audioSfxUploader", "audio", "64KB"),
  uploadRoute("audioMusicUploader", "audio", "4MB"),
  uploadRoute("towerDefenseCharacterZip", "application/zip", "32MB"),
];

/** One single-file route as extractRouterConfig expands it. */
function uploadRoute(
  slug: string,
  fileType: "image" | "audio" | "application/zip",
  maxFileSize: `${number}${"KB" | "MB"}`,
) {
  return {
    slug,
    config: {
      [fileType]: {
        maxFileSize,
        maxFileCount: 1,
        minFileCount: 1,
        contentDisposition: "inline" as const,
      },
    },
  };
}
