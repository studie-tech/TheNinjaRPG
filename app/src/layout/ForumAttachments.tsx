"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  TAVERN_IMAGE_MAX_SIZE_MB,
  TAVERN_IMAGE_UPLOAD_DAILY_LIMIT,
} from "@/drizzle/constants";
import { useHtmlSanitizer } from "@/hooks/useHtmlSanitizer";

/** Uses the editor's existing moderated upload path and account-owned image library. */
export function ForumAttachments({
  content,
  onChange,
  disabled,
}: {
  content: string;
  onChange: (content: string) => void;
  disabled: boolean;
}) {
  const [showLibrary, setShowLibrary] = useState(false);
  const uploads = api.forum.uploads.useQuery(undefined, {
    enabled: showLibrary,
    refetchOnMount: "always",
  });
  // A parsed document is inert: it runs no scripts and loads no images, so the draft is
  // only read here. Removing an image writes back sanitized markup.
  const draft =
    typeof window === "undefined"
      ? null
      : new DOMParser().parseFromString(content, "text/html");
  const images = [
    ...new Set(
      Array.from(draft?.querySelectorAll("img") ?? [])
        .map((img) => img.getAttribute("src"))
        .filter((url): url is string => !!url && /^(https?:\/\/|\/(?!\/))/i.test(url)),
    ),
  ];
  // Removal rewrites the current draft synchronously, so it waits for the sanitizer to load.
  const sanitizer = useHtmlSanitizer(images.length > 0);
  const remove = (url: string) => {
    if (!sanitizer) return;
    const document = new DOMParser().parseFromString(
      sanitizer.default(content),
      "text/html",
    );
    for (const img of document.querySelectorAll("img"))
      if (img.getAttribute("src") === url) img.remove();
    onChange(
      document.body.textContent?.trim() || document.querySelector("img, iframe")
        ? document.body.innerHTML
        : "",
    );
  };
  const insert = (url: string) => {
    const image = window.document.createElement("img");
    image.src = url;
    image.alt = "Attached image";
    onChange(`${content}<p>${image.outerHTML}</p><p><br></p>`);
  };
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Attachments{images.length ? ` (${images.length})` : ""}
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Use Upload image in the editor, or paste or drop an image. Images are moderated,
        up to {TAVERN_IMAGE_MAX_SIZE_MB} MB and {TAVERN_IMAGE_UPLOAD_DAILY_LIMIT} upload
        attempts per day. Uploaded images have public URLs; keep private information out
        of them.
      </p>
      {images.length > 0 && (
        <div className="my-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((url, index) => (
            <div key={url} className="rounded-md border p-2">
              <img
                src={url}
                alt={`Attachment ${index + 1}`}
                className="h-24 w-full rounded object-contain"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || !sanitizer}
                onClick={() => remove(url)}
              >
                Remove from draft
              </Button>
            </div>
          ))}
        </div>
      )}
      <p className="my-2 text-xs text-muted-foreground">
        Removing an image detaches it from this draft. Copies in published posts stay
        available.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setShowLibrary((v) => !v)}
      >
        {showLibrary ? "Close image library" : "Reuse my uploaded images"}
      </Button>
      {showLibrary && (
        <div className="mt-3">
          {uploads.isPending && (
            <p role="status" className="text-sm">
              Loading your image library…
            </p>
          )}
          {uploads.error && (
            <p role="alert" className="text-sm">
              Your images could not load.{" "}
              <Button type="button" size="sm" onClick={() => void uploads.refetch()}>
                Try again
              </Button>
            </p>
          )}
          {uploads.data?.length === 0 && (
            <p className="text-sm">
              No uploaded images yet. Use Upload image in the editor to add one.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {uploads.data?.map((upload) => (
              <button
                key={upload.id}
                type="button"
                className="rounded-md border p-2 text-left hover:bg-accent disabled:opacity-50"
                disabled={disabled || images.includes(upload.imageUrl)}
                onClick={() => insert(upload.imageUrl)}
              >
                <img
                  src={upload.imageUrl}
                  alt="Previously uploaded attachment"
                  className="h-24 w-full rounded object-contain"
                />
                <span className="mt-1 block text-xs">
                  {images.includes(upload.imageUrl) ? "Attached" : "Attach image"}
                </span>
              </button>
            ))}
          </div>
          {!!uploads.data?.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              Your 30 most recent moderated image uploads.
            </p>
          )}
        </div>
      )}
    </details>
  );
}
