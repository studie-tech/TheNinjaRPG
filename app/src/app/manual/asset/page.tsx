"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Modal2 from "@/layout/Modal2";
import { Button } from "@/components/ui/button";
import { api } from "@/app/_trpc/client";
import { FilePlus, Folder as FolderIcon } from "lucide-react";
import { ActionSelector } from "@/layout/CombatActions";
import { useInfinitePagination } from "@/libs/pagination";
import { useUserData } from "@/utils/UserContext";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import GameAssetFiltering, {
  useFiltering,
  getFilter,
} from "@/layout/GameAssetFiltering";
import type { GameAsset } from "@/drizzle/schema";
import NavTabs from "@/layout/NavTabs";

export default function ManualAssets() {
  // Router and filtering
  const { data: userData } = useUserData();
  const router = useRouter();
  const state = useFiltering();
  const [activeTab, setActiveTab] = useState<"assets" | "animation">("assets");

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
        <div className="flex flex-row gap-2 items-center">
          <NavTabs
            id="manual-asset-tabs"
            current={activeTab}
            options={["assets", "animation"]}
            fontSize="text-sm"
            onChange={(v) => setActiveTab(v as "assets" | "animation")}
          />
          {userData && canChangeContent(userData.role) && (
            <Button id="create-bloodline" onClick={() => create()}>
              <FilePlus className="sm:mr-2 h-5 w-5" />
              New
            </Button>
          )}
          <GameAssetFiltering state={state} />
        </div>
      }
    >
      {activeTab === "assets" ? <AssetsContent state={state} /> : <AnimationsContent />}
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
  const { data: folders } = api.gameAsset.getAllFolders.useQuery();
  const folderCounts = new Map(
    (folders || []).map((f: { folder: string; count: number }) => [f.folder, f.count]),
  );
  const allAssets = assets?.pages.map((page) => page.data).flat();
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
          <div
            className="flex flex-col items-center justify-start w-full cursor-pointer"
            onClick={() => router.push(`/manual/asset/${encodeURIComponent(item.id)}`)}
          >
            <div className="relative w-full aspect-square rounded-xl border bg-slate-100 flex items-center justify-center">
              <FolderIcon className="h-1/3 w-1/3 text-slate-700" />
              {folderCounts.get(item.id) !== undefined && (
                <div className="absolute -bottom-2 -right-2 flex h-7 w-7 flex-row items-center justify-center rounded-full border-2 border-amber-300 bg-slate-300 text-black text-base font-bold">
                  {folderCounts.get(item.id)}
                </div>
              )}
            </div>
            <div className="mt-1 text-center truncate w-full" title={item.name}>
              {item.name}
            </div>
          </div>
        )}
      />
      <div className="mt-4" />
      <ActionSelector
        items={assetsWithoutFolder?.map((a) => ({ ...a, type: "asset" as const }))}
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
        emptyText="No assets exist yet."
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

  const { data: tagResp, isFetching: loadingTags } =
    api.gameAsset.getAnimationNameTags.useQuery({ selected: selectedTags });

  const { data: assets } = api.gameAsset.getAll.useInfiniteQuery(
    { limit: 50, type: "ANIMATION", nameTokens: selectedTags },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );

  const allAnimations = assets?.pages.map((p) => p.data).flat();

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
            key={t}
            className={
              "px-2 py-1 rounded border text-xs " +
              (selectedTags.includes(t)
                ? "bg-foreground text-background border-foreground"
                : "bg-background border-muted-foreground/30")
            }
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
