import { type Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { WORLD_NIGHT_BRIGHTNESS } from "@/drizzle/constants";
import { getWorldCycleBrightness } from "@/libs/dayNight";

export const updateDayNightOverlay = (
  overlay: Mesh,
  brightness = getWorldCycleBrightness(),
  enabled = true,
) => {
  const material = overlay.material as MeshBasicMaterial;
  if (!enabled) {
    material.opacity = 0;
    overlay.visible = false;
    return;
  }
  overlay.visible = true;
  const darkness = Math.max(0, Math.min(1, 1 - brightness));
  material.opacity = darkness * (1 - WORLD_NIGHT_BRIGHTNESS + 0.15);
};

export const createGroundDayNightOverlay = (group: Group, size = 40) => {
  const material = new MeshBasicMaterial({
    color: 0x0a1030,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const overlay = new Mesh(new PlaneGeometry(size, size), material);
  overlay.rotation.x = -Math.PI / 2;
  overlay.position.y = 0.08;
  group.add(overlay);
  return overlay;
};

export const applyCanvasDayNightBrightness = (
  element: HTMLElement | null | undefined,
  brightness = getWorldCycleBrightness(),
  enabled = true,
) => {
  if (!element) return;
  if (!enabled) {
    element.style.filter = "brightness(1.000)";
    return;
  }
  element.style.filter = `brightness(${brightness.toFixed(3)})`;
};
