"use client";

import { FilePlus, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { usePendingIds } from "@/hooks/usePendingIds";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
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
  const createFlight = useSingleFlight();
  const assetDeletions = usePendingIds();

  const { data: assets, refetch, isPending } = api.mapAsset.getAll.useQuery();

  const { mutate: create, isPending: isCreating } = api.mapAsset.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await refetch();
        router.push(`/manual/world/tilesets/edit/${data.message}`);
      }
    },
    onSettled: () => createFlight.release(),
  });

  const handleCreate = (category: "prop" | "structure" = "prop") => {
    if (!createFlight.claim()) return;
    if (category === "structure") create({ category });
    else create();
  };

  const { mutate: remove } = api.mapAsset.delete.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
    },
    onSettled: (_data, _error, variables) => assetDeletions.end(variables.id),
  });

  const handleDelete = (id: string) => {
    // Other asset cards remain independent and usable.
    if (assetDeletions.begin(id)) remove({ id });
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
        subtitle="Shared decoration and structure artwork"
        defaultBackHref="/manual/world"
        topRightContent={
          canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button
                id="create-map-asset"
                onClick={() => handleCreate()}
                disabled={isCreating}
                loading={isCreating}
                aria-busy={isCreating}
                aria-label={isCreating ? "Creating map asset" : "Create map asset"}
              >
                {!isCreating && <FilePlus className="mr-2 h-5 w-5" />}
                <span aria-live="polite">{isCreating ? "Creating" : "New"}</span>
              </Button>
              <Button
                variant="secondary"
                disabled={isCreating}
                onClick={() => handleCreate("structure")}
              >
                New structure
              </Button>
            </div>
          ) : undefined
        }
      >
        <p className="pb-2">
          Reuse these sprites as quest structures, dungeon entrances or sector
          decorations. Decorations are also included in every &quot;Download for
          Tiled&quot; kit.
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
          {shownAssets.map((asset) => (
            <LibraryCard
              key={asset.id}
              name={asset.name}
              assetKey={asset.key}
              dataAttributes={{ "data-map-asset-id": asset.id }}
              preview={
                <div className="relative flex aspect-square w-full items-center justify-center rounded-md bg-linear-to-b from-sky-100 to-emerald-100">
                  <Image
                    src={asset.imageUrl}
                    alt={asset.key}
                    fill
                    sizes="(max-width: 768px) 45vw, 220px"
                    className="object-contain p-2"
                  />
                </div>
              }
              tags={[
                asset.category,
                asset.windAffected && "wind",
                asset.small && "small",
                asset.randomRotation && "rotates",
              ]}
              canEdit={canEdit}
              editHref={`/manual/world/tilesets/edit/${asset.id}`}
              isDeleting={assetDeletions.ids.has(asset.id)}
              deleteTitle="Delete map asset"
              deleteText={`Delete ${asset.name} (${asset.key})? Maps referencing this key will stop rendering the decoration until the key exists again.`}
              onDelete={() => handleDelete(asset.id)}
            />
          ))}
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
  const createFlight = useSingleFlight();
  const terrainDeletions = usePendingIds();
  const { data: terrains, refetch, isPending } = api.mapTerrain.getAll.useQuery();

  const { mutate: create, isPending: isCreating } = api.mapTerrain.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await refetch();
        router.push(`/manual/world/tilesets/terrain/edit/${data.message}`);
      }
    },
    onSettled: () => createFlight.release(),
  });

  const handleCreate = () => {
    if (!createFlight.claim()) return;
    create();
  };

  const { mutate: remove } = api.mapTerrain.delete.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
    },
    onSettled: (_data, _error, variables) => terrainDeletions.end(variables.id),
  });

  const handleDelete = (id: string) => {
    // Deletes for other terrain cards stay independent.
    if (terrainDeletions.begin(id)) remove({ id });
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
        {(terrains ?? []).map((terrain) => (
          <LibraryCard
            key={terrain.id}
            name={terrain.name}
            assetKey={terrain.key}
            dataAttributes={{ "data-map-terrain-id": terrain.id }}
            preview={
              <div className="flex aspect-square w-full overflow-hidden rounded-md">
                {terrain.colors.map((color, idx) => (
                  <div
                    key={`${terrain.id}-${idx}`}
                    className="h-full flex-1"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            }
            tags={[
              `arena: ${terrain.battleBiome}`,
              terrain.isWater && "water",
              terrain.depression > 0 && "sunken",
              `cost ${terrain.defaultWalkCost}`,
              terrain.protected && "built-in",
            ]}
            canEdit={canEdit}
            editHref={`/manual/world/tilesets/terrain/edit/${terrain.id}`}
            isDeleting={terrainDeletions.ids.has(terrain.id)}
            deleteTitle="Delete terrain"
            deleteText={`Delete ${terrain.name} (${terrain.key})? Map tiles painted with this terrain will render as grassland until the key exists again.`}
            onDelete={terrain.protected ? undefined : () => handleDelete(terrain.id)}
          />
        ))}
      </div>
    </ContentBox>
  );
};

/** Gallery tile of one shared map asset or terrain with its edit and delete actions. */
const LibraryCard: React.FC<LibraryCardProps> = (props) => {
  const { name, assetKey, dataAttributes, preview, tags, canEdit, editHref } = props;
  const { isDeleting, deleteTitle, deleteText, onDelete } = props;
  return (
    <div
      className="relative flex flex-col rounded-lg border bg-popover p-2"
      aria-busy={isDeleting}
      {...dataAttributes}
    >
      {preview}
      <p className="mt-1 truncate font-semibold" title={name}>
        {name}
      </p>
      <p className="truncate text-muted-foreground text-xs" title={assetKey}>
        {assetKey}
      </p>
      <div className="flex flex-wrap gap-1 py-1 text-xs">
        {tags
          .filter((tag) => tag !== false)
          .map((tag) => (
            <span
              key={tag}
              className="rounded bg-secondary px-1 text-secondary-foreground"
            >
              {tag}
            </span>
          ))}
      </div>
      {canEdit && (
        <div className="mt-auto flex gap-2 pt-1">
          <Link
            href={editHref}
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
          {onDelete && (
            <Confirm
              title={deleteTitle}
              button={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isDeleting}
                  loading={isDeleting}
                  aria-label={isDeleting ? `Deleting ${name}` : `Delete ${name}`}
                >
                  {!isDeleting && <Trash2 className="h-4 w-4" />}
                </Button>
              }
              disabled={isDeleting}
              isLoading={isDeleting}
              proceed_loading_label="Deleting"
              onAccept={onDelete}
            >
              {deleteText}
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
};

interface LibraryCardProps {
  name: string;
  assetKey: string;
  dataAttributes: Record<string, string>;
  preview: React.ReactNode;
  /** Falsy entries are skipped, so a tag can be listed with its condition. */
  tags: (string | false)[];
  canEdit: boolean;
  editHref: string;
  isDeleting: boolean;
  deleteTitle: string;
  deleteText: string;
  /** Omit for entries that cannot be deleted. */
  onDelete?: () => void;
}
