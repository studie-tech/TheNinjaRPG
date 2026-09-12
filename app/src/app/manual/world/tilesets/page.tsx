"use client";

import { FilePlus, Pencil, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

/**
 * Gallery of the shared decoration sprite library with a category filter.
 * Content staff can create, edit and delete assets; deleting an asset orphans
 * map decorations that reference its key until the key exists again.
 */
export default function MapTilesets() {
  const router = useRouter();
  const { data: userData } = useUserData();
  const canEdit = Boolean(userData && canChangeContent(userData.role));
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const createInFlightRef = useRef(false);
  const [deletingAssetIds, setDeletingAssetIds] = useState<string[]>([]);
  const deletingAssetIdsRef = useRef(new Set<string>());

  const {
    data: assets,
    refetch,
    isPending,
  } = api.mapAsset.getAll.useQuery(undefined, {
    enabled: !!userData,
  });

  const { mutate: create, isPending: isCreating } = api.mapAsset.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await refetch();
        router.push(`/manual/world/tilesets/edit/${data.message}`);
      }
    },
    onError: (error) => {
      showMutationToast({ success: false, message: error.message });
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

  const { mutate: remove } = api.mapAsset.delete.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
    },
    onError: (error) => {
      showMutationToast({ success: false, message: error.message });
    },
    onSettled: (_data, _error, variables) => {
      deletingAssetIdsRef.current.delete(variables.id);
      setDeletingAssetIds((current) =>
        current.filter((assetId) => assetId !== variables.id),
      );
    },
  });

  const handleDelete = (id: string) => {
    // React state updates after this handler, so retain a synchronous per-asset
    // guard as well. Other asset cards remain independent and usable.
    if (deletingAssetIdsRef.current.has(id)) return;
    deletingAssetIdsRef.current.add(id);
    setDeletingAssetIds((current) => [...current, id]);
    remove({ id });
  };

  const categories = useMemo(() => {
    return [...new Set((assets ?? []).map((asset) => asset.category))].sort();
  }, [assets]);
  const shownAssets = (assets ?? []).filter(
    (asset) => !categoryFilter || asset.category === categoryFilter,
  );

  return (
    <>
      <ContentBox
        title="Map Tilesets"
        subtitle="The shared decoration sprite library"
        defaultBackHref="/manual/world"
        topRightContent={
          canEdit ? (
            <Button
              id="create-map-asset"
              onClick={handleCreate}
              disabled={isCreating}
              loading={isCreating}
              aria-busy={isCreating}
              aria-label={isCreating ? "Creating map asset" : "Create map asset"}
            >
              {!isCreating && <FilePlus className="mr-2 h-5 w-5" />}
              <span aria-live="polite">{isCreating ? "Creating" : "New"}</span>
            </Button>
          ) : undefined
        }
      >
        <p className="pb-2">
          These sprites can be placed on any sector map as decorations. They are bundled
          into every &quot;Download for Tiled&quot; kit, so new uploads are immediately
          usable (and visible) in the Tiled editor for everyone.
        </p>
        <div className="flex flex-wrap gap-2 pb-3">
          <Button
            variant={categoryFilter === null ? "default" : "secondary"}
            size="sm"
            onClick={() => setCategoryFilter(null)}
          >
            All ({assets?.length ?? 0})
          </Button>
          {categories.map((category) => (
            <Button
              key={category}
              variant={categoryFilter === category ? "default" : "secondary"}
              size="sm"
              onClick={() => setCategoryFilter(category)}
            >
              {category}
            </Button>
          ))}
        </div>
        {isPending && <Loader explanation="Loading map assets" />}
        {!isPending && shownAssets.length === 0 && (
          <p className="italic">No map assets yet.</p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {shownAssets.map((asset) => {
            const isDeleting = deletingAssetIds.includes(asset.id);
            return (
              <div
                key={asset.id}
                className="relative flex flex-col rounded-lg border bg-popover p-2"
                aria-busy={isDeleting}
                data-map-asset-id={asset.id}
              >
                <div className="relative flex aspect-square w-full items-center justify-center rounded-md bg-linear-to-b from-sky-100 to-emerald-100">
                  <Image
                    src={asset.imageUrl}
                    alt={asset.key}
                    fill
                    sizes="(max-width: 768px) 45vw, 220px"
                    className="object-contain p-2"
                  />
                </div>
                <p className="mt-1 truncate font-semibold" title={asset.name}>
                  {asset.name}
                </p>
                <p className="truncate text-muted-foreground text-xs" title={asset.key}>
                  {asset.key}
                </p>
                <div className="flex flex-wrap gap-1 py-1 text-xs">
                  <span className="rounded bg-secondary px-1 text-secondary-foreground">
                    {asset.category}
                  </span>
                  {asset.windAffected && (
                    <span className="rounded bg-secondary px-1 text-secondary-foreground">
                      wind
                    </span>
                  )}
                  {asset.small && (
                    <span className="rounded bg-secondary px-1 text-secondary-foreground">
                      small
                    </span>
                  )}
                  {asset.randomRotation && (
                    <span className="rounded bg-secondary px-1 text-secondary-foreground">
                      rotates
                    </span>
                  )}
                </div>
                {canEdit && (
                  <div className="mt-auto flex gap-2 pt-1">
                    <Link
                      href={`/manual/world/tilesets/edit/${asset.id}`}
                      className={isDeleting ? "pointer-events-none grow" : "grow"}
                      aria-disabled={isDeleting}
                      tabIndex={isDeleting ? -1 : undefined}
                      onClick={(event) => {
                        if (isDeleting) event.preventDefault();
                      }}
                    >
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-full"
                        disabled={isDeleting}
                      >
                        <Pencil className="mr-1 h-4 w-4" />
                        Edit
                      </Button>
                    </Link>
                    <Confirm
                      title="Delete map asset"
                      button={
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={isDeleting}
                          loading={isDeleting}
                          aria-label={
                            isDeleting
                              ? `Deleting ${asset.name}`
                              : `Delete ${asset.name}`
                          }
                        >
                          {!isDeleting && <Trash2 className="h-4 w-4" />}
                        </Button>
                      }
                      disabled={isDeleting}
                      isLoading={isDeleting}
                      proceed_loading_label="Deleting"
                      onAccept={() => handleDelete(asset.id)}
                    >
                      Delete {asset.name} ({asset.key})? Maps referencing this key will
                      stop rendering the decoration until the key exists again.
                    </Confirm>
                  </div>
                )}
                {isDeleting && (
                  <div
                    className="absolute inset-0 z-10 flex cursor-wait items-center justify-center rounded-lg bg-slate-950/75 font-semibold text-white backdrop-blur-[1px]"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader explanation="Deleting" noPadding size={24} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ContentBox>
      <MapTerrainSection canEdit={canEdit} />
    </>
  );
}

/**
 * CRUD list of paintable terrain kinds shown under the tileset gallery.
 * Built-in (protected) terrains cannot be deleted because world-map tiles
 * reference them; deleting a custom terrain makes tiles painted with it fall
 * back to grassland.
 */
const MapTerrainSection: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const router = useRouter();
  const createInFlightRef = useRef(false);
  const [deletingTerrainIds, setDeletingTerrainIds] = useState<string[]>([]);
  const deletingTerrainIdsRef = useRef(new Set<string>());
  const {
    data: terrains,
    refetch,
    isPending,
  } = api.mapTerrain.getAll.useQuery(undefined, { enabled: canEdit });

  const { mutate: create, isPending: isCreating } = api.mapTerrain.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await refetch();
        router.push(`/manual/world/tilesets/terrain/edit/${data.message}`);
      }
    },
    onError: (error) => {
      showMutationToast({ success: false, message: error.message });
    },
    onSettled: () => {
      createInFlightRef.current = false;
    },
  });

  const handleCreate = () => {
    // React's pending state is asynchronous, so guard same-tick double clicks too.
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;
    create();
  };

  const { mutate: remove } = api.mapTerrain.delete.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
    },
    onError: (error) => {
      showMutationToast({ success: false, message: error.message });
    },
    onSettled: (_data, _error, variables) => {
      deletingTerrainIdsRef.current.delete(variables.id);
      setDeletingTerrainIds((current) =>
        current.filter((terrainId) => terrainId !== variables.id),
      );
    },
  });

  const handleDelete = (id: string) => {
    // State updates after this handler, so also guard same-tick confirmation
    // submissions synchronously. Deletes for other terrain cards stay independent.
    if (deletingTerrainIdsRef.current.has(id)) return;
    deletingTerrainIdsRef.current.add(id);
    setDeletingTerrainIds((current) => [...current, id]);
    remove({ id });
  };

  return (
    <ContentBox
      title="Map Terrains"
      subtitle="The shared terrain library"
      initialBreak={true}
      topRightContent={
        canEdit ? (
          <Button
            id="create-map-terrain"
            onClick={handleCreate}
            disabled={isCreating}
            loading={isCreating}
            aria-busy={isCreating}
            aria-label={isCreating ? "Creating map terrain" : "Create map terrain"}
          >
            {!isCreating && <FilePlus className="mr-2 h-5 w-5" />}
            <span aria-live="polite">{isCreating ? "Creating" : "New"}</span>
          </Button>
        ) : undefined
      }
    >
      <p className="pb-3">
        The kinds of ground a map tile can be painted with: colors, optional texture,
        water behaviour, walk cost and combat arena. Every kind is paintable in the
        Tiled editor on any sector. Built-in kinds are protected (the world map
        references them) but their look can be edited.
      </p>
      {isPending && <Loader explanation="Loading terrains" />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {(terrains ?? []).map((terrain) => {
          const isDeleting = deletingTerrainIds.includes(terrain.id);
          return (
            <div
              key={terrain.id}
              className="relative flex flex-col rounded-lg border bg-popover p-2"
              aria-busy={isDeleting}
              data-map-terrain-id={terrain.id}
            >
              <div className="flex aspect-square w-full overflow-hidden rounded-md">
                {terrain.colors.map((color, idx) => (
                  <div
                    key={`${terrain.id}-${idx}`}
                    className="h-full flex-1"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <p className="mt-1 truncate font-semibold" title={terrain.name}>
                {terrain.name}
              </p>
              <p className="truncate text-muted-foreground text-xs" title={terrain.key}>
                {terrain.key}
              </p>
              <div className="flex flex-wrap gap-1 py-1 text-xs">
                <span className="rounded bg-secondary px-1 text-secondary-foreground">
                  arena: {terrain.battleBiome}
                </span>
                {terrain.isWater && (
                  <span className="rounded bg-secondary px-1 text-secondary-foreground">
                    water
                  </span>
                )}
                {terrain.depression > 0 && (
                  <span className="rounded bg-secondary px-1 text-secondary-foreground">
                    sunken
                  </span>
                )}
                <span className="rounded bg-secondary px-1 text-secondary-foreground">
                  cost {terrain.defaultWalkCost}
                </span>
                {terrain.protected && (
                  <span className="rounded bg-secondary px-1 text-secondary-foreground">
                    built-in
                  </span>
                )}
              </div>
              {canEdit && (
                <div className="mt-auto flex gap-2 pt-1">
                  <Link
                    href={`/manual/world/tilesets/terrain/edit/${terrain.id}`}
                    className={isDeleting ? "pointer-events-none grow" : "grow"}
                    aria-disabled={isDeleting}
                    tabIndex={isDeleting ? -1 : undefined}
                    onClick={(event) => {
                      if (isDeleting) event.preventDefault();
                    }}
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      disabled={isDeleting}
                    >
                      <Pencil className="mr-1 h-4 w-4" />
                      Edit
                    </Button>
                  </Link>
                  {!terrain.protected && (
                    <Confirm
                      title="Delete terrain"
                      button={
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={isDeleting}
                          loading={isDeleting}
                          aria-label={
                            isDeleting
                              ? `Deleting ${terrain.name}`
                              : `Delete ${terrain.name}`
                          }
                        >
                          {!isDeleting && <Trash2 className="h-4 w-4" />}
                        </Button>
                      }
                      disabled={isDeleting}
                      isLoading={isDeleting}
                      proceed_loading_label="Deleting"
                      onAccept={() => handleDelete(terrain.id)}
                    >
                      Delete {terrain.name} ({terrain.key})? Map tiles painted with this
                      terrain will render as grassland until the key exists again.
                    </Confirm>
                  )}
                </div>
              )}
              {isDeleting && (
                <div
                  className="absolute inset-0 z-10 flex cursor-wait items-center justify-center rounded-lg bg-slate-950/75 font-semibold text-white backdrop-blur-[1px]"
                  role="status"
                  aria-live="polite"
                >
                  <Loader explanation="Deleting" noPadding size={24} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ContentBox>
  );
};
