import { UTApi } from "uploadthing/server";
import { UPLOADTHING_HOST } from "@/libs/uploadthing";
import { listUserUploadForRemoveAccountProcessorData } from "@/queries/accountDeletion";
import { drizzleDB } from "@/server/db";

export const removeAccountProcessorData = async (userId: string) => {
  if (
    process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY ||
    process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY
  ) {
    const secret = process.env.REVENUECAT_SECRET_API_KEY;
    if (!secret) throw new Error("RevenueCat deletion requires a secret API key");
    const response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok && response.status !== 404)
      throw new Error("RevenueCat customer deletion failed");
  }
  // These rows are created by the upload completion handler for this owner's files.
  // Do not infer ownership from avatars or arbitrary external URLs copied into content.
  const uploads = await listUserUploadForRemoveAccountProcessorData(drizzleDB, userId);
  if (!uploads.length) return;
  const files = uploads.map((upload) => ownedUploadKey(upload.imageUrl));
  if (files.some((file) => file === null))
    throw new Error("An owned upload needs manual storage cleanup");
  const storage = new UTApi();
  await Promise.all(
    (["customId", "fileKey"] as const).map(async (keyType) => {
      const keys = files.flatMap((file) =>
        file?.keyType === keyType ? [file.key] : [],
      );
      if (!keys.length) return;
      const result = await storage.deleteFiles(keys, { keyType });
      if (!result.success) throw new Error("Owned upload deletion failed");
    }),
  );
};

/** Accept only owned delivery hosts and distinguish generated custom IDs from provider file keys. */
export const ownedUploadKey = (
  value: string,
): { key: string; keyType: "customId" | "fileKey" } | null => {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      ![new URL(UPLOADTHING_HOST).hostname, "uploadthing.b-cdn.net"].includes(
        url.hostname,
      )
    )
      return null;
    const match = /^\/f\/([A-Za-z0-9_.-]+)$/.exec(url.pathname);
    if (!match?.[1]) return null;
    const key = match[1];
    return {
      key,
      keyType: /^(?:(?:preview|pet|content)-)?[A-Za-z0-9_-]{21}\.[a-z0-9]+$/.test(key)
        ? "customId"
        : "fileKey",
    };
  } catch {
    return null;
  }
};
