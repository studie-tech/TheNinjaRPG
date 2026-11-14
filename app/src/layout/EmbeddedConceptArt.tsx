"use client";

import { ExternalLink, ImageOff } from "lucide-react";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { type ConceptEmotion, ConceptReactions } from "@/layout/ConceptReactions";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import { showMutationToast } from "@/libs/toast";
import { useUserDataSelector } from "@/utils/UserContext";

interface EmbeddedConceptArtProps {
  imageId: string;
}

/**
 * Compact concept art component for embedding in conversations
 * Shows the image with voting buttons and a link to the full concept art page
 */
const EmbeddedConceptArt: React.FC<EmbeddedConceptArtProps> = ({ imageId }) => {
  const { data: user } = useUserDataSelector((u) => ({ userId: u.userId }));
  const utils = api.useUtils();
  const emotionFlight = useSingleFlight<ConceptEmotion>();
  const pendingEmotion = emotionFlight.pending;

  // Fetch the concept art image
  const {
    data: image,
    isLoading,
    isError,
  } = api.conceptart.get.useQuery(
    { id: imageId },
    { staleTime: 60000 }, // Cache for 1 minute
  );

  const emotion = api.conceptart.toggleEmotion.useMutation();

  const toggleEmotion = async (type: ConceptEmotion) => {
    if (!user || !emotionFlight.claim(type)) return;

    try {
      const result = await emotion.mutateAsync({ imageId, type });
      showMutationToast(result);
      if (result.success) await utils.conceptart.get.invalidate({ id: imageId });
    } catch (error) {
      showMutationToast({
        success: false,
        message: error instanceof Error ? error.message : "Could not update reaction",
      });
    } finally {
      emotionFlight.release();
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

  const isEmotionPending = pendingEmotion !== null;

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
          <ConceptReactions
            image={image}
            userId={user?.userId}
            pendingEmotion={pendingEmotion}
            disabled={isEmotionPending}
            buttonClassName="flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-transparent"
            onToggle={(type) => void toggleEmotion(type)}
          />
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
