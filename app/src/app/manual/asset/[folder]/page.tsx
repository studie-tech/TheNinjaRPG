"use client";

import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import type { GameAsset } from "@/drizzle/schema";
import { ActionOption, ActionSelector } from "@/layout/CombatActions";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ManualAssetsFolderPage() {
  const params = useParams<{ folder: string }>();
  const folder = decodeURIComponent(params.folder);

  const { data: userData } = useUserData();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [asset, setAsset] = useState<GameAsset | undefined>(undefined);
  const [deletingAssetIds, setDeletingAssetIds] = useState<string[]>([]);
  const deletingAssetIdsRef = useRef(new Set<string>());
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  const {
    data: assets,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
  } = api.gameAsset.getAll.useInfiniteQuery(
    { limit: 60, folder },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allAssets = assets?.pages.flatMap((page) => page.data);
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  const { mutate: remove } = api.gameAsset.delete.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
    },
    onSettled: (_data, _error, variables) => {
      deletingAssetIdsRef.current.delete(variables.id);
      setDeletingAssetIds((current) =>
        current.filter((assetId) => assetId !== variables.id),
      );
    },
  });

  const handleAssetClick = (id: string) => {
    if (deletingAssetIdsRef.current.has(id)) return;
    setAsset(allAssets?.find((currentAsset) => currentAsset.id === id));
    setIsOpen(true);
  };

  const handleDelete = (id: string) => {
    // State updates are asynchronous, so keep a synchronous per-asset guard as
    // well. Different assets remain usable while this request is in flight.
    if (deletingAssetIdsRef.current.has(id)) return;
    deletingAssetIdsRef.current.add(id);
    setDeletingAssetIds((current) => [...current, id]);
    setIsOpen(false);
    remove({ id });
  };

  const isPending = isFetching;

  return (
    <ContentBox
      title={`Folder: ${folder}`}
      subtitle="Assets in this folder"
      defaultBackHref="/manual/asset"
    >
      <ActionSelector
        items={allAssets?.map((a) => ({
          ...a,
          type: "asset" as const,
          assetType: a.type,
          url: a.url,
        }))}
        labelSingles={true}
        onClick={handleAssetClick}
        showBgColor={false}
        roundFull={true}
        hideBorder={true}
        showLabels={true}
        lastElement={lastElement}
        setLastElement={setLastElement}
        gridClassNameOverwrite="grid grid-cols-3 md:grid-cols-4"
        emptyText="No assets exist in this folder."
        renderItem={(item) => {
          const isDeleting = deletingAssetIds.includes(item.id);
          return (
            <div
              className="relative h-full w-full"
              aria-busy={isDeleting}
              aria-disabled={isDeleting}
              data-asset-id={item.id}
            >
              <div className={isDeleting ? "pointer-events-none opacity-40" : ""}>
                <ActionOption
                  item={item}
                  settings={{
                    labelSingles: true,
                    onClick: handleAssetClick,
                    roundFull: true,
                    hideBorder: true,
                    showBgColor: false,
                    showLabels: true,
                  }}
                  isGreyed={false}
                />
              </div>
              {isDeleting && (
                <div
                  id={`asset-${item.id}-delete-status`}
                  className="absolute inset-0 z-10 flex cursor-wait items-center justify-center rounded-xl bg-slate-950/75 font-semibold text-white backdrop-blur-[1px]"
                  role="status"
                  aria-live="polite"
                >
                  <Loader explanation="Deleting" noPadding size={24} />
                </div>
              )}
            </div>
          );
        }}
      />
      {isPending && <Loader explanation="Loading data" />}
      {isOpen && userData && asset && (
        <Modal
          title="Asset Details"
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          isValid={false}
          className="max-w-3xl"
        >
          {!isPending && (
            <div className="relative">
              <ItemWithEffects
                hideImage
                item={asset}
                key={asset.id}
                onDelete={(id: string) => {
                  if (userData && canChangeContent(userData.role)) handleDelete(id);
                }}
                showEdit="asset"
              />
            </div>
          )}
          {isPending && <Loader explanation="Processing" />}
        </Modal>
      )}
    </ContentBox>
  );
}
