import {
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import {
  FARM_GROWTH_STAGES,
  FARM_PLOT_COLUMNS,
  IMG_FARM_BACKGROUND,
  IMG_FARM_PLOT_SOIL,
} from "@/drizzle/constants";
import { createSpriteMaterial, loadTexture } from "@/libs/threejs/util";
import type { FarmEffect, FarmPlotState } from "@/validators/farming";

export const FARM_PLOT_SIZE = 1.8;
export const FARM_PLOT_GAP = 0.25;

export type PlotMeshEntry = {
  slotIndex: number;
  soil: Mesh;
  crop: Sprite | null;
  cropImage: string | null;
  growthStage: number | null;
  isReady: boolean;
  selectionRing: LineLoop | null;
  readyGlow: Sprite | null;
  hoverRing?: LineLoop | null;
  waterIndicator?: Sprite | null;
  fertilizerIndicator?: Sprite | null;
  animScale: number;
  animating: boolean;
};

export const getPlotGridPosition = (slotIndex: number, totalPlots: number) => {
  const col = slotIndex % FARM_PLOT_COLUMNS;
  const row = Math.floor(slotIndex / FARM_PLOT_COLUMNS);
  const rows = Math.ceil(totalPlots / FARM_PLOT_COLUMNS);
  const offsetX = ((FARM_PLOT_COLUMNS - 1) * (FARM_PLOT_SIZE + FARM_PLOT_GAP)) / 2;
  const offsetZ = ((rows - 1) * (FARM_PLOT_SIZE + FARM_PLOT_GAP)) / 2;
  return new Vector3(
    col * (FARM_PLOT_SIZE + FARM_PLOT_GAP) - offsetX,
    0,
    row * (FARM_PLOT_SIZE + FARM_PLOT_GAP) - offsetZ,
  );
};

export const createFarmGroups = () => ({
  background: new Group(),
  plots: new Group(),
  crops: new Group(),
  effects: new Group(),
  ui: new Group(),
});

export const drawFarmBackground = (
  group: Group,
  viewportWidth: number,
  viewportHeight: number,
) => {
  while (group.children.length > 0) {
    const child = group.children[0];
    if (!child) break;
    group.remove(child);
    if ("geometry" in child && child.geometry) {
      (child.geometry as BufferGeometry).dispose();
    }
    if ("material" in child && child.material) {
      (child.material as MeshBasicMaterial).dispose();
    }
  }

  const backgroundTexture = loadTexture(IMG_FARM_BACKGROUND);
  const material = new MeshBasicMaterial({
    map: backgroundTexture,
    side: DoubleSide,
  });
  const plane = new Mesh(new PlaneGeometry(viewportWidth, viewportHeight), material);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -0.01;
  group.add(plane);
};

export const createPlotMesh = (
  slotIndex: number,
  totalPlots: number,
): PlotMeshEntry => {
  const position = getPlotGridPosition(slotIndex, totalPlots);
  const soilTexture = loadTexture(IMG_FARM_PLOT_SOIL);
  const soilMaterial = new MeshBasicMaterial({
    map: soilTexture,
    side: DoubleSide,
    transparent: true,
    alphaTest: 0.1,
  });
  const soil = new Mesh(
    new PlaneGeometry(FARM_PLOT_SIZE, FARM_PLOT_SIZE),
    soilMaterial,
  );
  soil.rotation.x = -Math.PI / 2;
  soil.position.copy(position);
  soil.position.y = 0.01;
  soil.userData.slotIndex = slotIndex;

  return {
    slotIndex,
    soil,
    crop: null,
    cropImage: null,
    growthStage: null,
    isReady: false,
    selectionRing: null,
    readyGlow: null,
    hoverRing: null,
    waterIndicator: null,
    fertilizerIndicator: null,
    animScale: 1,
    animating: false,
  };
};

const getCropScaleForStage = (stage: number, isReady: boolean) => {
  if (isReady) return 1.1;
  const normalized = Math.max(1, Math.min(FARM_GROWTH_STAGES, stage));
  return 0.45 + (normalized / FARM_GROWTH_STAGES) * 0.55;
};

export const syncPlotVisual = (
  entry: PlotMeshEntry,
  plot: FarmPlotState | undefined,
  groups: { crops: Group; effects: Group },
) => {
  const position = entry.soil.position;
  const cropImage = plot?.seedItemId ? plot.cropImage : null;

  if (!plot?.seedItemId || !cropImage) {
    if (entry.crop) {
      groups.crops.remove(entry.crop);
      entry.crop = null;
    }
    if (entry.readyGlow) {
      groups.effects.remove(entry.readyGlow);
      entry.readyGlow = null;
    }
    removeStatusIndicator(entry, "waterIndicator", groups.effects);
    removeStatusIndicator(entry, "fertilizerIndicator", groups.effects);
    entry.cropImage = null;
    entry.growthStage = null;
    entry.isReady = false;
    return;
  }

  const imageChanged = entry.cropImage !== cropImage;
  const stageChanged = entry.growthStage !== plot.growthStage;
  const readinessChanged = entry.isReady !== plot.isReady;
  const scale = getCropScaleForStage(plot.growthStage, plot.isReady);

  if (!entry.crop) {
    const material = createSpriteMaterial(loadTexture(cropImage));
    entry.crop = new Sprite(material);
    entry.crop.userData.slotIndex = entry.slotIndex;
    groups.crops.add(entry.crop);
  } else if (imageChanged) {
    entry.crop.material = createSpriteMaterial(loadTexture(cropImage));
  }

  if (imageChanged || stageChanged || readinessChanged) {
    entry.crop.scale.set(scale, scale, 1);
  }
  entry.crop.position.set(position.x, 0.5, position.z);

  syncStatusIndicator(
    entry,
    "waterIndicator",
    !!plot.canWater,
    0x38bdf8,
    -0.72,
    groups.effects,
  );
  syncStatusIndicator(
    entry,
    "fertilizerIndicator",
    plot.fertilizerApplied,
    0xf59e0b,
    0.72,
    groups.effects,
  );

  if (plot.isReady) {
    if (!entry.readyGlow) {
      const glowTexture = loadTexture(cropImage);
      const glowMat = createSpriteMaterial(glowTexture, undefined, {
        opacity: 0.35,
        transparent: true,
        color: new Color(0xffd700),
      });
      entry.readyGlow = new Sprite(glowMat);
      groups.effects.add(entry.readyGlow);
    } else if (imageChanged) {
      entry.readyGlow.material = createSpriteMaterial(
        loadTexture(cropImage),
        undefined,
        {
          opacity: 0.35,
          transparent: true,
          color: new Color(0xffd700),
        },
      );
    }
    if (imageChanged || stageChanged || readinessChanged) {
      entry.readyGlow.scale.set(scale * 1.35, scale * 1.35, 1);
    }
    entry.readyGlow.position.set(position.x, 0.48, position.z);
  } else if (entry.readyGlow) {
    groups.effects.remove(entry.readyGlow);
    entry.readyGlow = null;
  }

  entry.cropImage = cropImage;
  entry.growthStage = plot.growthStage;
  entry.isReady = plot.isReady;
};

type IndicatorKey = "waterIndicator" | "fertilizerIndicator";

const removeStatusIndicator = (
  entry: PlotMeshEntry,
  key: IndicatorKey,
  group: Group,
) => {
  const indicator = entry[key];
  if (!indicator) return;
  group.remove(indicator);
  (indicator.material as SpriteMaterial).dispose();
  entry[key] = null;
};

const syncStatusIndicator = (
  entry: PlotMeshEntry,
  key: IndicatorKey,
  visible: boolean,
  color: number,
  offsetX: number,
  group: Group,
) => {
  if (!visible) {
    removeStatusIndicator(entry, key, group);
    return;
  }
  let indicator = entry[key];
  if (!indicator) {
    indicator = new Sprite(
      new SpriteMaterial({ color, opacity: 0.95, transparent: true }),
    );
    indicator.userData.status = key === "waterIndicator" ? "waterable" : "fertilized";
    indicator.scale.set(0.28, 0.28, 1);
    entry[key] = indicator;
    group.add(indicator);
  }
  indicator.position.set(
    entry.soil.position.x + offsetX,
    0.72,
    entry.soil.position.z - 0.72,
  );
};

export const updatePlotSelectionRing = (
  entry: PlotMeshEntry,
  groups: { effects: Group },
  selected: boolean,
) => {
  if (entry.selectionRing) {
    groups.effects.remove(entry.selectionRing);
    entry.selectionRing.geometry.dispose();
    (entry.selectionRing.material as MeshBasicMaterial).dispose();
    entry.selectionRing = null;
  }
  if (!selected) return;

  const half = FARM_PLOT_SIZE * 0.55;
  const pos = entry.soil.position;
  const points = [
    new Vector3(pos.x - half, 0.06, pos.z - half),
    new Vector3(pos.x + half, 0.06, pos.z - half),
    new Vector3(pos.x + half, 0.06, pos.z + half),
    new Vector3(pos.x - half, 0.06, pos.z + half),
  ];
  const geometry = new BufferGeometry().setFromPoints(points);
  const material = new MeshBasicMaterial({ color: 0x4ade80 });
  const ring = new LineLoop(geometry, material);
  groups.effects.add(ring);
  entry.selectionRing = ring;
};

export const updatePlotHoverRing = (
  entry: PlotMeshEntry,
  groups: { effects: Group },
  hovered: boolean,
) => {
  if (entry.hoverRing) {
    groups.effects.remove(entry.hoverRing);
    entry.hoverRing.geometry.dispose();
    (entry.hoverRing.material as MeshBasicMaterial).dispose();
    entry.hoverRing = null;
  }
  const material = entry.soil.material as MeshBasicMaterial;
  material.color.setHex(hovered ? 0xe2f7d3 : 0xffffff);
  if (!hovered) return;
  const half = FARM_PLOT_SIZE * 0.51;
  const pos = entry.soil.position;
  const geometry = new BufferGeometry().setFromPoints([
    new Vector3(pos.x - half, 0.055, pos.z - half),
    new Vector3(pos.x + half, 0.055, pos.z - half),
    new Vector3(pos.x + half, 0.055, pos.z + half),
    new Vector3(pos.x - half, 0.055, pos.z + half),
  ]);
  entry.hoverRing = new LineLoop(geometry, new MeshBasicMaterial({ color: 0xf8fafc }));
  entry.hoverRing.userData.status = "hover";
  groups.effects.add(entry.hoverRing);
};

export const animatePlotEntries = (
  entries: PlotMeshEntry[],
  delta: number,
  reducedMotion = false,
) => {
  for (const entry of entries) {
    if (entry.animating) {
      entry.animScale = reducedMotion ? 1 : Math.min(1, entry.animScale + delta * 2.5);
      entry.soil.scale.set(entry.animScale, entry.animScale, 1);
      const mat = entry.soil.material as MeshBasicMaterial;
      mat.transparent = true;
      mat.opacity = Math.min(1, entry.animScale);
      if (entry.animScale >= 1) entry.animating = false;
    }
    if (entry.readyGlow && !reducedMotion) {
      const base = entry.crop?.scale.x ?? 1;
      const pulse = 1 + Math.sin(Date.now() / 250) * 0.08;
      entry.readyGlow.scale.set(base * 1.35 * pulse, base * 1.35 * pulse, 1);
    }
  }
};

const FARM_EFFECT_COLORS: Record<FarmEffect, number> = {
  plant: 0x4ade80,
  water: 0x38bdf8,
  fertilize: 0xf59e0b,
  harvest: 0xfde047,
  expand: 0xa78bfa,
  level: 0xfbbf24,
};

export const startFarmEffect = (
  group: Group,
  entry: PlotMeshEntry,
  effect: FarmEffect,
  reducedMotion = false,
) => {
  if (reducedMotion) return null;
  const material = new MeshBasicMaterial({
    color: FARM_EFFECT_COLORS[effect],
    opacity: 0.8,
    transparent: true,
    side: DoubleSide,
  });
  const mesh = new Mesh(new CircleGeometry(0.65, 24), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(entry.soil.position.x, 0.08, entry.soil.position.z);
  mesh.scale.setScalar(0.2);
  mesh.userData.farmEffect = effect;
  mesh.userData.age = 0;
  group.add(mesh);
  return mesh;
};

export const animateFarmEffects = (group: Group, delta: number) => {
  for (const child of [...group.children]) {
    if (!child.userData.farmEffect) continue;
    child.userData.age = Number(child.userData.age ?? 0) + delta;
    const age = child.userData.age as number;
    child.scale.setScalar(0.2 + age * 1.8);
    const material = (child as Mesh).material as MeshBasicMaterial;
    material.opacity = Math.max(0, 0.8 - age);
    if (age >= 0.8) {
      group.remove(child);
      (child as Mesh).geometry.dispose();
      material.dispose();
    }
  }
};

export const startPlotExpandAnimation = (entry: PlotMeshEntry) => {
  entry.animScale = 0.01;
  entry.animating = true;
  entry.soil.scale.set(0.01, 0.01, 1);
  const mat = entry.soil.material as MeshBasicMaterial;
  mat.transparent = true;
  mat.opacity = 0;
};
