"use client";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  EyeOff,
  Folder,
  FolderOpen,
  LayoutGrid,
  List,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type GameAssetType, GameAssetTypes } from "@/drizzle/constants";
import type { GameAsset } from "@/drizzle/schema";
import { useLpcCatalogInvalidation } from "@/hooks/lpc";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import { EpidemicSfxSearch } from "@/layout/EpidemicSfxSearch";
import {
  AssetPreviewBackgroundControls,
  GameAssetPreview,
} from "@/layout/GameAssetPreview";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { assetSortOptions, assetTypeLabels } from "@/libs/assetLibrary";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent, canSuggestContent } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";
import { gameAssetValidator } from "@/validators/asset";

/** Search and browse assets with URL-backed filters and permission-gated editing. */
export function GameAssetLibrary() {
  const params = useSearchParams();
  const router = useRouter();
  const utils = api.useUtils();
  const invalidateLpcCatalog = useLpcCatalogInvalidation();
  const { data: user } = useUserDataSelector((u) => ({ role: u.role }));
  const canEdit = !!user && canChangeContent(user.role);
  const canSuggest = canSuggestContent(user?.role);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const name = useDebouncedValue(search.trim(), 300);
  const [type, setType] = useState<GameAssetType | "ALL">(() => {
    const value = params.get("type");
    return GameAssetTypes.find((type) => type === value) ?? "ALL";
  });
  // Undefined searches every folder; an empty string selects Unfiled exactly.
  const [folder, setFolder] = useState<string | undefined>(
    params.get("folder") ?? undefined,
  );
  const [sort, setSort] = useState<AssetSort>(
    () =>
      assetSortOptions.find((option) => option.value === params.get("sort"))?.value ??
      "newest",
  );
  const [view, setView] = useState(params.get("view") === "list" ? "list" : "grid");
  const [keywords, setKeywords] = useState<string[]>(params.getAll("tag"));
  const [showKeywords, setShowKeywords] = useState(false);
  const [keywordSearch, setKeywordSearch] = useState("");
  const hasKeywords = type === "ANIMATION" || type === "SFX";
  const [showFolders, setShowFolders] = useState(false);
  const [folderSearch, setFolderSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<GameAsset | null>(null);
  const [playingAssetId, setPlayingAssetId] = useState<string | null>(null);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [previewError, setPreviewError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activePreview = useRef<{ id: string; isAudio: boolean } | null>(null);
  const audioAssetId = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const keywordSearchRef = useRef<HTMLInputElement | null>(null);
  const selectedTrigger = useRef<HTMLElement | null>(null);
  const createTrigger = useRef<HTMLButtonElement | null>(null);

  /** Stop the active overview preview and invalidate any pending play promise. */
  const stopPreview = useCallback(() => {
    activePreview.current = null;
    audioRef.current?.pause();
    setPlayingAssetId(null);
    setIsAudioLoading(false);
  }, []);

  /** Report a media failure only while its playback request is still current. */
  const failAudioPreview = (preview: typeof activePreview.current) => {
    if (!preview?.isAudio || activePreview.current !== preview) return;
    stopPreview();
    audioAssetId.current = null;
    setPreviewError({
      id: preview.id,
      message: "Audio could not be played. Try again or open its details.",
    });
  };

  /** Start audio during the click gesture; animations share the same active-card state. */
  const togglePreview = async (asset: GameAsset) => {
    if (activePreview.current?.id === asset.id) {
      stopPreview();
      return;
    }
    stopPreview();
    setPreviewError(null);
    const preview = {
      id: asset.id,
      isAudio: asset.type === "SFX" || asset.type === "MUSIC",
    };
    activePreview.current = preview;
    setPlayingAssetId(asset.id);
    if (!preview.isAudio) return;

    const audio = audioRef.current;
    if (!audio) {
      stopPreview();
      return;
    }
    // Resume a paused asset, but restart when choosing another asset or source.
    if (audioAssetId.current !== asset.id || audio.getAttribute("src") !== asset.url) {
      audio.src = asset.url;
      audioAssetId.current = asset.id;
    }
    setIsAudioLoading(true);
    try {
      await audio.play();
      if (activePreview.current === preview) setIsAudioLoading(false);
    } catch {
      failAudioPreview(preview);
    }
  };

  const listing = api.gameAsset.getAll.useInfiniteQuery(
    {
      limit: 48,
      name: name || undefined,
      type: type === "ALL" ? undefined : type,
      includeAnimations: true,
      exactFolder: folder,
      sort,
      nameTokens: hasKeywords && keywords.length ? keywords : undefined,
    },
    { getNextPageParam: (page) => page.nextCursor },
  );
  const folders = api.gameAsset.getAllFolders.useQuery({
    type: type === "ALL" ? undefined : type,
  });
  const nameTags = api.gameAsset.getNameTags.useQuery(
    { type: type === "ALL" ? undefined : type, selected: keywords },
    { enabled: hasKeywords && showKeywords },
  );
  const suggestedKeywords = (nameTags.data?.tags ?? []).filter(
    (tag) =>
      !keywords.includes(tag) &&
      tag.toLowerCase().includes(keywordSearch.toLowerCase()),
  );
  const assets = listing.data?.pages.flatMap((page) => page.data) ?? [];
  const folderMatches = (folders.data ?? []).filter((entry) =>
    entry.folder.toLowerCase().includes(folderSearch.toLowerCase()),
  );
  const visibleFolders = showFolders ? folderMatches : folderMatches.slice(0, 3);
  const hasFilters =
    !!search || type !== "ALL" || folder !== undefined || keywords.length > 0;
  const isAudio = type === "SFX" || type === "MUSIC";
  const returnParams = new URLSearchParams();
  if (search) returnParams.set("q", search);
  if (type !== "ALL") returnParams.set("type", type);
  if (folder !== undefined) returnParams.set("folder", folder);
  if (sort !== "newest") returnParams.set("sort", sort);
  if (view === "list") returnParams.set("view", view);
  if (hasKeywords) for (const tag of keywords) returnParams.append("tag", tag);
  const returnTo = `/manual/asset${returnParams.size ? `?${returnParams}` : ""}`;

  // One lazy audio element avoids loading every sound in the gallery. Release it when
  // navigating/filtering so playback and pending requests cannot outlive the overview.
  useEffect(() => {
    const audio = audioRef.current;
    stopPreview();
    setPreviewError(null);
    return () => {
      activePreview.current = null;
      audioAssetId.current = null;
      audio?.pause();
      audio?.removeAttribute("src");
      audio?.load();
    };
  }, [returnTo, stopPreview]);

  // Save filters without adding history entries, preserving the library's Back target.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.search = returnParams.toString();
    window.history.replaceState(null, "", url);
  }, [search, type, folder, sort, view, keywords]);

  const clearFilters = () => {
    setSearch("");
    setType("ALL");
    setFolder(undefined);
    setKeywords([]);
  };
  const selectType = (value: GameAssetType | "ALL") => {
    setType(value);
    setKeywords([]);
    setKeywordSearch("");
  };
  /** Refresh discovery lists and picker labels after library creation or deletion. */
  const refreshLibrary = async () => {
    await Promise.all([
      utils.gameAsset.getAll.invalidate(),
      utils.gameAsset.getAllFolders.invalidate(),
      invalidateLpcCatalog(),
      utils.gameAsset.getAllNames.invalidate(),
      utils.misc.getAllGameAssetNames.invalidate(),
      utils.gameAsset.getNameTags.invalidate(),
    ]);
  };
  const editHref = (id: string) =>
    `/manual/asset/edit/${encodeURIComponent(id)}?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <ContentBox
      title="Asset library"
      subtitle="Artwork, animation and audio for the world of TheNinja-RPG"
      defaultBackHref="/manual"
      noBorder
      padding={false}
      topRightContent={
        canEdit ? (
          <Button
            ref={createTrigger}
            id="create-asset"
            className="gap-2"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="size-4" />
            New asset
          </Button>
        ) : undefined
      }
    >
      {/* biome-ignore lint/a11y/useMediaCaption: game music and sound effects have no caption track */}
      <audio
        ref={audioRef}
        preload="none"
        hidden
        onEnded={() => {
          if (audioRef.current?.ended && activePreview.current?.isAudio) stopPreview();
        }}
        onPause={() => {
          if (audioRef.current?.paused && activePreview.current?.isAudio) stopPreview();
        }}
        onError={() => {
          if (audioRef.current?.error) failAudioPreview(activePreview.current);
        }}
      />
      <div className="border-border bg-background/70 mt-3 overflow-hidden rounded-xl border">
        <div className="border-border space-y-4 border-b p-4 sm:p-5">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-3.5 left-3.5 size-5" />
            <Input
              ref={searchRef}
              aria-label="Search assets"
              type="search"
              placeholder="Search assets by name…"
              className="h-12 rounded-lg pr-10 pl-11 text-base shadow-none"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-1.5 right-1.5"
                aria-label="Clear search"
                onClick={() => setSearch("")}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
          <fieldset className="flex flex-wrap gap-1.5" aria-label="Asset type">
            <TypeFilter
              label="All assets"
              active={type === "ALL"}
              onClick={() => selectType("ALL")}
            />
            {GameAssetTypes.map((value) => (
              <TypeFilter
                key={value}
                label={assetTypeLabels[value]}
                active={type === value}
                onClick={() => selectType(value)}
              />
            ))}
          </fieldset>
          {hasKeywords && (
            <div className="space-y-2">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                aria-expanded={showKeywords}
                onClick={() => setShowKeywords(!showKeywords)}
              >
                <SlidersHorizontal className="size-3.5" />
                Refine by keyword
                <ChevronDown className={cn("size-3", showKeywords && "rotate-180")} />
              </Button>
              {showKeywords && (
                <div className="border-border space-y-2 rounded-lg border p-3">
                  <p className="text-muted-foreground text-xs">
                    Combine keywords from asset names to narrow your search.
                  </p>
                  <Input
                    ref={keywordSearchRef}
                    aria-label="Find an asset keyword"
                    placeholder="Find a keyword…"
                    value={keywordSearch}
                    onChange={(event) => setKeywordSearch(event.target.value)}
                  />
                  {nameTags.isFetching && (
                    <p role="status" className="text-muted-foreground text-xs">
                      Loading keywords…
                    </p>
                  )}
                  {nameTags.isError && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void nameTags.refetch()}
                    >
                      Retry keywords
                    </Button>
                  )}
                  <div className="flex max-h-32 flex-wrap gap-1.5 overflow-auto">
                    {suggestedKeywords.map((tag) => (
                      <Button
                        variant="outline"
                        size="sm"
                        key={tag}
                        onClick={(event) => {
                          setKeywords([...keywords, tag]);
                          // Selection removes this button; keep keyboard focus in refinement.
                          if (event.detail === 0) keywordSearchRef.current?.focus();
                        }}
                      >
                        {tag}
                      </Button>
                    ))}
                  </div>
                  {!nameTags.isFetching &&
                    !nameTags.isError &&
                    !suggestedKeywords.length && (
                      <p className="text-muted-foreground text-xs">
                        No more matching keywords. Remove a filter to broaden your
                        search.
                      </p>
                    )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-border bg-muted/25 space-y-3 border-b p-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Folder className="text-primary size-4" />
              Folders{" "}
              <span className="text-muted-foreground font-normal">
                {folders.data?.length ?? ""}
              </span>
            </h3>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className={cn("gap-1.5", folder === "" && "bg-accent")}
                aria-pressed={folder === ""}
                onClick={() => setFolder(folder === "" ? undefined : "")}
              >
                Unfiled
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                aria-expanded={showFolders}
                onClick={() => setShowFolders(!showFolders)}
              >
                {showFolders
                  ? "Show fewer"
                  : `Browse all ${folders.data?.length ?? ""}`}
                <ChevronDown className={cn("size-3.5", showFolders && "rotate-180")} />
              </Button>
            </div>
          </div>
          {showFolders && (
            <Input
              aria-label="Find a folder"
              placeholder="Find a folder…"
              value={folderSearch}
              onChange={(event) => setFolderSearch(event.target.value)}
            />
          )}
          {folders.isPending && (
            <p className="text-muted-foreground text-sm" role="status">
              Loading folders…
            </p>
          )}
          {folders.isError && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <p>Folders could not be loaded.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void folders.refetch()}
              >
                Retry folders
              </Button>
            </div>
          )}
          <div
            className={cn(
              "grid grid-cols-2 gap-2 sm:grid-cols-3",
              showFolders && "max-h-64 overflow-y-auto p-0.5",
            )}
          >
            {visibleFolders.map((entry) => (
              <button
                type="button"
                key={entry.folder}
                aria-pressed={folder === entry.folder}
                title={entry.folder}
                className={cn(
                  "border-border bg-background hover:border-primary/50 hover:bg-accent focus-visible:outline-ring flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-2",
                  folder === entry.folder && "border-primary bg-accent",
                )}
                onClick={() =>
                  setFolder(folder === entry.folder ? undefined : entry.folder)
                }
              >
                {folder === entry.folder ? (
                  <FolderOpen className="text-primary size-5 shrink-0" />
                ) : (
                  <Folder className="text-primary/70 size-5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">
                  {entry.folder}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {entry.count}
                </span>
              </button>
            ))}
          </div>
          {!folders.isPending && !folders.isError && visibleFolders.length === 0 && (
            <p className="text-muted-foreground text-sm">
              {folderSearch
                ? "No folders match this name."
                : "Assets can be organized into folders in the editor."}
            </p>
          )}
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {folder !== undefined && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="View all folders"
                  onClick={() => setFolder(undefined)}
                >
                  <ArrowLeft className="size-4" />
                </Button>
              )}
              <h3 className="min-w-0 truncate font-semibold">
                {folder === ""
                  ? "Unfiled assets"
                  : (folder ?? (type === "ALL" ? "All assets" : assetTypeLabels[type]))}
              </h3>
              <span className="bg-muted text-muted-foreground shrink-0 rounded-md px-2 py-0.5 text-xs tabular-nums">
                {assets.length}
                {listing.hasNextPage ? "+" : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-muted-foreground flex items-center gap-1.5">
                <SlidersHorizontal className="size-3.5" />
                <span className="sr-only">Sort assets</span>
                <select
                  aria-label="Sort assets"
                  className="border-input bg-background text-foreground focus-visible:outline-ring h-9 max-w-36 rounded-md border px-2 text-xs focus-visible:outline-2"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as AssetSort)}
                >
                  {assetSortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset
                className="border-border flex rounded-md border p-0.5"
                aria-label="Display assets"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-8",
                    view === "grid" && "bg-accent text-accent-foreground",
                  )}
                  aria-label="Grid view"
                  aria-pressed={view === "grid"}
                  onClick={() => setView("grid")}
                >
                  <LayoutGrid className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-8",
                    view === "list" && "bg-accent text-accent-foreground",
                  )}
                  aria-label="List view"
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                >
                  <List className="size-4" />
                </Button>
              </fieldset>
            </div>
          </div>
          {hasFilters && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {search && (
                <FilterChip label={`Search: ${search}`} onClear={() => setSearch("")} />
              )}
              {type !== "ALL" && (
                <FilterChip
                  label={assetTypeLabels[type]}
                  onClear={() => selectType("ALL")}
                />
              )}
              {hasKeywords &&
                keywords.map((tag) => (
                  <FilterChip
                    key={tag}
                    label={`Keyword: ${tag}`}
                    onClear={() =>
                      setKeywords(keywords.filter((value) => value !== tag))
                    }
                  />
                ))}
              {folder !== undefined && (
                <FilterChip
                  label={`Folder: ${folder || "Unfiled"}`}
                  onClear={() => setFolder(undefined)}
                />
              )}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground min-h-8 underline underline-offset-4"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            </div>
          )}
          {isAudio && canEdit && (
            <div className="border-border bg-muted/20 rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>Need a new sound effect?</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowImport(!showImport)}
                  aria-expanded={showImport}
                >
                  {showImport ? "Hide sound search" : "Find & import sounds"}
                </Button>
              </div>
              {showImport && (
                <EpidemicSfxSearch onImported={(id) => router.push(editHref(id))} />
              )}
            </div>
          )}

          {listing.isPending && <Loader explanation="Loading assets" />}
          {listing.isError && (
            <div role="alert" className="border-destructive/30 rounded-lg border p-4">
              <p className="font-medium">
                Could not load{" "}
                {listing.isFetchNextPageError ? "more assets" : "the asset library"}.
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                Your filters are saved. Try loading the assets again.
              </p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() =>
                  void (listing.isFetchNextPageError
                    ? listing.fetchNextPage()
                    : listing.refetch())
                }
              >
                Try again
              </Button>
            </div>
          )}
          {!listing.isPending && !listing.isError && assets.length === 0 && (
            <div className="border-border flex flex-col items-center rounded-lg border border-dashed px-5 py-12 text-center">
              <Search className="text-muted-foreground mb-3 size-8" />
              <h4 className="font-semibold">
                {hasFilters
                  ? "No matching assets"
                  : canEdit
                    ? "Your library starts here"
                    : "The library is empty"}
              </h4>
              <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                {hasFilters
                  ? "Try a different name, asset type or folder. Search looks inside every folder unless you select one."
                  : canEdit
                    ? "Create an asset to upload or generate artwork, animation or audio."
                    : "Assets will appear here after content staff add them."}
              </p>
              {(hasFilters || canEdit) && (
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={hasFilters ? clearFilters : () => setShowCreate(true)}
                >
                  {hasFilters ? "Clear filters" : "New asset"}
                </Button>
              )}
            </div>
          )}
          <div
            aria-busy={listing.isFetching || search.trim() !== name}
            className={
              view === "grid"
                ? "grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
                : "divide-border border-border divide-y rounded-lg border"
            }
          >
            {assets.map((asset) => (
              <AssetTile
                key={asset.id}
                asset={asset}
                view={view}
                playing={playingAssetId === asset.id}
                loading={playingAssetId === asset.id && isAudioLoading}
                error={previewError?.id === asset.id ? previewError.message : undefined}
                onToggle={() => void togglePreview(asset)}
                onOpen={(event) => {
                  stopPreview();
                  selectedTrigger.current = event.currentTarget;
                  setSelected(asset);
                }}
              />
            ))}
          </div>
          {assets.length > 0 && (
            <div
              className="text-muted-foreground flex flex-col items-center gap-2 pt-2 text-xs"
              aria-live="polite"
            >
              <p>
                {assets.length} asset{assets.length === 1 ? "" : "s"} loaded
                {listing.hasNextPage ? ". More available." : ". You’re all caught up."}
              </p>
              {listing.hasNextPage && (
                <Button
                  variant="outline"
                  className="min-w-40"
                  disabled={listing.isFetching}
                  loading={listing.isFetchingNextPage}
                  onClick={() => void listing.fetchNextPage()}
                >
                  {listing.isFetchingNextPage ? "Loading assets…" : "Load more assets"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      {showCreate && (
        <CreateAssetDialog
          folder={folder}
          type={type}
          returnTo={returnTo}
          isOpen={showCreate}
          setIsOpen={setShowCreate}
          returnFocusRef={createTrigger}
          onCreated={refreshLibrary}
        />
      )}
      {selected && (
        <AssetDetails
          key={selected.id}
          asset={selected}
          isOpen={!!selected}
          setIsOpen={(open) => {
            if (!open) setSelected(null);
          }}
          returnFocusRef={selectedTrigger}
          canEdit={canEdit}
          canSuggest={canSuggest}
          editHref={editHref(selected.id)}
          onDeleted={async () => {
            // The deleted tile unmounts, so restore dialog focus to a surviving control.
            selectedTrigger.current = createTrigger.current ?? searchRef.current;
            setSelected(null);
            await refreshLibrary();
          }}
          onFolder={(value) => {
            selectedTrigger.current = searchRef.current;
            setSelected(null);
            setFolder(value);
          }}
        />
      )}
    </ContentBox>
  );
}

/** Select a media type while exposing its pressed state to assistive technology. */
function TypeFilter({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "focus-visible:outline-ring min-h-9 rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted/60 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {label}
    </button>
  );
}

/** Remove one active filter without clearing the remaining library context. */
function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      className="border-border bg-muted/40 hover:bg-accent focus-visible:outline-ring flex min-h-8 max-w-full items-center gap-2 rounded-full border px-3 focus-visible:outline-2"
      aria-label={`Remove ${label} filter`}
      onClick={onClear}
    >
      <span className="truncate">{label}</span>
      <X className="size-3 shrink-0" />
    </button>
  );
}

/** Keep detail navigation and in-place playback as separate keyboard-accessible buttons. */
function AssetTile({
  asset,
  view,
  playing,
  loading,
  error,
  onToggle,
  onOpen,
}: {
  asset: GameAsset;
  view: string;
  playing: boolean;
  loading: boolean;
  error?: string;
  onToggle: () => void;
  onOpen: React.MouseEventHandler<HTMLButtonElement>;
}) {
  const isAudio = asset.type === "SFX" || asset.type === "MUSIC";
  const canPlay = isAudio || asset.type === "ANIMATION";
  const playbackButton = canPlay ? (
    <Button
      type="button"
      variant="secondary"
      aria-label={`${playing ? "Pause" : "Play"} ${asset.name}`}
      aria-pressed={playing}
      aria-busy={loading}
      title={`${playing ? "Pause" : "Play"} preview`}
      onClick={onToggle}
      className={cn(
        "bg-background/90 text-foreground hover:bg-background relative z-20 size-[44px] shrink-0 rounded-full p-0 shadow-sm",
        // Keep the gallery control compact while retaining a 44px hit area.
        view === "grid" &&
          "absolute right-[8px] bottom-[8px] size-[28px] after:absolute after:-inset-[8px]",
      )}
    >
      {loading ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : playing ? (
        <Pause className="size-4" />
      ) : (
        <Play className="size-4" />
      )}
    </Button>
  ) : null;
  return (
    <div data-asset-id={asset.id} className="min-w-0">
      <div
        className={cn(
          "group relative isolate min-w-0 overflow-hidden text-left transition-colors",
          view === "grid"
            ? "border-border bg-background hover:border-primary/60 rounded-lg border"
            : "hover:bg-accent/50 flex w-full items-center gap-3 p-3",
        )}
      >
        {/* A stretched detail button leaves the playback button as a sibling, not nested. */}
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Preview ${asset.name}`}
          className="focus-visible:ring-ring absolute inset-0 z-10 cursor-pointer rounded-[inherit] focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
        />
        <div
          className={cn(
            "relative shrink-0",
            view === "list" && "w-16 overflow-hidden rounded-md",
          )}
        >
          <GameAssetPreview
            asset={asset}
            play={playing}
            renditionWidth={view === "list" ? 128 : 320}
            className={view === "list" ? "aspect-square" : undefined}
          />
          {view === "grid" && playbackButton}
        </div>
        <div className={cn("min-w-0 flex-1", view === "grid" && "px-3 py-2.5")}>
          <p
            className="group-hover:text-primary truncate text-sm font-semibold"
            title={asset.name}
          >
            {asset.name}
          </p>
          <p className="text-muted-foreground mt-1 truncate text-xs">
            {assetTypeLabels[asset.type]}
          </p>
          <p className="text-muted-foreground mt-1 flex items-center gap-1 truncate text-xs">
            <Folder className="size-3 shrink-0" />
            <span className="truncate">{asset.folder || "Unfiled"}</span>
          </p>
        </div>
        {view === "list" && playbackButton}
        {view === "list" && !canPlay && (
          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive px-2 py-1 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

/** Preview media and metadata, with parent-owned navigation and post-delete refresh. */
function AssetDetails({
  asset,
  isOpen,
  setIsOpen,
  returnFocusRef,
  canEdit,
  canSuggest,
  editHref,
  onDeleted,
  onFolder,
}: {
  asset: GameAsset;
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  canEdit: boolean;
  canSuggest: boolean;
  editHref: string;
  onDeleted: () => Promise<void>;
  onFolder: (folder: string) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [background, setBackground] = useState<"light" | "dark" | "checkerboard">(
    asset.type === "ANIMATION" ? "dark" : "light",
  );
  const [copied, setCopied] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  // Block repeated confirmation events before React exposes the pending mutation.
  const deleteInFlight = useRef(false);
  const isAudio = asset.type === "SFX" || asset.type === "MUSIC";
  const remove = api.gameAsset.delete.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) await onDeleted();
      else setDeleteError(data.message);
    },
    onError: (error) => setDeleteError(error.message),
    onSettled: () => {
      deleteInFlight.current = false;
    },
  });
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      showMutationToast({
        success: false,
        message: "Could not copy. Select and copy the value below.",
      });
    }
  };
  return (
    <Modal
      title={asset.name}
      className="max-w-3xl [&_h2]:[overflow-wrap:anywhere]"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      returnFocusRef={returnFocusRef}
      footerExtra={
        canEdit || canSuggest ? (
          <Button asChild className="gap-2">
            <Link href={editHref}>
              <Pencil className="size-4" />
              {canEdit ? "Edit asset" : "Suggest a change"}
            </Link>
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <GameAssetPreview
            asset={asset}
            renditionWidth={768}
            play={playing}
            background={background}
            className="border-border min-h-48 rounded-lg border"
          />
          {!isAudio && (
            <AssetPreviewBackgroundControls
              value={background}
              onChange={setBackground}
            />
          )}
          {asset.type === "ANIMATION" && (
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => setPlaying(!playing)}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              {playing ? "Pause preview" : "Play animation"}
            </Button>
          )}
          {isAudio && (
            <>
              {/* biome-ignore lint/a11y/useMediaCaption: game music and sound effects contain no caption track */}
              <audio
                aria-label={`Listen to ${asset.name}`}
                controls
                preload="none"
                src={asset.url}
                className="w-full"
                onError={() => setMediaError(true)}
              />
              {mediaError && (
                <p role="alert" className="text-destructive text-sm">
                  Audio could not be loaded. Open the original file or update its URL in
                  the editor.
                </p>
              )}
            </>
          )}
          <Button asChild variant="outline" className="w-full">
            <a
              href={isAudio ? asset.url : asset.image}
              target="_blank"
              rel="noreferrer"
            >
              Open original file
            </a>
          </Button>
        </div>
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="bg-secondary text-secondary-foreground rounded-md px-2 py-1 text-xs font-medium">
              {assetTypeLabels[asset.type]}
            </span>
            {asset.hidden && (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <EyeOff className="size-3" />
                Hidden in game
              </span>
            )}
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground text-xs">Folder</dt>
              <dd>
                <button
                  type="button"
                  className="text-primary mt-1 flex max-w-full items-center gap-1.5 hover:underline"
                  onClick={() => onFolder(asset.folder)}
                >
                  <FolderOpen className="size-4 shrink-0" />
                  <span className="truncate">{asset.folder || "Unfiled"}</span>
                </button>
              </dd>
            </div>
            {asset.type === "ANIMATION" && (
              <div>
                <dt className="text-muted-foreground text-xs">Animation</dt>
                <dd className="mt-1">
                  {asset.frames} frames / {asset.speed} ms per frame
                </dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground text-xs">License</dt>
              <dd className="mt-1 break-words whitespace-pre-wrap">
                {asset.licenseDetails || "No license recorded"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Added</dt>
              <dd className="mt-1">{new Date(asset.createdAt).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Asset ID</dt>
              <dd className="mt-1 text-xs break-all select-all">{asset.id}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">File URL</dt>
              <dd className="mt-1 max-h-20 overflow-auto text-xs break-all select-all">
                {isAudio ? asset.url : asset.image}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Copy ID", value: asset.id },
              { label: "Copy URL", value: isAudio ? asset.url : asset.image },
            ].map(({ label, value }) => (
              <Button
                key={label}
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => void copy(value, label)}
              >
                {copied === label ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
                {copied === label ? "Copied" : label}
              </Button>
            ))}
          </div>
          {canEdit && (
            <div className="border-border border-t pt-3">
              <Confirm
                title={`Delete ${asset.name}?`}
                button={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive gap-1.5"
                    disabled={remove.isPending}
                  >
                    <Trash2 className="size-3.5" />
                    Delete asset
                  </Button>
                }
                proceed_label="Delete asset"
                proceed_loading_label="Deleting asset…"
                isLoading={remove.isPending}
                keepOpenOnAccept
                confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onAccept={() => {
                  if (deleteInFlight.current) return;
                  deleteInFlight.current = true;
                  setDeleteError("");
                  remove.mutate({ id: asset.id });
                }}
              >
                <p>
                  This removes the asset from the library. Content using this asset may
                  lose its media. This cannot be undone.
                </p>
                {deleteError && (
                  <p role="alert" className="text-destructive mt-2 text-sm">
                    {deleteError}
                  </p>
                )}
              </Confirm>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Validate initial metadata, refresh discovery caches, then open the media editor. */
function CreateAssetDialog({
  folder,
  type,
  returnTo,
  isOpen,
  setIsOpen,
  returnFocusRef,
  onCreated,
}: {
  folder?: string;
  type: GameAssetType | "ALL";
  returnTo: string;
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onCreated: () => Promise<void>;
}) {
  const router = useRouter();
  const { data: allFolders } = api.gameAsset.getAllFolders.useQuery();
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState<GameAssetType>(
    type === "ALL" ? "STATIC" : type,
  );
  const isSelectedFolderValid =
    gameAssetValidator.shape.folder.safeParse(folder).success;
  const [assetFolder, setAssetFolder] = useState(
    isSelectedFolderValid ? (folder ?? "") : "",
  );
  const [error, setError] = useState("");
  // Enter and the confirmation button can submit before pending state re-renders.
  const createInFlight = useRef(false);
  const create = api.gameAsset.create.useMutation({
    onSuccess: async (data) => {
      if (!data.success) {
        setError(data.message);
        return;
      }
      await onCreated();
      router.push(
        `/manual/asset/edit/${encodeURIComponent(data.message)}?returnTo=${encodeURIComponent(returnTo)}`,
      );
      setIsOpen(false);
    },
    onError: (error) => setError(error.message),
    onSettled: () => {
      createInFlight.current = false;
    },
  });
  const handleCreate = () => {
    if (createInFlight.current) return;
    const data = { name: name.trim(), type: assetType, folder: assetFolder.trim() };
    const parsed = gameAssetValidator
      .pick({ name: true, type: true, folder: true })
      .safeParse(data);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the asset details.");
      return;
    }
    setError("");
    createInFlight.current = true;
    create.mutate(data);
  };
  return (
    <Modal
      title="New asset"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      returnFocusRef={returnFocusRef}
      isLoading={create.isPending}
      keepOpenOnAccept
      proceed_label="Create & add media"
      proceed_loading_label="Creating asset…"
      proceedDisabled={!name.trim()}
      onAccept={handleCreate}
    >
      <p className="text-muted-foreground mb-4 text-sm">
        Give your asset a home. Next, upload or generate its media and add license
        details.
      </p>
      <fieldset disabled={create.isPending} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="new-asset-name">Asset name</Label>
          <Input
            id="new-asset-name"
            value={name}
            maxLength={191}
            placeholder="e.g. Autumn forest backdrop"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-asset-type">Asset type</Label>
          <select
            id="new-asset-type"
            className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
            value={assetType}
            onChange={(event) => setAssetType(event.target.value as GameAssetType)}
          >
            {GameAssetTypes.map((type) => (
              <option value={type} key={type}>
                {assetTypeLabels[type]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-asset-folder">
            Folder <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="new-asset-folder"
            list="new-asset-folders"
            value={assetFolder}
            maxLength={191}
            placeholder="e.g. AutumnFestival"
            onChange={(event) => setAssetFolder(event.target.value)}
          />
          <datalist id="new-asset-folders">
            {(allFolders ?? [])
              .filter(
                ({ folder }) =>
                  gameAssetValidator.shape.folder.safeParse(folder).success,
              )
              .map(({ folder }) => (
                <option key={folder} value={folder} />
              ))}
          </datalist>
          <p className="text-muted-foreground text-xs">
            {!isSelectedFolderValid && (
              <>
                “{folder}” uses an unsupported folder name. Choose another folder or
                leave this empty.{" "}
              </>
            )}
            Choose an existing folder or use a new name. Use letters and numbers. Leave
            empty to keep it unfiled.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </fieldset>
    </Modal>
  );
}

type AssetSort = (typeof assetSortOptions)[number]["value"];
