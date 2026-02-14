"use client";

import { FilePlus, Folder as FolderIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { GameAsset } from "@/drizzle/schema";
import { ActionSelector } from "@/layout/CombatActions";
import ContentBox from "@/layout/ContentBox";
import GameAssetFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/GameAssetFiltering";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
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

  // Create mutation (for New button)
  const { mutate: create } = api.gameAsset.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      router.push(`/manual/asset/edit/${data.message}`);
    },
  });

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
            <Button id="create-bloodline" onClick={() => create()}>
              <FilePlus className="h-5 w-5" />
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
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  const {
    data: assets,
    isFetching,
    fetchNextPage,
    hasNextPage,
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
    },
  });

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
        onClick={(id) => {
          setAsset(assetsWithoutFolder?.find((a) => a.id === id));
          setIsOpen(true);
        }}
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
      />
      {isPending && <Loader explanation="Loading data" />}
      {isOpen && userData && asset && (
        <Modal2
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
                  remove({ id });
                  setIsOpen(false);
                }}
                showEdit="asset"
              />
            </div>
          )}
          {isPending && <Loader explanation={`Processing ${asset.name}`} />}
        </Modal2>
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
