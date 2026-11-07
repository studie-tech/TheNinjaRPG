import {
  generateReactHelpers,
  generateUploadButton,
  generateUploadDropzone,
} from "@uploadthing/react";

import type { OurFileRouter } from "@/app/api/uploadthing/core";
import { showMutationToast } from "@/libs/toast";

export const UploadButton = generateUploadButton<OurFileRouter>();
export const UploadDropzone = generateUploadDropzone<OurFileRouter>();
export const { useUploadThing } = generateReactHelpers<OurFileRouter>();

/**
 * Server result of a finished upload. A moderated upload that was rejected reports `error`
 * instead of a file: that is toasted here and the result is `undefined`, so callers only
 * handle accepted files. Guards that must silence a stale upload run before this call.
 */
export const readUploadResult = <T extends { error?: string }>(
  res: readonly { serverData: T }[] | undefined,
): T | undefined => {
  const serverData = res?.[0]?.serverData;
  if (!serverData?.error) return serverData;
  showMutationToast({ success: false, message: serverData.error });
  return undefined;
};

/** `onUploadError` handler showing the failure as a toast. */
export const showUploadError = (error: { message: string }) => {
  showMutationToast({ success: false, message: error.message });
};
