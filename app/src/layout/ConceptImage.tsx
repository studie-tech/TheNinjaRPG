"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "@/layout/Image";
import {
  Trash2,
  Flag,
  Info,
  Share2,
  Copy,
  Check,
  Loader2,
  Video,
  ImageIcon,
} from "lucide-react";
import { api } from "@/app/_trpc/client";
import { useUserData } from "@/utils/UserContext";
import { secondsPassed } from "@/utils/time";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import ReportUser from "@/layout/Report";
import {
  IMG_ICON_FACEBOOK,
  IMG_ICON_REDDIT,
  IMG_ICON_TWITTER,
} from "@/drizzle/constants";
import { showMutationToast } from "@/libs/toast";
import type { ImageWithRelations } from "@/routers/conceptart";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  image: ImageWithRelations | undefined | null;
  showDetails?: boolean;
  width?: number;
  height?: number;
}

const ConceptImage: React.FC<InputProps> = (props) => {
  // Destructure props & state
  const { image, showDetails } = props;
  const { data: user } = useUserData();
  const [copied, setCopied] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const hasInvalidatedRef = useRef(false);

  // tRPC Utility
  const utils = api.useUtils();

  // Check if this is a video that's still processing
  const isVideo = image?.mediaType === "video";
  const isProcessing =
    isVideo && !image?.done && (image?.replicateId || image?.status === "uploading");

  // Track if finalization has been triggered
  const hasTriggeredFinalizeRef = useRef(false);

  // Mutation to finalize video upload
  const { mutate: finalizeUpload, isPending: isFinalizingUpload } =
    api.conceptart.finalizeVideoUpload.useMutation({
      onSuccess: (result) => {
        if (result.success && result.videoUrl) {
          // Video is ready, invalidate to get updated data
          hasInvalidatedRef.current = true;
          void utils.conceptart.get.invalidate({ id: image?.id ?? "" });
          void utils.conceptart.getAll.invalidate();
        }
      },
    });

  // Only poll when processing AND not currently finalizing
  const shouldPoll =
    isProcessing && !isFinalizingUpload && !hasTriggeredFinalizeRef.current;

  // Poll for video status when processing (read-only query)
  const { data: videoStatus } = api.conceptart.checkVideoStatusRead.useQuery(
    { id: image?.id ?? "" },
    {
      enabled: !!shouldPoll,
      refetchInterval: shouldPoll ? 5000 : false, // Poll every 5 seconds
    },
  );

  // Update progress and trigger finalization when ready
  useEffect(() => {
    if (videoStatus && "progress" in videoStatus && videoStatus.progress) {
      setVideoProgress(videoStatus.progress);
    }
    // When video is ready for finalization, call the mutation
    if (
      videoStatus &&
      "readyToFinalize" in videoStatus &&
      videoStatus.readyToFinalize &&
      !hasInvalidatedRef.current &&
      !hasTriggeredFinalizeRef.current &&
      !isFinalizingUpload &&
      image?.id
    ) {
      hasTriggeredFinalizeRef.current = true;
      finalizeUpload({ id: image.id });
    }
    // If video is already complete (from previous finalization), invalidate
    if (
      videoStatus &&
      "status" in videoStatus &&
      videoStatus.status === "succeeded" &&
      "videoUrl" in videoStatus &&
      videoStatus.videoUrl &&
      !hasInvalidatedRef.current
    ) {
      hasInvalidatedRef.current = true;
      void utils.conceptart.get.invalidate({ id: image?.id ?? "" });
      void utils.conceptart.getAll.invalidate();
    }
  }, [videoStatus, image?.id, utils, finalizeUpload, isFinalizingUpload]);

  // Convenience function for refetching data
  const refetch = () => {
    if (image) {
      void utils.conceptart.get.invalidate({ id: image.id });
    }
    void utils.conceptart.getAll.invalidate();
  };

  // Toggle emotion a new image
  const { mutate: emotion } = api.conceptart.toggleEmotion.useMutation({
    onSuccess: (result) => {
      showMutationToast(result);
      refetch();
    },
  });

  // Delete image
  const { mutate: remove } = api.conceptart.delete.useMutation({
    onSuccess: (result) => {
      showMutationToast(result);
      refetch();
    },
  });

  // Return loading state for processing videos
  if (isProcessing) {
    const statusMessage =
      videoStatus && "message" in videoStatus && typeof videoStatus.message === "string"
        ? videoStatus.message
        : "Generating video...";
    return (
      <div className="aspect-256/345 w-full rounded-xl p-4 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-purple-900 to-indigo-900 text-center text-white">
        <Video className="h-12 w-12 animate-pulse text-purple-300" />
        <div className="text-sm font-medium">{statusMessage}</div>
        {videoProgress > 0 && (
          <div className="w-full max-w-[200px]">
            <Progress value={videoProgress} className="h-2" />
            <div className="mt-1 text-xs text-purple-200">{videoProgress}%</div>
          </div>
        )}
        <Loader2 className="h-6 w-6 animate-spin text-purple-300" />
      </div>
    );
  }

  // Return skeleton for other loading states (need at least thumbnail image)
  if (!image?.image || !image?.done) {
    const secs = secondsPassed(image?.createdAt || new Date());
    let status = image?.status;
    if (image && secs > 20 && status === "starting") {
      status = "Starting cluster, this may take up to 1-5 minutes";
    }

    return (
      <div className="aspect-256/345 w-full rounded-xl p-2 flex animate-pulse flex-row items-center justify-center bg-amber-500 text-center text-black">
        {status}
      </div>
    );
  }

  // Determine if we should show video (only on detail page when video exists)
  const showVideo = isVideo && showDetails && image.video;

  // Show image
  const hasLike = image?.likes?.find(
    (like) => like.userId === user?.userId && like.type === "like",
  );
  const hasLove = image?.likes?.find(
    (like) => like.userId === user?.userId && like.type === "love",
  );
  const hasLaugh = image?.likes?.find(
    (like) => like.userId === user?.userId && like.type === "laugh",
  );

  // Social sharing
  const shareLink = `https://www.theninja-rpg.com/conceptart/${image.id}`;
  const shareTitle = "My%20Ninja%20Concept%20Art";

  return (
    <div>
      <div className="relative">
        {showVideo ? (
          <video
            src={image.video!}
            width={props.width || 512}
            height={props.height || 768}
            className="w-full cursor-pointer rounded-md"
            controls
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <div className="relative">
            <Image
              src={image.image}
              width={props.width || 512}
              height={props.height || 768}
              quality={100}
              unoptimized={true}
              placeholder="blur"
              blurDataURL="data:text/plain;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPU0Mg4AwACvgGGUxJrcQAAAABJRU5ErkJggg=="
              alt={image.prompt || image.id}
              className="w-full cursor-pointer rounded-md"
            />
            {/* Video badge for thumbnails on listing page */}
            {isVideo && !showDetails && (
              <div className="absolute top-2 left-2 bg-black/70 rounded px-1.5 py-0.5 flex items-center gap-1">
                <Video className="h-3 w-3 text-white" />
                <span className="text-xs text-white">Video</span>
              </div>
            )}
            {!isVideo && !showDetails && (
              <div className="absolute top-2 left-2 bg-black/70 rounded px-1.5 py-0.5 flex items-center gap-1">
                <ImageIcon className="h-3 w-3 text-white" />
                <span className="text-xs text-white">Image</span>
              </div>
            )}
          </div>
        )}
        <div className="absolute right-2 top-2">
          {image.userId === user?.userId && (
            <Trash2
              className={` cursor-pointer hover:fill-red-500 text-white ${
                showDetails ? "h-6 w-6" : "h-4 w-4"
              }`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                remove({ id: image.id });
              }}
            />
          )}
          {showDetails && (
            <ReportUser
              user={image.user}
              content={{
                id: image.id,
                title: isVideo
                  ? "Purposefully inappropriate video"
                  : "Purposefully inappropriate image",
                content:
                  isVideo && image.video
                    ? '<video src="' + image.video + '" width="200" controls />'
                    : '<img src="' + image.image + '" width="200" />',
              }}
              system="concept_art"
              button={<Flag className="h-6 w-6 hover:text-orange-500 text-white" />}
            />
          )}
        </div>
        <div
          className={`absolute bottom-1 left-1 right-1 flex ${
            showDetails ? "h-12 text-lg" : "h-6 text-xs"
          } flex-row items-center rounded-md border border-slate-700 bg-slate-800 opacity-90 text-white`}
        >
          <div
            className={`flex cursor-pointer flex-row ml-1 px-1 ${
              hasLike ? "bg-slate-700" : ""
            }`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (user) emotion({ imageId: image.id, type: "like" });
            }}
          >
            ❤️ {image.n_likes}
          </div>
          <div
            className={`flex cursor-pointer flex-row px-1 ${
              hasLove ? "bg-slate-700" : ""
            }`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (user) emotion({ imageId: image.id, type: "love" });
            }}
          >
            👍 {image.n_loves}
          </div>
          <div
            className={`flex cursor-pointer flex-row px-1 ${
              hasLaugh ? "bg-slate-700" : ""
            }`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (user) emotion({ imageId: image.id, type: "laugh" });
            }}
          >
            🤣 {image.n_laugh}
          </div>
          <div className="grow"></div>
          {showDetails && (
            <>
              <a
                rel="nofollow"
                target="_blank"
                href={`https://www.facebook.com/dialog/share?app_id=327306013991565&href=${shareLink}&display=popup`}
              >
                <Image
                  className="hover:opacity-70"
                  src={IMG_ICON_FACEBOOK}
                  width={28}
                  height={28}
                  alt={"FacebookShare"}
                ></Image>
              </a>
              <a
                rel="nofollow"
                target="_blank"
                href={`https://www.reddit.com/submit?url=${shareLink}&title=${shareTitle}`}
              >
                <Image
                  className="hover:opacity-70"
                  src={IMG_ICON_REDDIT}
                  width={28}
                  height={28}
                  alt={"RedditShare"}
                ></Image>
              </a>
              <a
                rel="nofollow"
                target="_blank"
                href={`https://twitter.com/intent/tweet?url=${shareLink}&text=${shareTitle}&via=TheNinjaRPG&related=TNR&hashtags=TheNinjaRPG`}
              >
                <Image
                  className="hover:opacity-70"
                  src={IMG_ICON_TWITTER}
                  width={28}
                  height={28}
                  alt={"TwitterShare"}
                ></Image>
              </a>

              <Popover>
                <PopoverTrigger asChild>
                  <button className="mx-1 flex h-7 w-7 items-center justify-center rounded hover:bg-slate-700">
                    <Share2 className="h-5 w-5 cursor-pointer hover:text-orange-500" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-96 min-w-96" side="top">
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-medium">Share to Chat</h4>
                      <p className="text-sm text-muted-foreground">
                        Copy this tag and paste it in any conversation to share your
                        art:
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded bg-slate-200 px-2 py-1 text-sm font-mono text-black">
                        [conceptart:{image.id}]
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void navigator.clipboard.writeText(
                            `[conceptart:${image.id}]`,
                          );
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                      >
                        {copied ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Others will see your art and can vote on it directly in the chat!
                    </p>
                  </div>
                </PopoverContent>
              </Popover>

              <TooltipProvider delayDuration={50}>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-8 w-8 mr-2 cursor-pointer hover:text-orange-500" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      <b>Created by: </b>
                      {image.user?.username}
                    </p>
                    <p className="mt-2">
                      <b>Prompt: </b>
                      {image.prompt}
                    </p>
                    {image.negative_prompt && (
                      <p>
                        <b>Negative Prompt: </b>
                        {image.negative_prompt}
                      </p>
                    )}
                    <p className="mt-2">
                      <b>Seed: </b>
                      {image.seed}
                    </p>
                    <p>
                      <b>CFG: </b>
                      {image.guidance_scale}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* <div className="group">
                <Info className="h-8 w-8 mr-2 cursor-pointer hover:text-orange-500" />
                <span className="absolute bottom-8 right-0 z-50 rounded-md bg-gray-800 p-2 text-sm text-gray-100 opacity-0 transition-opacity group-hover:opacity-100">
                  <p>
                    <b>Created by: </b>
                    {image.user?.username}
                  </p>
                  <p className="mt-2">
                    <b>Prompt: </b>
                    {image.prompt}
                  </p>
                  {image.negative_prompt && (
                    <p>
                      <b>Negative Prompt: </b>
                      {image.negative_prompt}
                    </p>
                  )}
                  <p className="mt-2">
                    <b>Seed: </b>
                    {image.seed}
                  </p>
                  <p>
                    <b>CFG: </b>
                    {image.guidance_scale}
                  </p>
                </span>
              </div> */}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConceptImage;
