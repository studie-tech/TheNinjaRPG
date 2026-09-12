"use client";

import { FilePlus, Folder as FolderIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { GameAsset } from "@/drizzle/schema";
import { ActionOption, ActionSelector } from "@/layout/CombatActions";
import ContentBox from "@/layout/ContentBox";
import GameAssetFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/GameAssetFiltering";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import NavTabs from "@/layout/NavTabs";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ManualAssets() {
  // Router and filtering
  const { data: userData } = useUserData();
  const router = useRouter();
  const state = useFiltering();
  const [activeTab, setActiveTab] = useState<"assets" | "animation" | "SFX">("assets");
  const createInFlightRef = useRef(false);

  // Create mutation (for New button)
  const { mutate: create, isPending: isCreating } = api.gameAsset.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      router.push(`/manual/asset/edit/${data.message}`);
    },
    onSettled: () => {
      createInFlightRef.current = false;
    },
  });

  const handleCreate = () => {
    // isPending updates after React renders; the ref closes the same-tick double-click gap.
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;
    create();
  };

  // Return JSX
  return (
    <ContentBox
      title="Database"
      subtitle="All assets"
      defaultBackHref="/manual"
      topRightContent={
        <div className="flex flex-row items-center gap-2">
          <NavTabs
            id="manual-asset-tabs"
            current={activeTab}
            options={["assets", "animation", "SFX"]}
            fontSize="text-sm"
            onChange={(v) => setActiveTab(v as "assets" | "animation" | "SFX")}
          />
          {userData && canChangeContent(userData.role) && (
            <Button
              id="create-bloodline"
              onClick={handleCreate}
              disabled={isCreating}
              loading={isCreating}
              aria-busy={isCreating}
              aria-label={isCreating ? "Creating asset" : "Create asset"}
            >
              {!isCreating && <FilePlus className="h-5 w-5" />}
              {isCreating && <span aria-live="polite">Creating</span>}
            </Button>
          )}
          <GameAssetFiltering state={state} />
        </div>
      }
    >
      {activeTab === "assets" ? (
        <AssetsContent state={state} />
      ) : activeTab === "animation" ? (
        <AnimationsContent />
      ) : (
        <SfxContent />
      )}
    </ContentBox>
  );
}

const AssetsContent: React.FC<{ state: ReturnType<typeof useFiltering> }> = (props) => {
  const { data: userData } = useUserData();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [asset, setAsset] = useState<GameAsset | undefined>(undefined);
  const [deletingAssetIds, setDeletingAssetIds] = useState<string[]>([]);
  const deletingAssetIdsRef = useRef(new Set<string>());
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  const {
    data: assets,
    isFetching,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = api.gameAsset.getAll.useInfiniteQuery(
    { limit: 60, ...getFilter(props.state) },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  // Derive folders and folderCounts from assets
  const allAssets = assets?.pages.flatMap((page) => page.data) ?? [];
  const folderCounts = allAssets.reduce((acc, asset) => {
    if (asset.folder && asset.folder !== "") {
      acc.set(asset.folder, (acc.get(asset.folder) ?? 0) + 1);
    }
    return acc;
  }, new Map<string, number>());
  const folders = Array.from(folderCounts.keys()).map((folder) => ({
    folder,
    count: folderCounts.get(folder) ?? 0,
  }));
  const assetsWithoutFolder = allAssets?.filter((a) => !a.folder || a.folder === "");
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
    setAsset(assetsWithoutFolder?.find((currentAsset) => currentAsset.id === id));
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
    <>
      <ActionSelector
        items={
          folders?.map((f) => ({
            id: f.folder,
            name: f.folder,
            image: "",
            type: "asset" as const,
          })) || []
        }
        labelSingles={true}
        onClick={(id) => {
          router.push(`/manual/asset/${encodeURIComponent(id)}`);
        }}
        showBgColor={false}
        roundFull={true}
        hideBorder={true}
        showLabels={true}
        gridClassNameOverwrite="grid grid-cols-3 md:grid-cols-4 gap-4"
        emptyText="No folders yet."
        aspectRatioClass=""
        renderItem={(item) => (
          <button
            type="button"
            className="flex w-full cursor-pointer flex-col items-center justify-start"
            onClick={() => router.push(`/manual/asset/${encodeURIComponent(item.id)}`)}
          >
            <div className="relative flex aspect-square w-full items-center justify-center rounded-xl border bg-slate-100">
              <FolderIcon className="h-1/3 w-1/3 text-slate-700" />
              {folderCounts.get(item.id) !== undefined && (
                <div className="absolute -right-2 -bottom-2 flex h-7 w-7 flex-row items-center justify-center rounded-full border-2 border-amber-300 bg-slate-300 font-bold text-black">
                  {folderCounts.get(item.id)}
                </div>
              )}
            </div>
            <div className="mt-1 w-full truncate text-center" title={item.name}>
              {item.name}
            </div>
          </button>
        )}
      />
      <div className="mt-4" />
      <ActionSelector
        items={assetsWithoutFolder?.map((a) => ({
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
        emptyText=" "
        aspectRatioClass={
          props.state.type === "SCENE_BACKGROUND"
            ? "aspect-3/2"
            : props.state.type === "SCENE_CHARACTER"
              ? "aspect-2/3"
              : ""
        }
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
                  handleDelete(id);
                }}
                showEdit="asset"
              />
            </div>
          )}
          {isPending && <Loader explanation="Processing" />}
        </Modal>
      )}
    </>
  );
};

const AnimationsContent: React.FC = () => {
  const router = useRouter();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const { data: tagResp, isFetching: loadingTags } = api.gameAsset.getNameTags.useQuery(
    {
      type: "ANIMATION",
      selected: selectedTags,
    },
  );

  const { data: assets } = api.gameAsset.getAll.useInfiniteQuery(
    { limit: 50, type: "ANIMATION", nameTokens: selectedTags },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );

  const allAnimations = assets?.pages.flatMap((p) => p.data);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {loadingTags && <span className="text-sm opacity-70">Loading tags…</span>}
        {tagResp?.tags?.map((t) => (
          <button
            type="button"
            key={t}
            className={`rounded border px-2 py-1 text-xs ${selectedTags.includes(t) ? "border-foreground bg-foreground text-background" : "border-muted-foreground/30 bg-background"}`}
            onClick={() => toggleTag(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <ActionSelector
        items={allAnimations?.map((a) => ({ ...a, type: "asset" as const }))}
        labelSingles={true}
        onClick={(id) => {
          router.push(`/manual/asset/edit/${encodeURIComponent(id)}`);
        }}
        showBgColor={false}
        roundFull={true}
        hideBorder={true}
        showLabels={true}
        gridClassNameOverwrite="grid grid-cols-3 md:grid-cols-4"
        emptyText="No animations match the selected tags."
      />
    </div>
  );
};

const SfxContent: React.FC = () => {
  const router = useRouter();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const { data: tagResp, isFetching: loadingTags } = api.gameAsset.getNameTags.useQuery(
    { type: "SFX", selected: selectedTags },
  );

  const { data: assets } = api.gameAsset.getAll.useInfiniteQuery(
    { limit: 50, type: "SFX", nameTokens: selectedTags },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );

  const allSfx = assets?.pages.flatMap((p) => p.data);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {loadingTags && <span className="text-sm opacity-70">Loading tags…</span>}
        {tagResp?.tags?.map((t) => (
          <button
            type="button"
            key={t}
            className={`rounded border px-2 py-1 text-xs ${selectedTags.includes(t) ? "border-foreground bg-foreground text-background" : "border-muted-foreground/30 bg-background"}`}
            onClick={() => toggleTag(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <ActionSelector
        items={allSfx?.map((a) => ({
          ...a,
          type: "asset" as const,
          assetType: a.type,
          url: a.url,
        }))}
        labelSingles={true}
        onClick={(id) => {
          router.push(`/manual/asset/edit/${encodeURIComponent(id)}`);
        }}
        showBgColor={false}
        roundFull={true}
        hideBorder={true}
        showLabels={true}
        gridClassNameOverwrite="grid grid-cols-3 md:grid-cols-4"
        emptyText="No SFX match the selected tags."
      />
    </div>
  );
};
