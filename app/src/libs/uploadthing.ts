import { nanoid } from "nanoid";

/** The UploadThing app host files are served from */
export const UPLOADTHING_HOST = "https://ui0arpl8sm.ufs.sh";

/**
 * File extension for an upload, derived from its name with the MIME type as
 * fallback. The Bunny CDN optimizer only engages when the served URL path
 * carries a file extension, so every upload gets one via its customId.
 */
const fileExtension = (name: string, type?: string) => {
  const fromName = name.includes(".") ? name.split(".").pop() : undefined;
  const fromType = type?.includes("/") ? type.split("/").pop() : undefined;
  return (fromName || fromType || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
};

/** Unique customId carrying the file extension for CDN optimization */
export const extensionCustomId = (name: string, type?: string) =>
  `${nanoid()}.${fileExtension(name, type)}`;

/**
 * Serve URL for an uploaded file: prefers the extension-bearing customId path
 * (which lets the CDN optimizer resize/compress on the fly), falling back to
 * the raw key URL for files uploaded without a customId.
 */
export const servedUfsUrl = (file: {
  ufsUrl: string;
  customId?: string | null;
}): string => (file.customId ? `${UPLOADTHING_HOST}/f/${file.customId}` : file.ufsUrl);
