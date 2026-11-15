"use client";

import type React from "react";
import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { UploadButton } from "@/utils/uploadthing";

type UploadButtonProps = React.ComponentProps<typeof UploadButton>;

// The export is read at render, so the loaded chunk always renders the module's current button.
const UploadThingButton = lazy(() =>
  import("@/utils/uploadthing").then((module) => ({
    default: (props: UploadButtonProps) => <module.UploadButton {...props} />,
  })),
);

/**
 * UploadThing's button for dialogs that open on demand. The uploader client and its
 * runtime load when the button first renders, behind a placeholder of the button's size.
 * The cast restores the endpoint generic that the lazy wrapper erases.
 */
export const LazyUploadButton = ((props: UploadButtonProps) => (
  <Suspense fallback={<Skeleton className="h-10 w-36" />}>
    <UploadThingButton {...props} />
  </Suspense>
)) as typeof UploadButton;
