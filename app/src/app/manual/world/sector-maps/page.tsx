"use client";

import {
  Archive,
  Download,
  FileCheck,
  FileJson,
  Rocket,
  Save,
  Upload,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAP_SECTOR_ID_MAX } from "@/drizzle/constants";
import { useDelayState } from "@/hooks/useDelayState";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import SectorPreview from "@/layout/SectorPreview";
import { mergeDecorationAssets } from "@/libs/sector-map/decorations";
import { isValidSectorId } from "@/libs/sector-map/sector-ids";
import { mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import { normalizeTiledSectorMap } from "@/libs/sector-map/tiled";
import { downloadSectorForTiled } from "@/libs/sector-map/tiled-download";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { parseJsonSafe } from "@/utils/typeutils";
import { useUserData } from "@/utils/UserContext";

type PreviewResult = {
  success: boolean;
  message: string;
  errors: string[];
  warnings: string[];
  map?: {
    width: number;
    height: number;
    tiles: unknown[];
    anchors: unknown[];
    exits: unknown[];
  };
};

const DEFAULT_JSON = `{
  "orientation": "hexagonal",
  "width": 26,
  "height": 26,
  "tilewidth": 64,
  "tileheight": 56,
  "layers": [
    { "name": "terrain", "type": "tilelayer", "width": 26, "height": 26, "data": [] }
  ],
  "tilesets": []
}`;

/** Normalize save/preview mutation responses into the PreviewResult shape the validation panel renders, defaulting absent errors/warnings to empty arrays */
const toPreviewResult = (data: {
  success: boolean;
  message: string;
  errors?: string[];
  warnings?: string[];
  map?: PreviewResult["map"];
}): PreviewResult => ({
  success: data.success,
  message: data.message,
  errors: data.errors ?? [],
  warnings: data.warnings ?? [],
  map: data.map,
});

/**
 * Content-staff-only editor for a sector's Tiled JSON map: live client-side
 * preview through the same importer the server uses, version history
 * (draft/publish/archive), Tiled kit download/upload, and drag-and-drop
 * structure relocation. The sector can be pre-selected via ?sector=.
 */
function SectorMapEditorContent() {
  const utils = api.useUtils();
  const searchParams = useSearchParams();
  const { data: userData } = useUserData();
  const canEdit = Boolean(userData && canChangeContent(userData.role));
  // Sector can be pre-selected via ?sector= (e.g. clicking a tile on the globe
  // in /manual/world), so editors land straight on that sector's maps.
  const initialSector = (() => {
    const value = Number(searchParams.get("sector"));
    return isValidSectorId(value) ? value : 0;
  })();
  const [sector, setSector] = useState(initialSector);
  const [name, setName] = useState(`Sector ${initialSector}`);
  // The inline preview re-renders as the JSON changes; debounce typing
  const [jsonText, debouncedJson, setJsonText] = useDelayState(DEFAULT_JSON, 400);
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "DRAFT" | "PUBLISHED" | "ARCHIVED"
  >("ALL");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  // What the editor was last seeded from (loaded version, upload, or the empty
  // template) plus the exact seeded content: the unsaved-changes flag — and
  // therefore which action buttons are shown — derives from comparing the
  // editor against this baseline
  const [baseline, setBaseline] = useState<{ json: string; name: string } | null>(null);
  const [sourceLabel, setSourceLabel] = useState<
    | { kind: "version"; version: number; status: string }
    | { kind: "upload"; fileName: string }
    | { kind: "template" }
    | null
  >(null);
  const [parseError, setParseError] = useState("");
  // Structure move pending the user's confirmation (set by preview drag&drop)
  const [pendingMove, setPendingMove] = useState<{
    structureId: string;
    name: string;
    x: number;
    y: number;
  } | null>(null);

  const { data: maps, isFetching } = api.worldMap.listSectorMaps.useQuery(
    {
      sector,
      status: statusFilter === "ALL" ? undefined : statusFilter,
    },
    { enabled: canEdit },
  );

  // Data for the always-on scene preview: the shared asset/terrain libraries
  // plus the sector's village and its structures (drag&drop targets)
  const { data: dbAssets } = api.mapAsset.getAll.useQuery(undefined, {
    enabled: canEdit,
  });
  const { data: dbTerrains } = api.mapTerrain.getAll.useQuery(undefined, {
    enabled: canEdit,
  });
  const { data: sectorVillage } = api.travel.getVillageInSector.useQuery(
    { sector, isOutlaw: false },
    { enabled: canEdit },
  );
  const decorationAssets = useMemo(
    () => mergeDecorationAssets(dbAssets ?? []),
    [dbAssets],
  );
  const terrainRegistry = useMemo(
    () => mergeTerrainSpecs(dbTerrains ?? []),
    [dbTerrains],
  );

  // The preview renders whatever is in the editor, through the same importer
  // the server uses; errors surface in place of the canvas
  const normalized = useMemo(() => {
    const parsed = parseJsonSafe(debouncedJson);
    if (parsed.error || parsed.data === undefined) {
      return {
        map: undefined,
        errors: [parsed.error || "No JSON loaded"],
        warnings: [] as string[],
      };
    }
    const result = normalizeTiledSectorMap({
      sector,
      name: "Preview",
      tiledJson: parsed.data,
      terrainRegistry,
    });
    return { map: result.map, errors: result.errors, warnings: result.warnings };
  }, [debouncedJson, sector, terrainRegistry]);

  /**
   * Load a stored version's rawTiledJson into the editor. Returns whether the
   * load succeeded - the auto-load effect uses a false return to reset its
   * guard so the next query update retries.
   */
  const handleLoadMap = async (id: string): Promise<boolean> => {
    try {
      const map = await utils.worldMap.getSectorMapById.fetch({ id });
      if (!map?.rawTiledJson) {
        setParseError("This map version has no raw Tiled JSON stored");
        return false;
      }
      const text = JSON.stringify(map.rawTiledJson, null, 2);
      setSector(map.sector);
      setName(map.name);
      setJsonText(text);
      setBaseline({ json: text, name: map.name });
      setSourceLabel({ kind: "version", version: map.version, status: map.status });
      setPreview(null);
      setParseError("");
      return true;
    } catch (error) {
      setParseError(
        `Could not load the map version: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  };

  // When the selected sector changes, auto-load its current map (the published
  // version, else the highest version) so the editor shows real JSON instead of
  // the empty template. Guarded by a ref so it fires once per sector and never
  // clobbers an in-progress edit or a manually loaded older version; a FAILED
  // load resets the guard so the next query update retries instead of leaving
  // the empty template in place.
  const autoLoadedSectorRef = useRef<number | null>(null);
  useEffect(() => {
    if (!canEdit || !maps) return;
    if (autoLoadedSectorRef.current === sector) return;
    const published = maps.find((map) => map.status === "PUBLISHED");
    const latest = published ?? [...maps].sort((a, b) => b.version - a.version)[0];
    if (latest) {
      autoLoadedSectorRef.current = sector;
      void handleLoadMap(latest.id).then((loaded) => {
        if (!loaded) autoLoadedSectorRef.current = null;
      });
    } else {
      // The sector has no saved maps: start from the empty template rather than
      // keeping the previously-selected sector's JSON, which Save/Publish would
      // otherwise write under this sector's id.
      autoLoadedSectorRef.current = sector;
      setJsonText(DEFAULT_JSON);
      setName(`Sector ${sector}`);
      setBaseline({ json: DEFAULT_JSON, name: `Sector ${sector}` });
      setSourceLabel({ kind: "template" });
      setPreview(null);
      setParseError("");
    }
  }, [maps, sector, canEdit]);

  const { mutate: previewMap, isPending: isPreviewing } =
    api.worldMap.previewTiledSectorMap.useMutation({
      onSuccess: (data) => {
        setPreview(toPreviewResult(data));
        showMutationToast(data);
      },
    });

  const { mutate: saveMap, isPending: isSaving } =
    api.worldMap.saveTiledSectorMap.useMutation({
      onSuccess: async (data, variables) => {
        setPreview(toPreviewResult(data));
        showMutationToast(data);
        if (data.success) {
          // The editor now matches a stored version: clear the unsaved-changes
          // state and show what was just saved
          setBaseline({ json: jsonText, name });
          if ("version" in data && data.version !== undefined) {
            setSourceLabel({
              kind: "version",
              version: data.version,
              status: variables.publish ? "PUBLISHED" : "DRAFT",
            });
          }
          await Promise.all([
            utils.worldMap.listSectorMaps.invalidate(),
            utils.worldMap.getSectorWindow.invalidate(),
          ]);
        }
      },
    });

  const { mutate: publishMap, isPending: isPublishing } =
    api.worldMap.publishSectorMap.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await Promise.all([
          utils.worldMap.listSectorMaps.invalidate(),
          utils.worldMap.getSectorWindow.invalidate(),
        ]);
      },
    });

  const { mutate: archiveMap, isPending: isArchiving } =
    api.worldMap.archiveSectorMap.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await Promise.all([
          utils.worldMap.listSectorMaps.invalidate(),
          utils.worldMap.getSectorWindow.invalidate(),
        ]);
      },
    });

  // Parse the editor JSON, surfacing any parse error inline
  const getParsedJson = () => {
    const parsed = parseJsonSafe(jsonText);
    setParseError(parsed.error);
    return parsed;
  };

  // Server-side validation of the editor JSON without saving anything
  const handlePreview = () => {
    const parsed = getParsedJson();
    if (parsed.error) return;
    previewMap({
      sector,
      name,
      tiledJson: parsed.data,
    });
  };

  // Save the editor JSON as a new draft version, or publish it directly
  const handleSave = (publish: boolean) => {
    const parsed = getParsedJson();
    if (parsed.error) return;
    saveMap({
      sector,
      name,
      publish,
      tiledJson: parsed.data,
    });
  };

  // Load an uploaded .json file into the editor (map name from the filename)
  const handleUpload = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    // Pin the auto-load guard: without this, an upload done before the History
    // query first resolves would be silently overwritten by the auto-loaded
    // current version
    autoLoadedSectorRef.current = sector;
    setJsonText(text);
    setName(file.name.replace(/\.json$/i, ""));
    setSourceLabel({ kind: "upload", fileName: file.name });
    setPreview(null);
    setParseError("");
  };

  // Persist a confirmed structure relocation, then refresh everything that
  // renders structures (the preview's village query and the game scene)
  const { mutate: moveStructure, isPending: isMoving } =
    api.worldMap.moveStructure.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        setPendingMove(null);
        await Promise.all([
          utils.travel.getVillageInSector.invalidate(),
          utils.travel.getSectorData.invalidate(),
          utils.worldMap.getSectorWindow.invalidate(),
        ]);
      },
    });

  // Package the current map as a Tiled-editable .zip (terrain image, the
  // decoration sprite library, .tiled-project). Lossless: the JSON re-imports
  // unchanged after editing.
  const handleDownload = async () => {
    const parsed = getParsedJson();
    if (parsed.error || parsed.data === undefined) return;
    // Never export the empty template (or any map without complete terrain
    // data) - the kit would be unusable in Tiled
    const candidate = parsed.data as {
      width?: number;
      height?: number;
      layers?: { type?: string; data?: unknown[] }[];
    };
    const terrainLayer = candidate.layers?.find((l) => l.type === "tilelayer");
    const expectedTiles = (candidate.width ?? 0) * (candidate.height ?? 0);
    if (
      !terrainLayer?.data ||
      expectedTiles === 0 ||
      terrainLayer.data.length !== expectedTiles
    ) {
      setParseError(
        "The editor does not contain a complete map (the terrain layer is empty). Load a version from the History list below, then download again.",
      );
      return;
    }
    try {
      const [dbAssets, dbTerrains] = await Promise.all([
        utils.mapAsset.getAll.fetch(),
        utils.mapTerrain.getAll.fetch(),
      ]);
      const mergedAssets = [...mergeDecorationAssets(dbAssets).values()];
      const { missingSprites } = await downloadSectorForTiled(
        parsed.data,
        sector,
        mergedAssets,
        mergeTerrainSpecs(dbTerrains),
      );
      if (missingSprites.length > 0) {
        setParseError(
          `The kit is missing ${missingSprites.length} decoration sprite(s) the CDN failed to serve (${missingSprites.join(", ")}). Please download again to get a complete kit.`,
        );
      }
    } catch (error) {
      setParseError(
        error instanceof Error ? error.message : "Could not build the download",
      );
    }
  };

  if (!userData) return <Loader explanation="Loading userdata" />;

  if (!canEdit) {
    return (
      <ContentBox
        title="Sector Maps"
        subtitle="Content"
        defaultBackHref="/manual/world"
      >
        You do not have access to edit sector maps.
      </ContentBox>
    );
  }

  const busy = isPreviewing || isSaving || isPublishing || isArchiving;
  // Unsaved changes: the editor differs from what it was seeded with. Drives
  // the status line and which action buttons are relevant to show at all.
  const isDirty =
    baseline !== null && (jsonText !== baseline.json || name !== baseline.name);
  const statusText = (() => {
    if (!sourceLabel) return "";
    if (sourceLabel.kind === "upload") {
      return isDirty
        ? `Uploaded "${sourceLabel.fileName}" — not saved yet`
        : `Uploaded "${sourceLabel.fileName}"`;
    }
    if (sourceLabel.kind === "version") {
      return isDirty
        ? `Editing v${sourceLabel.version} (${sourceLabel.status.toLowerCase()}) — unsaved changes`
        : `Viewing v${sourceLabel.version} (${sourceLabel.status.toLowerCase()}) — no unsaved changes`;
    }
    return isDirty
      ? "New map — not saved yet"
      : "Empty template — upload a map or edit the JSON to begin";
  })();

  return (
    <>
      <ContentBox
        title="Sector Maps"
        subtitle="Tiled imports"
        defaultBackHref="/manual/world"
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="sector-map-sector">Sector</Label>
                <Input
                  id="sector-map-sector"
                  type="number"
                  min={0}
                  max={MAP_SECTOR_ID_MAX}
                  value={sector}
                  onChange={(event) => {
                    const nextSector = Math.min(
                      MAP_SECTOR_ID_MAX,
                      Math.max(0, Number(event.target.value) || 0),
                    );
                    setSector(nextSector);
                    setName((current) =>
                      current.startsWith("Sector ") ? `Sector ${nextSector}` : current,
                    );
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sector-map-name">Name</Label>
                <Input
                  id="sector-map-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <Label>Sector preview</Label>
                {sectorVillage && (
                  <span className="text-muted-foreground text-xs">
                    Drag a building to relocate it
                  </span>
                )}
              </div>
              {normalized.map ? (
                <div className="overflow-hidden rounded-md border">
                  <SectorPreview
                    map={normalized.map}
                    sector={sector}
                    decorationAssets={decorationAssets}
                    terrainRegistry={terrainRegistry}
                    structures={sectorVillage?.structures}
                    villageType={sectorVillage?.type ?? null}
                    onMoveStructure={(structure, target) =>
                      setPendingMove({
                        structureId: structure.id,
                        name: structure.name,
                        x: target.x,
                        y: target.y,
                      })
                    }
                  />
                </div>
              ) : (
                <div className="rounded-md border border-destructive/50 p-3 text-sm">
                  <p className="font-semibold">The map cannot be rendered:</p>
                  <ul className="list-disc pl-5">
                    {normalized.errors.slice(0, 8).map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
              {normalized.map && normalized.warnings.length > 0 && (
                <ul className="list-disc pl-5 text-amber-500 text-sm">
                  {normalized.warnings.slice(0, 4).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>

            <details className="rounded-md border p-2">
              <summary className="cursor-pointer text-muted-foreground text-sm">
                Tiled JSON (advanced)
              </summary>
              <textarea
                id="sector-map-json"
                className="mt-2 min-h-[18rem] w-full rounded-md border border-input bg-background p-3 font-mono text-sm shadow-xs"
                spellCheck={false}
                value={jsonText}
                onChange={(event) => {
                  // A manual edit must never be clobbered by the auto-load
                  autoLoadedSectorRef.current = sector;
                  setJsonText(event.target.value);
                  setPreview(null);
                  setParseError("");
                }}
              />
            </details>

            {statusText && (
              <p
                className={`text-sm ${isDirty ? "font-semibold text-amber-500" : "text-muted-foreground"}`}
              >
                {statusText}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="relative overflow-hidden"
                disabled={busy}
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload
                <input
                  type="file"
                  accept="application/json,.json"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(event) => void handleUpload(event.target.files?.[0])}
                />
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleDownload()}
                disabled={busy}
              >
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
              {/* Validate/Save/Publish only exist to push unsaved changes, so
                  they only appear when there are unsaved changes; Save/Publish
                  stay disabled while the map fails client-side validation */}
              {isDirty && (
                <>
                  <Button type="button" onClick={handlePreview} disabled={busy}>
                    <FileCheck className="mr-2 h-4 w-4" />
                    Validate
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleSave(false)}
                    disabled={busy || !normalized.map}
                    title={
                      normalized.map
                        ? undefined
                        : "Fix the validation errors shown above first"
                    }
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Save Draft
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleSave(true)}
                    disabled={busy || !normalized.map}
                    title={
                      normalized.map
                        ? undefined
                        : "Fix the validation errors shown above first"
                    }
                  >
                    <Rocket className="mr-2 h-4 w-4" />
                    Publish
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-2 font-semibold">
              <FileJson className="h-5 w-5" />
              Validation
            </div>
            {busy && <Loader explanation="Processing map" />}
            {parseError && <p className="text-red-500 text-sm">{parseError}</p>}
            {preview?.map && (
              <div className="space-y-1 text-sm">
                <p>
                  Size: {preview.map.width}x{preview.map.height}
                </p>
                <p>Tiles: {preview.map.tiles.length}</p>
                <p>Anchors: {preview.map.anchors.length}</p>
                <p>Exits: {preview.map.exits.length}</p>
              </div>
            )}
            {preview && preview.errors.length > 0 && (
              <div>
                <p className="font-semibold text-red-500">Errors</p>
                <ul className="list-disc pl-5 text-red-500 text-sm">
                  {preview.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
            {preview && preview.warnings.length > 0 && (
              <div>
                <p className="font-semibold text-amber-500">Warnings</p>
                <ul className="list-disc pl-5 text-amber-500 text-sm">
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </ContentBox>

      <br />

      <ContentBox
        title="History"
        subtitle={`Sector ${sector}`}
        topRightContent={
          <select
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as typeof statusFilter)
            }
          >
            <option value="ALL">All</option>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        }
      >
        {isFetching && <Loader explanation="Loading maps" />}
        {!isFetching && maps?.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No saved maps for this filter.
          </p>
        )}
        <div className="space-y-2">
          {maps?.map((map) => (
            <div
              key={map.id}
              className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_auto]"
            >
              <div className="text-sm">
                <div className="font-semibold">
                  {map.name} v{map.version}
                </div>
                <div className="text-muted-foreground">
                  Sector {map.sector} - {map.width}x{map.height} - {map.status}
                  {map.publishedBy?.username ? ` by ${map.publishedBy.username}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleLoadMap(map.id)}
                  disabled={busy}
                >
                  <FileJson className="mr-1 h-4 w-4" />
                  Load JSON
                </Button>
                {map.status !== "PUBLISHED" && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => publishMap({ id: map.id })}
                    disabled={busy}
                  >
                    <Rocket className="mr-1 h-4 w-4" />
                    Publish
                  </Button>
                )}
                {map.status !== "ARCHIVED" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => archiveMap({ id: map.id })}
                    disabled={busy}
                  >
                    <Archive className="mr-1 h-4 w-4" />
                    Archive
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </ContentBox>
      {pendingMove && (
        <Modal2
          title="Relocate structure"
          isOpen={!!pendingMove}
          setIsOpen={(open) => {
            if (!open) setPendingMove(null);
          }}
          proceed_label="Move it"
          isLoading={isMoving}
          onAccept={() =>
            moveStructure({
              structureId: pendingMove.structureId,
              longitude: pendingMove.x,
              latitude: pendingMove.y,
            })
          }
        >
          Move <b>{pendingMove.name}</b> to tile ({pendingMove.x}, {pendingMove.y}) in
          sector {sector}? This changes where every player finds the building.
        </Modal2>
      )}
    </>
  );
}

// useSearchParams requires a Suspense boundary during static rendering
export default function SectorMapEditor() {
  return (
    <Suspense fallback={<Loader explanation="Loading sector map editor" />}>
      <SectorMapEditorContent />
    </Suspense>
  );
}
