import { type MutableRefObject } from "react";
import { Scene, WebGLRenderer, WebGL1Renderer, Raycaster } from "three";
import { Vector2 } from "three";
import type { OrthographicCamera, PerspectiveCamera } from "three";
import { type Material } from "three";
import {
  Group,
  LineBasicMaterial,
  LineSegments,
  LinearFilter,
  Sprite,
  SpriteMaterial,
  Vector3,
  BufferGeometry,
  CanvasTexture,
} from "three";
import { IMG_AVATAR_DEFAULT, IMG_SECTOR_USER_SPRITE_MASK } from "@/drizzle/constants";
import { loadTexture } from "@/libs/threejs/util";
import type { GlobalPoint } from "@/libs/travel/types";

/**
 * Cleanup three.js scene and renderer, removing all objects, materials and geometries
 */
export const cleanUp = (scene: Scene, renderer: WebGLRenderer) => {
  scene.traverse(function (object) {
    if ("isMesh" in object || "isSprite" in object || "isLine" in object) {
      if ("material" in object) (object.material as Material).dispose();
      if ("geometry" in object) (object.geometry as BufferGeometry).dispose();
    }
  });
  renderer.dispose();
};

/**
 * Scene setup
 */
export const setupScene = (info: {
  mountRef: MutableRefObject<HTMLDivElement | null>;
  width: number;
  height: number;
  sortObjects: boolean;
  color: number;
  colorAlpha: number;
  width2height: number;
}) => {
  const scene = new Scene();
  const raycaster = new Raycaster();
  let renderer: WebGL1Renderer | WebGLRenderer | undefined;
  try {
    renderer = new WebGLRenderer();
  } catch (error) {
    console.error("Error creating WebGLRenderer, falling back to WebGL1Renderer");
    console.error(error);
    try {
      renderer = new WebGL1Renderer();
    } catch (error) {
      console.error("Error creating WebGL1Renderer, falling back to CanvasRenderer");
      console.error(error);
    }
  }

  if (renderer) {
    renderer.setSize(info.width, info.height);
    renderer.setClearColor(info.color, info.colorAlpha);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = false;
    renderer.sortObjects = info.sortObjects;
  }

  // Window size listener
  function handleResize() {
    if (info.mountRef.current) {
      const width = info.mountRef.current.getBoundingClientRect().width;
      const height = width * info.width2height;
      renderer?.setSize(width, height);
    }
  }
  window.addEventListener("resize", handleResize);

  // Return info
  return { scene, renderer, raycaster, handleResize };
};

export const setRaycasterFromMouse = (
  raycaster: Raycaster,
  sceneRef: HTMLDivElement,
  event: MouseEvent,
  camera: OrthographicCamera | PerspectiveCamera,
) => {
  const pointer = new Vector2();
  const width = sceneRef.getBoundingClientRect().width;
  const height = sceneRef.getBoundingClientRect().height;
  pointer.x = (event.offsetX / width) * 2 - 1;
  pointer.y = -(event.offsetY / height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
};

/**
 * Create a user avatar sprite for the global map
 */
export const createUserAvatarSprite = (info: {
  userData: {
    userId: string;
    sector: number;
    avatar: string | null;
    avatarLight: string | null;
  };
  sector: GlobalPoint;
  showLine: boolean;
  borderColor: string;
  distance: number;
}) => {
  const { userData, sector, borderColor = "white", distance } = info;
  if (!userData) return new Group();

  const group = new Group();

  // Distance from the surface
  const d = 3 - distance;

  // Create the line connecting to the surface
  if (info.showLine) {
    const points = [];
    points.push(new Vector3(sector.x / 3, sector.y / 3, sector.z / 3));
    points.push(new Vector3(sector.x / d, sector.y / d, sector.z / d));
    const lineMaterial = new LineBasicMaterial({
      color: "#000000",
      linewidth: 1,
    });
    const geometry = new BufferGeometry().setFromPoints(points);
    const line = new LineSegments(geometry, lineMaterial);
    group.add(line);
  }

  // Create white circular border sprite
  const borderCanvas = document.createElement("canvas");
  const borderSize = 64; // Size in pixels
  borderCanvas.width = borderSize;
  borderCanvas.height = borderSize;
  const borderContext = borderCanvas.getContext("2d");

  if (borderContext) {
    // Clear the canvas
    borderContext.clearRect(0, 0, borderSize, borderSize);

    // Draw white circle border
    const centerX = borderSize / 2;
    const centerY = borderSize / 2;
    const radius = borderSize / 2 - 2; // Leave some padding for the border

    borderContext.beginPath();
    borderContext.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    borderContext.fillStyle = borderColor;
    borderContext.fill();
  }

  const borderTexture = new CanvasTexture(borderCanvas);
  borderTexture.generateMipmaps = false;
  borderTexture.minFilter = LinearFilter;

  const borderMaterial = new SpriteMaterial({
    map: borderTexture,
    depthWrite: false,
    depthTest: false,
  });
  const borderSprite = new Sprite(borderMaterial);
  borderSprite.scale.set(1.2, 1.2, 1.2); // Slightly larger than avatar
  borderSprite.position.set(sector.x / d, sector.y / d, sector.z / d);
  group.add(borderSprite);

  // User avatar sprite
  const alphaMap = loadTexture(IMG_SECTOR_USER_SPRITE_MASK);
  const avatar = userData?.avatarLight || userData?.avatar || IMG_AVATAR_DEFAULT;
  const avatarTexture = loadTexture(avatar);
  avatarTexture.generateMipmaps = false;
  avatarTexture.minFilter = LinearFilter;
  const avatarMaterial = new SpriteMaterial({
    map: avatarTexture,
    alphaMap: alphaMap,
    depthWrite: false,
    depthTest: false,
  });
  const avatarSprite = new Sprite(avatarMaterial);
  avatarSprite.scale.set(1, 1, 1);
  avatarSprite.position.set(sector.x / d, sector.y / d, sector.z / d);
  group.add(avatarSprite);

  return group;
};
