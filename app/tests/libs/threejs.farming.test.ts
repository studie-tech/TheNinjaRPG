import { describe, expect, it, vi } from "vitest";
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
} from "three";
import {
  animateFarmEffects,
  type PlotMeshEntry,
  startFarmEffect,
  syncPlotVisual,
  updatePlotHoverRing,
} from "@/libs/threejs/farming";
import type { FarmPlotState } from "@/validators/farming";

const createPlot = (patch: Partial<FarmPlotState> = {}): FarmPlotState => ({
  id: "plot-1",
  slotIndex: 0,
  seedItemId: "seed-1",
  seedName: "Seed",
  cropName: "Crop",
  cropImage: "crop.webp",
  plantedAt: new Date("2026-01-01T00:00:00Z"),
  finishAt: new Date("2026-01-01T01:00:00Z"),
  lastWateredAt: null,
  fertilizerApplied: false,
  isReady: false,
  canWater: true,
  nextWateringAt: null,
  growthProgress: 25,
  growthStage: 2,
  ...patch,
});

const createEntry = (crop: Sprite, readyGlow: Sprite | null = null): PlotMeshEntry => ({
  slotIndex: 0,
  soil: new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial()),
  crop,
  cropImage: "crop.webp",
  growthStage: 2,
  isReady: readyGlow !== null,
  selectionRing: null,
  readyGlow,
  animScale: 1,
  animating: false,
});

describe("syncPlotVisual", () => {
  it("reuses the crop sprite and shared material when the visual state is unchanged", () => {
    const material = new SpriteMaterial();
    material.userData.shared = true;
    const crop = new Sprite(material);
    const entry = createEntry(crop);
    const groups = { crops: new Group(), effects: new Group() };
    groups.crops.add(crop);
    const scaleSpy = vi.spyOn(crop.scale, "set");
    const disposeSpy = vi.spyOn(material, "dispose");

    syncPlotVisual(entry, createPlot(), groups);

    expect(entry.crop).toBe(crop);
    expect(entry.crop?.material).toBe(material);
    expect(scaleSpy).not.toHaveBeenCalled();
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it("updates stages and removes sprites without disposing shared materials", () => {
    const cropMaterial = new SpriteMaterial();
    cropMaterial.userData.shared = true;
    const glowMaterial = new SpriteMaterial();
    glowMaterial.userData.shared = true;
    const crop = new Sprite(cropMaterial);
    const glow = new Sprite(glowMaterial);
    const entry = createEntry(crop, glow);
    const groups = { crops: new Group(), effects: new Group() };
    groups.crops.add(crop);
    groups.effects.add(glow);
    const cropDisposeSpy = vi.spyOn(cropMaterial, "dispose");
    const glowDisposeSpy = vi.spyOn(glowMaterial, "dispose");

    syncPlotVisual(entry, createPlot({ growthStage: 3 }), groups);

    expect(entry.crop).toBe(crop);
    expect(entry.readyGlow).toBeNull();
    expect(crop.scale.x).toBeGreaterThan(0.5);

    syncPlotVisual(entry, undefined, groups);

    expect(entry.crop).toBeNull();
    expect(groups.crops.children).not.toContain(crop);
    expect(groups.effects.children).not.toContain(glow);
    expect(cropDisposeSpy).not.toHaveBeenCalled();
    expect(glowDisposeSpy).not.toHaveBeenCalled();
  });

  it("adds water, fertilizer, and hover indicators and removes stale status", () => {
    const crop = new Sprite(new SpriteMaterial());
    const entry = createEntry(crop);
    const groups = { crops: new Group(), effects: new Group() };
    groups.crops.add(crop);

    syncPlotVisual(entry, createPlot({ canWater: true, fertilizerApplied: true }), groups);
    updatePlotHoverRing(entry, groups, true);

    expect(entry.waterIndicator?.userData.status).toBe("waterable");
    expect(entry.fertilizerIndicator?.userData.status).toBe("fertilized");
    expect(entry.hoverRing?.userData.status).toBe("hover");

    syncPlotVisual(entry, undefined, groups);
    updatePlotHoverRing(entry, groups, false);
    expect(entry.waterIndicator).toBeNull();
    expect(entry.fertilizerIndicator).toBeNull();
    expect(entry.hoverRing).toBeNull();
  });

  it("creates action effects and cleans them up after animation", () => {
    const entry = createEntry(new Sprite(new SpriteMaterial()));
    const effects = new Group();
    const effect = startFarmEffect(effects, entry, "water");

    expect(effect?.userData.farmEffect).toBe("water");
    expect(effects.children).toContain(effect);
    animateFarmEffects(effects, 1);
    expect(effects.children).not.toContain(effect);
  });
});
