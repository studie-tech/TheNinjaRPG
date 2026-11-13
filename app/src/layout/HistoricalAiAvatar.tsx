"use client";
import { Trash2 } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { ContentType, IMG_ORIENTATION } from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import Confirm from "@/layout/Confirm";
import Loader from "@/layout/Loader";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/**
 * Historical AI Avatar Change
 */

interface HistoricalAiAvatarProps {
  relationId?: string;
  contentType: ContentType;
  onUpdate?: (url: string) => void;
  size?: IMG_ORIENTATION;
  disabled?: boolean;
  operationGeneration?: number;
}

/** Select saved character/content artwork while retaining cached choices on read errors. */
export const HistoricalAiAvatar: React.FC<HistoricalAiAvatarProps> = (props) => {
  // Queries & mutations
  const [lastElement, setLastElement] = useState<HTMLButtonElement | null>(null);
  const {
    data: userData,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserDataSelector((u) => ({ username: u.username }));
  const { size = "square" } = props;
  const disabledRef = useRef(Boolean(props.disabled));
  const operationGenerationRef = useRef(props.operationGeneration ?? 0);
  const updateGenerationRef = useRef<number | null>(null);
  disabledRef.current = Boolean(props.disabled);
  operationGenerationRef.current = props.operationGeneration ?? 0;

  // tRPC utility
  const utils = api.useUtils();

  // Fetch historical avatars query
  const {
    data: historicalAvatars,
    fetchNextPage,
    hasNextPage,
    isPending,
    isError,
    isFetchNextPageError,
    isFetching,
    refetch,
  } = api.avatar.getHistoricalAvatars.useInfiniteQuery(
    {
      relationId: props.relationId,
      limit: 20,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const pageAvatars = historicalAvatars?.pages.flatMap((page) => page.data);

  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement,
  });

  // Update avatar mutation
  const updateAvatar = api.avatar.updateAvatar.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _input, revision) => {
      showMutationToast(data);
      if (
        data.success &&
        data.url &&
        !disabledRef.current &&
        updateGenerationRef.current === operationGenerationRef.current
      ) {
        if (data.userPatch || props.contentType === "user")
          await updateUser(data, { revision });
        if (
          props.onUpdate &&
          !disabledRef.current &&
          updateGenerationRef.current === operationGenerationRef.current
        ) {
          props.onUpdate(data.url);
        }
      }
    },
  });

  // Delete avatar mutation
  const deleteAvatar = api.avatar.deleteAvatar.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.avatar.getHistoricalAvatars.invalidate();
      }
    },
  });

  // Failed refreshes retain cached choices; pagination errors retry the failed cursor.
  const errorNotice = isError ? (
    <div role="alert" className="space-y-3 text-sm">
      <p>
        {!historicalAvatars
          ? "Could not load your previous avatars."
          : isFetchNextPageError
            ? "Could not load more avatars."
            : "Could not refresh your previous avatars."}
      </p>
      <Button
        type="button"
        disabled={isFetching}
        onClick={() => void (isFetchNextPageError ? fetchNextPage() : refetch())}
      >
        Try again
      </Button>
    </div>
  ) : null;
  const loading = updateAvatar.isPending || deleteAvatar.isPending;
  if (loading || isPending)
    return <Loader explanation={loading ? "Processing" : "Loading previous avatars"} />;
  if (isError && !historicalAvatars) return errorNotice;

  return (
    <>
      {errorNotice}
      {pageAvatars?.length === 0 && (
        <p className="text-muted-foreground py-6 text-center text-sm">
          No previous avatars yet. Generate an avatar to start your collection.
        </p>
      )}
      {pageAvatars && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-3">
          {pageAvatars.map((avatar, i) => (
            <div key={avatar.id} className="flex flex-col items-center gap-1">
              {/* Selection and deletion stay separate targets: delete sits below the image. */}
              <button
                type="button"
                aria-label={`Use saved avatar ${i + 1}`}
                className="focus-visible:outline-ring w-full rounded-2xl focus-visible:outline-2 disabled:opacity-50"
                disabled={props.disabled}
                onClick={() => {
                  if (disabledRef.current) return;
                  updateGenerationRef.current = operationGenerationRef.current;
                  updateAvatar.mutate({ avatar: avatar.id, type: props.contentType });
                }}
                ref={i === pageAvatars.length - 1 ? setLastElement : null}
              >
                <AvatarImage
                  href={avatar.avatar}
                  alt={userData?.username ?? "User Avatar"}
                  hover_effect={true}
                  size={200}
                  className={`w-full ${size === "square" ? "aspect-square" : "aspect-auto"}`}
                />
              </button>
              <Confirm
                title="Confirm Deletion"
                disabled={props.disabled}
                button={
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    aria-label={`Delete saved avatar ${i + 1}`}
                    disabled={props.disabled}
                    className="border-border/20 h-8 w-8 rounded-full border"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </Button>
                }
                onAccept={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  deleteAvatar.mutate({ avatar: avatar.id });
                }}
              >
                You are about to delete an avatar. Note that this action is permanent.
                Are you sure?
              </Confirm>
            </div>
          ))}
        </div>
      )}
    </>
  );
};
