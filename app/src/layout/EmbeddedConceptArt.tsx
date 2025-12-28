"use client";

import React from "react";
import Link from "next/link";
import Image from "@/layout/Image";
import { api } from "@/app/_trpc/client";
import { useUserData } from "@/utils/UserContext";
import { showMutationToast } from "@/libs/toast";
import { ExternalLink, ImageOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface EmbeddedConceptArtProps {
  imageId: string;
}

/**
 * Compact concept art component for embedding in conversations
 * Shows the image with voting buttons and a link to the full concept art page
 */
const EmbeddedConceptArt: React.FC<EmbeddedConceptArtProps> = ({ imageId }) => {
  const { data: user } = useUserData();
  const utils = api.useUtils();

  // Fetch the concept art image
  const {
    data: image,
    isLoading,
    isError,
  } = api.conceptart.get.useQuery(
    { id: imageId },
    { staleTime: 60000 }, // Cache for 1 minute
  );

  // Convenience function for refetching data
  const refetch = () => {
    void utils.conceptart.get.invalidate({ id: imageId });
  };

  // Toggle emotion mutation
  const { mutate: emotion } = api.conceptart.toggleEmotion.useMutation({
    onSuccess: (result) => {
      showMutationToast(result);
      refetch();
    },
  });

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

  return (
    <div className="my-2 inline-block max-w-[256px] overflow-hidden rounded-lg border border-slate-600 bg-slate-800/50">
      <div className="relative">
        {hasVideo ? (
          <video
            src={image.video!}
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
      <div className="flex items-center justify-between bg-slate-900/80 px-2 py-1.5">
        {/* Voting buttons */}
        <div className="flex items-center gap-1 text-xs text-white">
          <button
            className={`flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-slate-700 ${
              hasLike ? "bg-slate-700" : ""
            }`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (user) emotion({ imageId: image.id, type: "like" });
            }}
          >
            ❤️ {image.n_likes}
          </button>
          <button
            className={`flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-slate-700 ${
              hasLove ? "bg-slate-700" : ""
            }`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (user) emotion({ imageId: image.id, type: "love" });
            }}
          >
            👍 {image.n_loves}
          </button>
          <button
            className={`flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-slate-700 ${
              hasLaugh ? "bg-slate-700" : ""
            }`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (user) emotion({ imageId: image.id, type: "laugh" });
            }}
          >
            🤣 {image.n_laugh}
          </button>
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
