"use client";

import {
  Check,
  Copy,
  Flag,
  ImageIcon,
  Info,
  Loader2,
  Share2,
  Trash2,
  Video,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  IMG_ICON_FACEBOOK,
  IMG_ICON_REDDIT,
  IMG_ICON_TWITTER,
} from "@/drizzle/constants";
import Image from "@/layout/Image";
import Modal from "@/layout/Modal";
import ReportUser from "@/layout/Report";
import { showMutationToast } from "@/libs/toast";
import type { ImageWithRelations } from "@/routers/conceptart";
import { canDeleteConceptArt } from "@/utils/permissions";
import { secondsPassed } from "@/utils/time";
import { useUserData } from "@/utils/UserContext";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  image: ImageWithRelations | undefined | null;
  showDetails?: boolean;
  width?: number;
  height?: number;
  onDeleted?: (imageId: string) => void;
}

type ConceptEmotion = "like" | "love" | "laugh";

const ConceptImage: React.FC<InputProps> = (props) => {
  // Destructure props & state
  const { image, showDetails } = props;
  const { data: user } = useUserData();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const hasInvalidatedRef = useRef(false);
  const emotionRequestIdRef = useRef(0);
  const emotionInFlightRef = useRef<{ imageId: string; requestId: number } | null>(
    null,
  );
  const previousImageIdRef = useRef(image?.id);
  const [pendingEmotion, setPendingEmotion] = useState<{
    imageId: string;
    type: ConceptEmotion;
  } | null>(null);
  const deleteInFlightRef = useRef<string | null>(null);
  const currentImageIdRef = useRef(image?.id);
  currentImageIdRef.current = image?.id;
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deletedImageId, setDeletedImageId] = useState<string | null>(null);

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

  // Toggle an emotion on an image. Only one toggle may be in flight per card: the
  // endpoint returns a success envelope rather than authoritative counters, so the
  // UI remains response-driven and reconciles both query surfaces after success.
  const emotion = api.conceptart.toggleEmotion.useMutation();

  useEffect(() => {
    if (previousImageIdRef.current === image?.id) return;

    previousImageIdRef.current = image?.id;
    currentImageIdRef.current = image?.id;
    emotionInFlightRef.current = null;
    deleteInFlightRef.current = null;
    setPendingEmotion(null);
    setDeleteTargetId(null);
    setShowDeleteConfirmation(false);
    setDeletedImageId(null);
  }, [image?.id]);

  const toggleEmotion = async (type: ConceptEmotion) => {
    if (
      !user ||
      !image ||
      emotionInFlightRef.current?.imageId === image.id ||
      deleteInFlightRef.current === image.id
    )
      return;

    const imageId = image.id;
    const requestId = ++emotionRequestIdRef.current;
    emotionInFlightRef.current = { imageId, requestId };
    setPendingEmotion({ imageId, type });

    try {
      const result = await emotion.mutateAsync({ imageId, type });
      showMutationToast(result);

      if (result.success) {
        await Promise.allSettled([
          utils.conceptart.get.invalidate({ id: imageId }),
          utils.conceptart.getAll.invalidate(),
        ]);
      }
    } catch (error) {
      showMutationToast({
        success: false,
        message: error instanceof Error ? error.message : "Could not update reaction",
      });
    } finally {
      const activeRequest = emotionInFlightRef.current;
      if (activeRequest?.imageId === imageId && activeRequest.requestId === requestId) {
        emotionInFlightRef.current = null;
        setPendingEmotion(null);
      }
    }
  };

  // Delete one exact piece of concept art. The ref is the synchronous guard: the
  // mutation's pending render cannot happen quickly enough to stop a double click.
  const remove = api.conceptart.delete.useMutation();

  const deleteImage = async () => {
    if (!image || deleteInFlightRef.current === image.id || isEmotionPending) return;

    const imageId = image.id;
    deleteInFlightRef.current = imageId;
    setDeleteTargetId(imageId);

    try {
      const result = await remove.mutateAsync({ id: imageId });
      showMutationToast(result);

      if (!result.success) return;

      // Tombstone the exact art before any refresh. This keeps stale/failed query
      // reconciliation from flashing a deleted card back into the gallery.
      setDeletedImageId(imageId);
      setShowDeleteConfirmation(false);
      props.onDeleted?.(imageId);
      if (showDetails && currentImageIdRef.current === imageId) {
        router.replace("/conceptart");
      }

      void Promise.allSettled([
        utils.conceptart.get.invalidate({ id: imageId }),
        utils.conceptart.getAll.invalidate(),
      ]);
    } catch (error) {
      showMutationToast({
        success: false,
        message:
          error instanceof Error ? error.message : "Could not delete concept art",
      });
    } finally {
      if (deleteInFlightRef.current === imageId) {
        deleteInFlightRef.current = null;
        setDeleteTargetId(null);
      }
    }
  };

  // Return loading state for processing videos
  if (isProcessing) {
    const statusMessage =
      videoStatus && "message" in videoStatus && typeof videoStatus.message === "string"
        ? videoStatus.message
        : "Generating video...";
    return (
      <div className="flex aspect-256/345 w-full flex-col items-center justify-center gap-3 rounded-xl bg-gradient-to-br from-purple-900 to-indigo-900 p-4 text-center text-white">
        <Video className="h-12 w-12 animate-pulse text-purple-300" />
        <div className="font-medium text-sm">{statusMessage}</div>
        {videoProgress > 0 && (
          <div className="w-full max-w-[200px]">
            <Progress value={videoProgress} className="h-2" />
            <div className="mt-1 text-purple-200 text-xs">{videoProgress}%</div>
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
      <div className="flex aspect-256/345 w-full animate-pulse flex-row items-center justify-center rounded-xl bg-amber-500 p-2 text-center text-black">
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
  const isEmotionPending = pendingEmotion?.imageId === image.id;
  const isDeleting = deleteTargetId === image.id;

  if (deletedImageId === image.id) {
    return showDetails ? (
      <div className="flex min-h-48 items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        <span role="status">Concept art deleted. Returning to the gallery…</span>
      </div>
    ) : null;
  }

  // Social sharing
  const shareLink = `https://www.theninja-rpg.com/conceptart/${image.id}`;
  const shareTitle = "My%20Ninja%20Concept%20Art";

  return (
    <div>
      <div className="relative">
        {showVideo && image.video ? (
          <video
            src={image.video}
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
              <div className="absolute top-2 left-2 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5">
                <Video className="h-3 w-3 text-white" />
                <span className="text-white text-xs">Video</span>
              </div>
            )}
            {!isVideo && !showDetails && (
              <div className="absolute top-2 left-2 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5">
                <ImageIcon className="h-3 w-3 text-white" />
                <span className="text-white text-xs">Image</span>
              </div>
            )}
          </div>
        )}
        <div className="absolute top-2 right-2">
          {(image.userId === user?.userId ||
            (user && canDeleteConceptArt(user.role))) && (
            /* biome-ignore lint/a11y/useSemanticElements: gallery cards wrap this control in a link, where a nested button would be invalid interactive markup */
            <span
              role="button"
              tabIndex={isDeleting || isEmotionPending ? -1 : 0}
              aria-disabled={isDeleting || isEmotionPending}
              aria-label={`Delete concept art${image.prompt ? `: ${image.prompt}` : ""}`}
              className={`inline-flex rounded-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
                isDeleting || isEmotionPending
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer hover:text-red-400"
              }`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isDeleting || isEmotionPending) return;
                setShowDeleteConfirmation(true);
              }}
              onKeyDown={(e) => {
                if (isDeleting || isEmotionPending) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowDeleteConfirmation(true);
                }
              }}
            >
              <Trash2
                className={showDetails ? "h-7 w-7" : "h-5 w-5"}
                aria-hidden="true"
              />
            </span>
          )}
          {showDetails && (
            <ReportUser
              user={image.user}
              content={{
                id: image.id,
                title: isVideo
                  ? "Purposefully inappropriate video"
                  : "Purposefully inappropriate image",
                // Both dimensions are given so the report preview reserves space before
                // the media loads. Concept art is generated at a 2:3 portrait ratio.
                content:
                  isVideo && image.video
                    ? `<video src="${image.video}" width="200" height="300" controls />`
                    : `<img src="${image.image}" width="200" height="300" />`,
              }}
              system="concept_art"
              button={<Flag className="h-6 w-6 text-white hover:text-orange-500" />}
            />
          )}
        </div>
        <div
          className={`absolute right-1 bottom-1 left-1 flex ${showDetails ? "h-12 text-lg" : "h-6 text-xs"} flex-row items-center rounded-md border border-slate-700 bg-slate-800 text-white opacity-90`}
        >
          <button
            type="button"
            className={`ml-1 flex cursor-pointer flex-row items-center gap-1 px-1 disabled:cursor-not-allowed disabled:opacity-70 ${hasLike ? "bg-slate-700" : ""}`}
            disabled={isEmotionPending || isDeleting}
            aria-busy={pendingEmotion?.type === "like"}
            aria-pressed={!!hasLike}
            aria-label={
              pendingEmotion?.type === "like"
                ? "Updating reaction…"
                : `${hasLike ? "Remove" : "Add"} heart reaction`
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void toggleEmotion("like");
            }}
          >
            {pendingEmotion?.type === "like" && (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            )}
            ❤️ {image.n_likes}
          </button>
          <button
            type="button"
            className={`flex cursor-pointer flex-row items-center gap-1 px-1 disabled:cursor-not-allowed disabled:opacity-70 ${hasLove ? "bg-slate-700" : ""}`}
            disabled={isEmotionPending || isDeleting}
            aria-busy={pendingEmotion?.type === "love"}
            aria-pressed={!!hasLove}
            aria-label={
              pendingEmotion?.type === "love"
                ? "Updating reaction…"
                : `${hasLove ? "Remove" : "Add"} thumbs-up reaction`
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void toggleEmotion("love");
            }}
          >
            {pendingEmotion?.type === "love" && (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            )}
            👍 {image.n_loves}
          </button>
          <button
            type="button"
            className={`flex cursor-pointer flex-row items-center gap-1 px-1 disabled:cursor-not-allowed disabled:opacity-70 ${hasLaugh ? "bg-slate-700" : ""}`}
            disabled={isEmotionPending || isDeleting}
            aria-busy={pendingEmotion?.type === "laugh"}
            aria-pressed={!!hasLaugh}
            aria-label={
              pendingEmotion?.type === "laugh"
                ? "Updating reaction…"
                : `${hasLaugh ? "Remove" : "Add"} laugh reaction`
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void toggleEmotion("laugh");
            }}
          >
            {pendingEmotion?.type === "laugh" && (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            )}
            🤣 {image.n_laugh}
          </button>
          {isEmotionPending && (
            <span className="sr-only" role="status" aria-live="polite">
              Updating reaction…
            </span>
          )}
          <div className="grow"></div>
          {showDetails && (
            <>
              <a
                rel="noopener nofollow"
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
                rel="noopener nofollow"
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
                rel="noopener nofollow"
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
                  <button
                    type="button"
                    className="mx-1 flex h-7 w-7 items-center justify-center rounded hover:bg-slate-700"
                  >
                    <Share2 className="h-5 w-5 cursor-pointer hover:text-orange-500" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-96 min-w-96" side="top">
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-medium">Share to Chat</h4>
                      <p className="text-muted-foreground text-sm">
                        Copy this tag and paste it in any conversation to share your
                        art:
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded bg-slate-200 px-2 py-1 font-mono text-black text-sm">
                        [conceptart:{image.id}]
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          try {
                            await navigator.clipboard.writeText(
                              `[conceptart:${image.id}]`,
                            );
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          } catch (_error) {
                            showMutationToast({
                              success: false,
                              message:
                                "Could not copy to clipboard. Please copy the code manually.",
                            });
                          }
                        }}
                      >
                        {copied ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Others will see your art and can vote on it directly in the chat!
                    </p>
                  </div>
                </PopoverContent>
              </Popover>

              <TooltipProvider delayDuration={50}>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="mr-2 h-8 w-8 cursor-pointer hover:text-orange-500" />
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
      <Modal
        id={`delete-concept-art-${image.id}`}
        title="Delete concept art?"
        isOpen={showDeleteConfirmation}
        setIsOpen={setShowDeleteConfirmation}
        proceed_label="Delete"
        proceed_loading_label="Deleting concept art…"
        confirmClassName="bg-red-600 text-white hover:bg-red-700"
        isLoading={isDeleting}
        keepOpenOnAccept
        onAccept={() => void deleteImage()}
      >
        <div className="space-y-3">
          <p>
            You are about to permanently delete concept art by{" "}
            <strong>{image.user?.username || "an unknown creator"}</strong>.
          </p>
          {image.prompt && (
            <p className="rounded-md border border-slate-600 bg-slate-800/60 p-3 text-sm">
              <span className="font-semibold">Prompt:</span> {image.prompt}
            </p>
          )}
          <p className="text-red-300 text-sm">
            This cannot be undone. The art will disappear from the gallery and its
            detail page.
          </p>
        </div>
      </Modal>
    </div>
  );
};

export default ConceptImage;
