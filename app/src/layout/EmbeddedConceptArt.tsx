"use client";

import { ExternalLink, ImageOff, Loader2 } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Skeleton } from "@/components/ui/skeleton";
import Image from "@/layout/Image";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";

interface EmbeddedConceptArtProps {
  imageId: string;
}

type ConceptEmotion = "like" | "love" | "laugh";

/**
 * Compact concept art component for embedding in conversations
 * Shows the image with voting buttons and a link to the full concept art page
 */
const EmbeddedConceptArt: React.FC<EmbeddedConceptArtProps> = ({ imageId }) => {
  const { data: user } = useUserData();
  const utils = api.useUtils();
  const requestIdRef = useRef(0);
  const inFlightRef = useRef<{ imageId: string; requestId: number } | null>(null);
  const currentImageIdRef = useRef(imageId);
  currentImageIdRef.current = imageId;
  const [pendingEmotion, setPendingEmotion] = useState<{
    imageId: string;
    type: ConceptEmotion;
  } | null>(null);

  // Fetch the concept art image
  const {
    data: image,
    isLoading,
    isError,
  } = api.conceptart.get.useQuery(
    { id: imageId },
    { staleTime: 60000 }, // Cache for 1 minute
  );

  // Keep each embedded card's request ownership tied to the art it rendered. A
  // delayed response from an old identity may refresh that old cache entry, but
  // must never clear or overwrite the pending state of a newly rendered embed.
  const emotion = api.conceptart.toggleEmotion.useMutation();

  useEffect(() => {
    if (inFlightRef.current?.imageId !== imageId) {
      inFlightRef.current = null;
    }
    setPendingEmotion((pending) => (pending?.imageId === imageId ? pending : null));
  }, [imageId]);

  const toggleEmotion = async (type: ConceptEmotion, targetImageId: string) => {
    if (!user || inFlightRef.current?.imageId === targetImageId) return;

    const requestId = ++requestIdRef.current;
    inFlightRef.current = { imageId: targetImageId, requestId };
    setPendingEmotion({ imageId: targetImageId, type });

    try {
      const result = await emotion.mutateAsync({ imageId: targetImageId, type });
      if (currentImageIdRef.current === targetImageId) {
        showMutationToast(result);
      }
      if (result.success) {
        await Promise.allSettled([
          utils.conceptart.get.invalidate({ id: targetImageId }),
        ]);
      }
    } catch (error) {
      if (currentImageIdRef.current === targetImageId) {
        showMutationToast({
          success: false,
          message: error instanceof Error ? error.message : "Could not update reaction",
        });
      }
    } finally {
      const activeRequest = inFlightRef.current;
      if (
        activeRequest?.imageId === targetImageId &&
        activeRequest.requestId === requestId
      ) {
        inFlightRef.current = null;
        setPendingEmotion((pending) =>
          pending?.imageId === targetImageId ? null : pending,
        );
      }
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="my-2 inline-block w-[200px] rounded-lg border border-slate-600 bg-slate-800/50 p-2">
        <Skeleton className="h-[300px] w-full rounded-md" />
        <Skeleton className="mt-2 h-4 w-32" />
      </div>
    );
  }

  // Error or not found state
  if (isError || !image || !image.image) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800/50 p-3 text-slate-400">
        <ImageOff className="h-5 w-5" />
        <span className="text-sm">Concept art not found</span>
      </div>
    );
  }

  // Determine if this is a video with video content available
  const isVideo = image.mediaType === "video";
  const hasVideo = isVideo && image.video;

  // Check user reactions
  const hasLike = image?.likes?.find(
    (like) => like.userId === user?.userId && like.type === "like",
  );
  const hasLove = image?.likes?.find(
    (like) => like.userId === user?.userId && like.type === "love",
  );
  const hasLaugh = image?.likes?.find(
    (like) => like.userId === user?.userId && like.type === "laugh",
  );
  const isEmotionPending = pendingEmotion?.imageId === image.id;

  return (
    <div className="my-2 inline-block max-w-[256px] overflow-hidden rounded-lg border border-slate-600 bg-slate-800/50">
      <div className="relative">
        {hasVideo && image.video ? (
          <video
            src={image.video}
            width={256}
            height={384}
            className="block w-full"
            controls
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <Link href={`/conceptart/${image.id}`}>
            <Image
              src={image.image}
              width={256}
              height={384}
              quality={80}
              unoptimized={true}
              alt={image.prompt || "Concept Art"}
              className="block w-full cursor-pointer transition-opacity hover:opacity-90"
            />
          </Link>
        )}
      </div>

      {/* Voting bar and info */}
      <div
        className="flex items-center justify-between bg-slate-900/80 px-2 py-1.5"
        aria-busy={isEmotionPending}
      >
        {/* Voting buttons */}
        <div className="flex items-center gap-1 text-white text-xs">
          <button
            type="button"
            className={`flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-transparent ${hasLike ? "bg-slate-700" : ""}`}
            disabled={isEmotionPending}
            aria-busy={pendingEmotion?.type === "like"}
            aria-pressed={!!hasLike}
            aria-label={
              pendingEmotion?.type === "like"
                ? "Updating"
                : `${hasLike ? "Remove" : "Add"} heart reaction`
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void toggleEmotion("like", image.id);
            }}
          >
            {pendingEmotion?.type === "like" && (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            )}
            ❤️ {image.n_likes}
          </button>
          <button
            type="button"
            className={`flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-transparent ${hasLove ? "bg-slate-700" : ""}`}
            disabled={isEmotionPending}
            aria-busy={pendingEmotion?.type === "love"}
            aria-pressed={!!hasLove}
            aria-label={
              pendingEmotion?.type === "love"
                ? "Updating"
                : `${hasLove ? "Remove" : "Add"} thumbs-up reaction`
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void toggleEmotion("love", image.id);
            }}
          >
            {pendingEmotion?.type === "love" && (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            )}
            👍 {image.n_loves}
          </button>
          <button
            type="button"
            className={`flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-transparent ${hasLaugh ? "bg-slate-700" : ""}`}
            disabled={isEmotionPending}
            aria-busy={pendingEmotion?.type === "laugh"}
            aria-pressed={!!hasLaugh}
            aria-label={
              pendingEmotion?.type === "laugh"
                ? "Updating"
                : `${hasLaugh ? "Remove" : "Add"} laugh reaction`
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void toggleEmotion("laugh", image.id);
            }}
          >
            {pendingEmotion?.type === "laugh" && (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            )}
            🤣 {image.n_laugh}
          </button>
          {isEmotionPending && (
            <span className="sr-only" role="status" aria-live="polite">
              Updating
            </span>
          )}
        </div>

        {/* Link to full view */}
        <Link
          href={`/conceptart/${image.id}`}
          className="flex shrink-0 items-center gap-0.5 text-[10px] text-slate-400 transition-colors hover:text-white"
        >
          <span>by {image.user?.username}</span>
          <ExternalLink className="h-2.5 w-2.5" />
        </Link>
      </div>
    </div>
  );
};

export default EmbeddedConceptArt;
