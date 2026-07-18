"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { COMBAT_BIOMES } from "@/drizzle/constants";
import type { MapTerrain } from "@/drizzle/schema";
import ContentBox from "@/layout/ContentBox";
import ContentImageSelector from "@/layout/ContentImageSelector";
import Loader from "@/layout/Loader";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import { mapTerrainValidator, type ZodMapTerrainType } from "@/validators/mapTerrain";

/** Content-staff edit page for a single map terrain: redirects non-editors to /profile, then delegates to SingleEditMapTerrain */
export default function MapTerrainEdit(props: {
  params: Promise<{ terrainid: string }>;
}) {
  const params = use(props.params);
  const terrainId = params.terrainid;
  const router = useRouter();
  const { data: userData } = useRequiredUserData();

  const { data, isPending, refetch } = api.mapTerrain.get.useQuery(
    { id: terrainId },
    { enabled: !!terrainId && !!userData },
  );

  // Redirect to profile if not content or admin
  useEffect(() => {
    if (userData && !canChangeContent(userData.role)) {
      router.push("/profile");
    }
  }, [userData, router]);

  if (isPending || !userData || !canChangeContent(userData.role) || !data) {
    return <Loader explanation="Loading data" />;
  }

  return <SingleEditMapTerrain terrain={data} refetch={refetch} />;
}

interface SingleEditMapTerrainProps {
  // Public get() omits the internal authoring user-id, which this form ignores
  terrain: Omit<MapTerrain, "createdByUserId">;
  refetch: () => void;
}

/**
 * Form for a single terrain kind. The three colors are the tile shades
 * (light/mid are mixed on walkable tiles, dark marks blocked tiles).
 * Protected (built-in) terrains have their key locked but stay visually
 * editable; submit is diff-gated via calculateContentDiff.
 */
const SingleEditMapTerrain: React.FC<SingleEditMapTerrainProps> = (props) => {
  const { terrain, refetch } = props;
  const utils = api.useUtils();
  const form = useForm<ZodMapTerrainType>({
    mode: "all",
    criteriaMode: "all",
    values: terrain,
    defaultValues: terrain,
    resolver: zodResolver(mapTerrainValidator),
  });

  const { mutate: updateTerrain } = api.mapTerrain.update.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      refetch();
      // The tilesets list and the travel page session-cache the full library
      // (getAll), so a save here must invalidate it or they keep showing the
      // old terrain until a manual refresh
      await utils.mapTerrain.getAll.invalidate();
    },
  });

  const handleTerrainSubmit = form.handleSubmit(
    (data: ZodMapTerrainType) => {
      const newTerrain = { ...terrain, ...data };
      const diff = calculateContentDiff(terrain, newTerrain);
      if (diff.length > 0) {
        updateTerrain({ id: terrain.id, data: newTerrain });
      }
    },
    (errors) => showFormErrorsToast(errors),
  );

  const colors = useWatch({ control: form.control, name: "colors" });
  const textureUrl = useWatch({ control: form.control, name: "textureUrl" });

  const colorLabels = ["Light shade", "Mid shade", "Dark shade (blocked)"] as const;

  return (
    <ContentBox
      title="Content Panel"
      subtitle="Map Terrain Management"
      defaultBackHref="/manual/world/tilesets"
      noRightAlign={true}
    >
      <p className="pb-3 text-muted-foreground text-sm">
        The terrain key is how map tiles reference this kind of ground: renaming it
        orphans tiles painted with it. In-game tiles mix the light and mid shades; the
        dark shade marks blocked (impassable) tiles.
        {terrain.protected &&
          " This is a built-in terrain: its key is locked and it cannot be deleted, but its look and behaviour are editable."}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="terrain-name">Display Name</Label>
            <Input id="terrain-name" {...form.register("name")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="terrain-key">Terrain Key (used by maps)</Label>
            <Input
              id="terrain-key"
              disabled={terrain.protected}
              {...form.register("key")}
            />
          </div>
          <div className="space-y-1">
            <Label>Tile shades</Label>
            <div className="flex gap-2">
              {colorLabels.map((label, idx) => (
                <div key={label} className="flex grow flex-col gap-1">
                  <Controller
                    control={form.control}
                    name={`colors.${idx as 0 | 1 | 2}` as const}
                    render={({ field }) => (
                      <input
                        type="color"
                        aria-label={label}
                        className="h-10 w-full cursor-pointer rounded-md border bg-background"
                        value={String(field.value ?? "#ffffff")}
                        onChange={(event) => field.onChange(event.target.value)}
                      />
                    )}
                  />
                  <span className="text-muted-foreground text-xs">{label}</span>
                </div>
              ))}
            </div>
            <div className="flex h-6 overflow-hidden rounded-md">
              {(colors ?? terrain.colors).map((color, idx) => (
                <div
                  key={`preview-${idx}`}
                  className="h-full flex-1"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="terrain-swatch">Tiled editor swatch color</Label>
            <Controller
              control={form.control}
              name="swatchColor"
              render={({ field }) => (
                <input
                  id="terrain-swatch"
                  type="color"
                  className="h-10 w-full cursor-pointer rounded-md border bg-background"
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                />
              )}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="terrain-biome">Combat arena (battle background)</Label>
            <select
              id="terrain-biome"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
              {...form.register("battleBiome")}
            >
              {COMBAT_BIOMES.map((biome) => (
                <option key={biome} value={biome}>
                  {biome}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="terrain-water">Water</Label>
              <p className="text-muted-foreground text-xs">
                Animated waves, recessed depth, heavy path weighting, and an impassable
                lake variant in the Tiled palette
              </p>
            </div>
            <Controller
              control={form.control}
              name="isWater"
              render={({ field }) => (
                <Switch
                  id="terrain-water"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="terrain-depression">
              Depression (0 = flat, 0.5 = deep water recess)
            </Label>
            <Input
              id="terrain-depression"
              type="number"
              step="0.05"
              min="0"
              max="1"
              {...form.register("depression", { valueAsNumber: true })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="terrain-walkcost">Default walk cost</Label>
            <Input
              id="terrain-walkcost"
              type="number"
              min="1"
              max="50"
              {...form.register("defaultWalkCost", { valueAsNumber: true })}
            />
          </div>
          <div className="space-y-1">
            <Label>Texture overlay (optional, blended over the shades)</Label>
            <ContentImageSelector
              label="Texture"
              imageUrl={textureUrl}
              id={terrain.id}
              prompt={`seamless ${terrain.name} texture tile`}
              allowImageUpload={true}
              type="mapTerrain"
              onUploadComplete={(url) =>
                form.setValue("textureUrl", url, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              size="square"
              maxDim={256}
            />
            {textureUrl && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  form.setValue("textureUrl", null, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              >
                Remove texture (use flat noise)
              </Button>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="terrain-license">License / attribution</Label>
            <Input id="terrain-license" {...form.register("licenseDetails")} />
          </div>
        </div>
      </div>
      <Button className="mt-4 w-full" onClick={handleTerrainSubmit}>
        Save to Database
      </Button>
    </ContentBox>
  );
};
