"use client";

import { FilePlus, Pencil, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import Confirm2 from "@/layout/Confirm2";
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

  const {
    data: assets,
    refetch,
    isPending,
  } = api.mapAsset.getAll.useQuery(undefined, {
    enabled: !!userData,
  });

  const { mutate: create } = api.mapAsset.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await refetch();
        router.push(`/manual/world/tilesets/edit/${data.message}`);
      }
    },
  });

  const { mutate: remove } = api.mapAsset.delete.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
    },
  });

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
            <Button id="create-map-asset" onClick={() => create()}>
              <FilePlus className="mr-2 h-5 w-5" />
              New
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
          {shownAssets.map((asset) => (
            <div
              key={asset.id}
              className="flex flex-col rounded-lg border bg-popover p-2"
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
                    className="grow"
                  >
                    <Button variant="secondary" size="sm" className="w-full">
                      <Pencil className="mr-1 h-4 w-4" />
                      Edit
                    </Button>
                  </Link>
                  <Confirm2
                    title="Delete map asset"
                    button={
                      <Button variant="destructive" size="sm" aria-label="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    }
                    onAccept={() => remove({ id: asset.id })}
                  >
                    Delete {asset.name} ({asset.key})? Maps referencing this key will
                    stop rendering the decoration until the key exists again.
                  </Confirm2>
                </div>
              )}
            </div>
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
  const {
    data: terrains,
    refetch,
    isPending,
  } = api.mapTerrain.getAll.useQuery(undefined, { enabled: canEdit });

  const { mutate: create } = api.mapTerrain.create.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await refetch();
        router.push(`/manual/world/tilesets/terrain/edit/${data.message}`);
      }
    },
  });

  const { mutate: remove } = api.mapTerrain.delete.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
    },
  });

  return (
    <ContentBox
      title="Map Terrains"
      subtitle="The shared terrain library"
      initialBreak={true}
      topRightContent={
        canEdit ? (
          <Button id="create-map-terrain" onClick={() => create()}>
            <FilePlus className="mr-2 h-5 w-5" />
            New
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
          <div
            key={terrain.id}
            className="flex flex-col rounded-lg border bg-popover p-2"
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
                  className="grow"
                >
                  <Button variant="secondary" size="sm" className="w-full">
                    <Pencil className="mr-1 h-4 w-4" />
                    Edit
                  </Button>
                </Link>
                {!terrain.protected && (
                  <Confirm2
                    title="Delete terrain"
                    button={
                      <Button variant="destructive" size="sm" aria-label="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    }
                    onAccept={() => remove({ id: terrain.id })}
                  >
                    Delete {terrain.name} ({terrain.key})? Map tiles painted with this
                    terrain will render as grassland until the key exists again.
                  </Confirm2>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </ContentBox>
  );
};
