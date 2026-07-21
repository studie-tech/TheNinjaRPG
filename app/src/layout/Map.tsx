import * as TWEEN from "@tweenjs/tween.js";
import alea from "alea";
import { ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector2,
  Vector3,
} from "three";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  IMG_BADGE_MOVE_TO_LOCATION,
  IMG_MAP_QUEST_ICON,
  IMG_MAP_TILESET_ATLAS,
  IMG_MAP_WAR_ICON,
  MAP_RESERVED_SECTORS,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
} from "@/drizzle/constants";
import type { Village } from "@/drizzle/schema";
import { useTutorialStep } from "@/hooks/tutorial";
import WebGlError from "@/layout/WebGLError";
import type { HexagonalFaceMesh } from "@/libs/hexgrid";
import { buildGlobeTileGeometry, createUserAvatarSprite } from "@/libs/threejs/globe";
import { TrackballControls } from "@/libs/threejs/TrackBallControls";
import type { GlobalMapData, GlobalPoint, GlobalTile } from "@/libs/threejs/types";
import {
  cleanUp,
  createTexture,
  isRendererContextValid,
  loadTexture,
  safeRemoveRendererElement,
  setupContextLossHandling,
  setupScene,
} from "@/libs/threejs/util";
import { useUserData } from "@/utils/UserContext";

interface MapProps {
  highlights?: Village[];
  usersHighlighted?: {
    userId: string;
    sector: number;
    avatar: string | null;
    avatarLight: string | null;
  }[];
  userLocation?: boolean;
  intersection: boolean;
  hexasphere: GlobalMapData;
  showOwnership?: boolean;
  /** Slowly spin the globe while the user is idle (default on) */
  autoRotate?: boolean;
  actionExplanation?: string;
  focusSector?: number | null;
  focusSectorLabel?: string;
  onTileClick?: (sector: number | null, tile: GlobalTile | null) => void;
  onTileHover?: (sector: number | null, tile: GlobalTile | null) => void;
}

const GlobalMap: React.FC<MapProps> = (props) => {
  const { data: userData } = useUserData();
  const [webglError, setWebglError] = useState<boolean>(false);
  const [hoverSector, setHoverSector] = useState<number | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  // Bridges the overlay zoom buttons into the three.js scene built below
  const zoomActionRef = useRef<((factor: number) => void) | null>(null);
  const mouse = new Vector2();
  const { hexasphere, showOwnership } = props;
  const autoRotate = props.autoRotate ?? true;
  const actionExplanation =
    props.actionExplanation || "Double click tile to move there";

  // Get sector ownerships if needed
  const { data: ownershipData } = api.village.getSectorOwnerships.useQuery(
    { onlyOwnWar: true },
    { enabled: showOwnership },
  );

  // Create a ref to store active war sectors
  const activeSectorWarsRef = useRef<number[]>([]);

  // Update active war sectors when ownership data changes
  useEffect(() => {
    if (ownershipData?.wars) {
      activeSectorWarsRef.current = ownershipData.wars.map((war) => war.sector);
    }
  }, [ownershipData]);

  const onDocumentMouseMove = (event: MouseEvent) => {
    if (mountRef.current) {
      const bounding_box = mountRef.current.getBoundingClientRect();
      mouse.x = (event.offsetX / bounding_box.width) * 2 - 1;
      mouse.y = -((event.offsetY / bounding_box.height) * 2 - 1);
    }
  };

  // Track touch state for double-tap detection on mobile
  const lastTapRef = useRef<{ time: number; sector: number | null }>({
    time: 0,
    sector: null,
  });

  // Tutorial step
  const { currentStep } = useTutorialStep();
  const isTravelStep = currentStep?.title === "Travel";

  // Render the map
  const [atlasTexture, setAtlasTexture] = useState<Texture | null>(null);
  useEffect(() => {
    let cancelled = false;
    void new TextureLoader()
      .loadAsync(IMG_MAP_TILESET_ATLAS)
      .then((texture) => {
        if (cancelled) return;
        texture.colorSpace = SRGBColorSpace;
        texture.generateMipmaps = false;
        texture.minFilter = LinearFilter;
        setAtlasTexture(texture);
      })
      .catch((error) => {
        // The globe cannot render without its coastline atlas (served from the
        // CDN); surface the WebGL error UI instead of a silently blank map.
        if (cancelled) return;
        console.error("Failed to load the globe tileset atlas", error);
        setWebglError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Reference to the mount; the scene builds once the tile atlas is ready
    const sceneRef = mountRef.current;
    if (sceneRef && atlasTexture) {
      // Performance stats
      // const stats = new Stats();
      // document.body.appendChild(stats.dom);

      // Interacivity with mouse
      if (props.intersection) {
        sceneRef.addEventListener("mousemove", onDocumentMouseMove, false);
      }
      let intersected: HexagonalFaceMesh | undefined;

      const WIDTH = sceneRef.getBoundingClientRect().width;
      const HEIGHT = WIDTH;

      const fov = 75;
      const aspect = WIDTH / HEIGHT;
      const near = 0.5;
      const far = 1000;

      // Setup scene, renderer and raycaster. Unlike the other views, the globe
      // NEEDS render-list sorting: with sortObjects false three.js draws in
      // scene-graph order and ignores renderOrder entirely, and since
      // group_highlights is traversed before group_tiles the translucent sector
      // grid painted OVER every marker. Sorting makes the marker/label/pin
      // renderOrder tiers effective (~500 objects, negligible sort cost).
      const { scene, renderer, raycaster, handleResize } = setupScene({
        mountRef: mountRef,
        width: WIDTH,
        height: HEIGHT,
        sortObjects: true,
        color: 0x000000,
        colorAlpha: 0,
        width2height: 1,
      });

      // If no renderer, then we have an error with the browser, let the user know
      if (!renderer) {
        setWebglError(true);
        return;
      }

      // Create scene
      sceneRef.appendChild(renderer.domElement);
      // Canvas element (renderer is non-null past the guard above) - used to
      // toggle the pointer cursor while hovering sectors on the globe
      const hoverCanvas = renderer.domElement;

      // Track WebGL context loss to prevent shader errors on iOS mobile browsers
      // Clear texture caches when context is lost to free memory
      const contextHandlers = setupContextLossHandling(renderer, { clearCaches: true });

      // EDGE CASE DEFENSE: Double-check context is valid after setup
      // Even if renderer was created, the context might become invalid immediately on iOS
      if (!isRendererContextValid(renderer)) {
        console.error(
          "WebGL context became invalid immediately after setup - aborting scene creation",
        );
        // Clean up DOM element and event listeners before returning
        contextHandlers.cleanup();
        safeRemoveRendererElement(renderer, sceneRef);
        setWebglError(true);
        return;
      }

      // Setup camera
      const camera = new PerspectiveCamera(fov, aspect, near, far);

      // Random number gen
      const prng = alea(42);

      // Groups to hold items. three.js sorts by a group's renderOrder before any
      // per-object order or depth, so putting highlights in a later group makes
      // every marker (avatars, quest/war pins, labels) draw after the tiles AND
      // the translucent sector grid. Without it the draw order falls back to a
      // distance sort, which is unreliable here because the whole grid is one
      // object centred on the globe origin. depthTest still hides far-side
      // markers - this only decides who paints last, not what is occluded.
      const group_tiles = new Group();
      const group_highlights = new Group();
      group_highlights.renderOrder = 1;

      // Reusable bright outline that marks the hovered sector. The tile keeps
      // its own terrain colour - we only outline it and switch the cursor to a
      // pointer, signalling that a click there starts global travel.
      const hoverOutlineGeometry = new BufferGeometry();
      hoverOutlineGeometry.setAttribute(
        "position",
        new BufferAttribute(new Float32Array(8 * 3), 3),
      );
      const hoverOutline = new LineSegments(
        hoverOutlineGeometry,
        new LineBasicMaterial({
          color: 0xffd24a,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
          depthWrite: false,
        }),
      );
      hoverOutline.visible = false;
      hoverOutline.renderOrder = 2;
      group_highlights.add(hoverOutline);
      const HOVER_LIFT = 1.006; // just above the tile faces and the sector grid
      /**
       * Reposition the single reusable hover outline onto the given sector's
       * quad corners (divided by 3 to match the globe's render scale and
       * lifted by HOVER_LIFT above the tile faces and sector grid to avoid
       * z-fighting). Hidden for null or non-quad tiles.
       */
      const setHoverOutline = (sector: number | null) => {
        const tile = sector !== null ? hexasphere?.tiles[sector] : null;
        if (!tile || tile.b.length !== 4) {
          hoverOutline.visible = false;
          return;
        }
        const position = hoverOutlineGeometry.getAttribute("position")
          .array as Float32Array;
        const corner = tile.b.map((p) => ({
          x: (Number(p.x) / 3) * HOVER_LIFT,
          y: (Number(p.y) / 3) * HOVER_LIFT,
          z: (Number(p.z) / 3) * HOVER_LIFT,
        }));
        let i = 0;
        for (let k = 0; k < 4; k++) {
          const a = corner[k]!;
          const b = corner[(k + 1) % 4]!;
          position[i++] = a.x;
          position[i++] = a.y;
          position[i++] = a.z;
          position[i++] = b.x;
          position[i++] = b.y;
          position[i++] = b.z;
        }
        hoverOutlineGeometry.getAttribute("position").needsUpdate = true;
        hoverOutline.visible = true;
      };

      // Village labels and quest/war/focus pins double as travel shortcuts: a
      // single click/tap on one acts like clicking the sector it points at.
      // Populated further down where the sprites are created.
      const labelTargets: Sprite[] = [];

      /**
       * Sector of the closest label/pin under the given NDC point, or null.
       * Sprites still raycast when the globe occludes them, so a label hit
       * only counts when no tile sits in front of it along the same ray.
       */
      const pickLabelTarget = (point: Vector2): number | null => {
        if (labelTargets.length === 0) return null;
        raycaster.setFromCamera(point, camera);
        const labelHit = raycaster.intersectObjects(labelTargets, false)[0];
        if (!labelHit) return null;
        const tileHit = raycaster.intersectObjects(group_tiles.children)[0];
        if (tileHit && tileHit.distance < labelHit.distance) return null;
        const sector = labelHit.object.userData.sector as number;
        return typeof sector === "number" ? sector : null;
      };

      // Add on double click/tap tile handler
      let onDblClick: (() => void) | null = null;
      let onTouchEnd: ((e: TouchEvent) => void) | null = null;
      let onLabelPointerDown: ((e: PointerEvent) => void) | null = null;
      let onLabelPointerMove: ((e: PointerEvent) => void) | null = null;
      let onLabelPointerUp: ((e: PointerEvent) => void) | null = null;
      let onLabelPointerCancel: (() => void) | null = null;

      if (props.intersection && props.onTileClick) {
        // Desktop: double-click handler
        onDblClick = () => {
          const intersects = raycaster.intersectObjects(group_tiles.children);
          if (intersects.length > 0) {
            const sector = intersects?.[0]?.object?.userData?.id as number;
            const tile = hexasphere?.tiles[sector];
            if (tile !== undefined) {
              props.onTileClick?.(sector, tile);
            }
          }
        };
        renderer.domElement.addEventListener("dblclick", onDblClick, true);

        // Mobile: double-tap detection via touchend
        // We detect double-tap by checking if two taps happen within 300ms on the same sector
        onTouchEnd = (e: TouchEvent) => {
          if (e.changedTouches.length === 0) return;
          const touch = e.changedTouches[0];
          if (!touch) return;

          // Get which sector was tapped
          const bounding_box = sceneRef.getBoundingClientRect();
          const mouseX =
            ((touch.clientX - bounding_box.left) / bounding_box.width) * 2 - 1;
          const mouseY =
            -((touch.clientY - bounding_box.top) / bounding_box.height) * 2 + 1;
          raycaster.setFromCamera(new Vector2(mouseX, mouseY), camera);

          const intersects = raycaster.intersectObjects(group_tiles.children);
          if (intersects.length === 0) {
            lastTapRef.current = { time: 0, sector: null };
            return;
          }

          const sector = intersects?.[0]?.object?.userData?.id as number;
          const now = Date.now();
          const timeSinceLastTap = now - lastTapRef.current.time;
          const DOUBLE_TAP_DELAY = 300; // ms

          // Check if this is a double-tap on the same sector
          if (
            timeSinceLastTap < DOUBLE_TAP_DELAY &&
            lastTapRef.current.sector === sector
          ) {
            // Double-tap detected!
            const tile = hexasphere?.tiles[sector];
            if (tile !== undefined) {
              props.onTileClick?.(sector, tile);
            }
            // Reset to prevent triple-tap
            lastTapRef.current = { time: 0, sector: null };
          } else {
            // First tap - record it
            lastTapRef.current = { time: now, sector };
          }
        };
        renderer.domElement.addEventListener("touchend", onTouchEnd, { passive: true });

        // Single click/tap on a village label or map pin starts travel to the
        // sector it points at. Pointer events cover mouse and touch alike. A
        // gesture only counts as a tap when it was single-pointer for its whole
        // lifetime and the pointer never strayed from the start point - peak
        // displacement, not start-to-end, so a rotate drag that circles back
        // and a pinch whose primary finger barely moves both stay navigation.
        const TAP_SLOP_PX = 10;
        const tapGesture = { x: 0, y: 0, active: false, navigated: false };
        onLabelPointerDown = (e: PointerEvent) => {
          if (e.isPrimary) {
            // Only a touch/pen contact or the left mouse button can start a
            // tap; right/middle clicks are trackball input, never travel
            if (e.pointerType === "mouse" && e.button !== 0) {
              tapGesture.active = false;
              return;
            }
            tapGesture.active = true;
            tapGesture.navigated = false;
            tapGesture.x = e.clientX;
            tapGesture.y = e.clientY;
          } else {
            // A second finger arrived: the whole gesture is a pinch/zoom
            tapGesture.navigated = true;
          }
        };
        onLabelPointerMove = (e: PointerEvent) => {
          if (!tapGesture.active || tapGesture.navigated || !e.isPrimary) return;
          const moved = Math.hypot(e.clientX - tapGesture.x, e.clientY - tapGesture.y);
          if (moved > TAP_SLOP_PX) tapGesture.navigated = true;
        };
        onLabelPointerCancel = () => {
          tapGesture.active = false;
        };
        onLabelPointerUp = (e: PointerEvent) => {
          if (!e.isPrimary || !tapGesture.active) return;
          tapGesture.active = false;
          const moved = Math.hypot(e.clientX - tapGesture.x, e.clientY - tapGesture.y);
          if (tapGesture.navigated || moved > TAP_SLOP_PX) return;
          const bounding_box = sceneRef.getBoundingClientRect();
          const point = new Vector2(
            ((e.clientX - bounding_box.left) / bounding_box.width) * 2 - 1,
            -((e.clientY - bounding_box.top) / bounding_box.height) * 2 + 1,
          );
          const sector = pickLabelTarget(point);
          const tile = sector !== null ? hexasphere?.tiles[sector] : undefined;
          if (sector !== null && tile) {
            props.onTileClick?.(sector, tile);
          }
        };
        renderer.domElement.addEventListener("pointerdown", onLabelPointerDown);
        renderer.domElement.addEventListener("pointermove", onLabelPointerMove);
        renderer.domElement.addEventListener("pointerup", onLabelPointerUp);
        renderer.domElement.addEventListener("pointercancel", onLabelPointerCancel);
      }

      // Flat textured globe: every tile is a sea-level quad textured through the
      // Kenney coastline atlas. Alongside the tiles we collect each tile's quad
      // boundary into a single light wireframe so the sectors (zones) read
      // clearly. The atlas texture is pre-loaded before this scene builds.
      const edgePositions: number[] = [];
      const EDGE_LIFT = 1.0015; // sit the outline just above the tile faces
      for (let i = 0; i < hexasphere.tiles.length; i++) {
        const t = hexasphere.tiles[i];
        const built = t && buildGlobeTileGeometry(hexasphere, t, prng());
        if (t && built) {
          const geometry = new BufferGeometry();
          geometry.setAttribute("position", new BufferAttribute(built.positions, 3));
          geometry.setAttribute("uv", new BufferAttribute(built.uvs, 2));

          // Ownership view tints the tile texture by owning village
          let color: string | number = 0xffffff;
          if (showOwnership && ownershipData?.sectors && ownershipData?.colors) {
            const ownership = ownershipData.sectors.find((s) => s.sector === i);
            const villageColor = ownershipData.colors.find(
              (v) => v.id === ownership?.villageId,
            );
            if (MAP_RESERVED_SECTORS.includes(i)) {
              color = "#b3afae";
            }
            if (villageColor) {
              color = villageColor.hexColor;
            }
          }
          const material = new MeshBasicMaterial({
            color,
            map: atlasTexture,
            side: DoubleSide,
          });

          const mesh = new Mesh(geometry, material);
          mesh.matrixAutoUpdate = false;
          mesh.userData.id = i;
          mesh.name = `${i}`;
          group_tiles.add(mesh);

          // Quad boundary (corners NW,NE,SE,SW), lifted just above the surface,
          // for the sector-separation wireframe
          const corner = t.b.map((p) => ({
            x: (Number(p.x) / 3) * EDGE_LIFT,
            y: (Number(p.y) / 3) * EDGE_LIFT,
            z: (Number(p.z) / 3) * EDGE_LIFT,
          }));
          for (let k = 0; k < 4; k++) {
            const a = corner[k]!;
            const b = corner[(k + 1) % 4]!;
            edgePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
        }
      }

      // Light sector-separation grid overlaid on the globe. Occluded by the
      // opaque tiles on the far side (depthTest), so only front edges show.
      if (edgePositions.length > 0) {
        const edgeGeometry = new BufferGeometry();
        edgeGeometry.setAttribute(
          "position",
          new BufferAttribute(new Float32Array(edgePositions), 3),
        );
        const edgeLines = new LineSegments(
          edgeGeometry,
          new LineBasicMaterial({
            color: 0xf2f6fb,
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
          }),
        );
        edgeLines.matrixAutoUpdate = false;
        edgeLines.userData.type = "sector-edges";
        // The grid shares group_tiles for draw order but must never be a
        // raycast target, or it would shadow the tile under the cursor (it has
        // no sector id), breaking hover highlighting and click-to-travel.
        edgeLines.raycast = () => {};
        group_tiles.add(edgeLines);
      }

      // Add highlighted users (bounty targets) to the map
      if (props.usersHighlighted) {
        props.usersHighlighted.forEach((user) => {
          const sector = hexasphere?.tiles[user.sector]?.c;
          if (sector) {
            const userAvatarGroup = createUserAvatarSprite({
              userData: user,
              sector,
              borderColor: "red",
              // Float just above the surface so depthTest hides far-side markers
              // without z-fighting the tile it sits on
              distance: 0.5,
              showLine: false,
            });
            group_highlights.add(userAvatarGroup);
          }
        });
      }

      // Next we add highlights
      if (props.highlights) {
        // Loop through the highlights
        props.highlights
          .filter(
            (h) =>
              h.type !== "HIDEOUT" ||
              userData?.clan?.villageId === h.id ||
              showOwnership,
          )
          .forEach((highlight) => {
            const sector = hexasphere?.tiles[highlight.sector]?.c;
            if (sector) {
              // Create the line
              const points = [];
              points.push(new Vector3(sector.x / 3, sector.y / 3, sector.z / 3));
              points.push(new Vector3(sector.x / 2.5, sector.y / 2.5, sector.z / 2.5));
              const lineMaterial = new LineBasicMaterial({
                color: "#000000",
                linewidth: 1,
              });
              const geometry = new BufferGeometry().setFromPoints(points);
              const line = new LineSegments(geometry, lineMaterial);
              group_highlights.add(line);
              // Label
              const canvas = document.createElement("canvas");
              const [w, h, r, f] = [100, 40, 4, 42 - highlight.name.length * 2];
              canvas.width = w;
              canvas.height = h;
              const context = canvas.getContext("2d");
              if (context) {
                context.globalAlpha = 0.9;
                context.fillStyle = highlight.hexColor;
                context.lineWidth = 4;
                context.strokeStyle = "black";
                if (context.roundRect) {
                  context.roundRect(r / 2, r / 2, w - r, h - r, r);
                } else {
                  context.rect(r / 2, r / 2, w - r, h - r);
                }
                context.stroke();
                context.fill();
                context.globalAlpha = 1.0;
                context.textAlign = "center";
                context.textBaseline = "middle";
                context.fillStyle = "black";
                context.strokeStyle = "#F0F0F0";
                context.font = `${f}px arial narrow`;
                context.strokeText(highlight.mapName || highlight.name, w / 2, h / 2);
                context.fillText(highlight.mapName || highlight.name, w / 2, h / 2);
              }
              const texture = createTexture(canvas);
              texture.generateMipmaps = false;
              texture.minFilter = LinearFilter;
              texture.needsUpdate = true;
              const bar_material = new SpriteMaterial({
                map: texture,
                // Canvas-drawn label on a transparent background: without this it
                // renders in the opaque pass (boxed background, and the sector
                // grid draws over it)
                transparent: true,
                depthWrite: false,
              });
              const labelSprite = new Sprite(bar_material);
              // Explicit order so labels always draw after the sector grid (see
              // createUserAvatarSprite for why group order alone is not enough)
              labelSprite.renderOrder = 2;
              labelSprite.scale.set(canvas.width / 40, canvas.height / 40, 1);
              labelSprite.position.set(sector.x / 2.5, sector.y / 2.5, sector.z / 2.5);
              labelSprite.userData.sector = highlight.sector;
              labelTargets.push(labelSprite);
              group_highlights.add(labelSprite);
            }
          });
      }

      scene.add(group_highlights);
      scene.add(group_tiles);

      // Add tweening highlights
      const questTweenColor = { r: 0.8, g: 0.6, b: 0.0 };
      const warTweenColor = { r: 1.0, g: 0.0, b: 0.0 }; // Red color for war zones
      const focusTweenColor = { r: 0.66, g: 0.33, b: 0.97 }; // Purple color for focus sector
      const sectorsToHighlight: {
        sector: number;
        color: typeof questTweenColor;
        type: "quest" | "war" | "focus";
        // Resolved lazily on the first frame and cached, so the render loop does
        // not re-scan group_tiles' ~486 children by name every frame. undefined =
        // not yet resolved, null = resolved but no matching mesh (do not retry).
        mesh?: HexagonalFaceMesh | null;
      }[] = [];

      // Add war-torn battleground sector to highlight
      sectorsToHighlight.push({
        sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR,
        color: warTweenColor,
        type: "war",
      });

      // Add war sectors to highlight
      if (activeSectorWarsRef.current.length > 0) {
        activeSectorWarsRef.current.forEach((warSector) => {
          sectorsToHighlight.push({
            sector: warSector,
            color: warTweenColor,
            type: "war",
          });
        });
      }

      // Add focus sector to highlight
      if (props.focusSector !== undefined && props.focusSector !== null) {
        sectorsToHighlight.push({
          sector: props.focusSector,
          color: focusTweenColor,
          type: "focus",
        });
      }

      // Add user avatar sprite instead of coloring the hexagon
      const userSector = userData && hexasphere?.tiles[userData.sector]?.c;
      if (userSector) {
        const userAvatarGroup = createUserAvatarSprite({
          userData,
          sector: userSector,
          borderColor: "white",
          distance: 0.5,
          showLine: true,
        });
        group_highlights.add(userAvatarGroup);
      }

      if (props.userLocation && userData && userData.userQuests && !showOwnership) {
        userData.userQuests.forEach((userquest) => {
          userquest.quest.content.objectives.forEach((objective) => {
            const isHidden = "hideLocation" in objective && objective.hideLocation;
            const isDialog = objective.task === "dialog";
            if ("sector" in objective && objective.sector && !isHidden && !isDialog) {
              sectorsToHighlight.push({
                sector: objective.sector,
                color: questTweenColor,
                type: "quest",
              });
            }
          });
        });
        new TWEEN.Tween(questTweenColor)
          .to({ r: 0.0, g: 0.0, b: 0.0 }, 1000)
          .repeat(Infinity)
          .easing(TWEEN.Easing.Cubic.InOut)
          .start();
        new TWEEN.Tween(warTweenColor)
          .to({ r: 0.4, g: 0.0, b: 0.0 }, 1000)
          .repeat(Infinity)
          .easing(TWEEN.Easing.Cubic.InOut)
          .start();
        new TWEEN.Tween(focusTweenColor)
          .to({ r: 0.33, g: 0.17, b: 0.5 }, 1000)
          .repeat(Infinity)
          .easing(TWEEN.Easing.Cubic.InOut)
          .start();
      }

      // Highlighted GPS pins for quests and wars
      sectorsToHighlight.forEach((highlight) => {
        const hasLabel = props.highlights?.find((h) => h.sector === highlight.sector);
        const sector = hexasphere?.tiles[highlight.sector]?.c;
        if (!hasLabel && sector) {
          // Create the line
          const points = [];
          points.push(new Vector3(sector.x / 3, sector.y / 3, sector.z / 3));
          points.push(new Vector3(sector.x / 2.5, sector.y / 2.5, sector.z / 2.5));
          const lineMaterial = new LineBasicMaterial({
            color: "#000000",
            linewidth: 1,
          });
          const geometry = new BufferGeometry().setFromPoints(points);
          const line = new LineSegments(geometry, lineMaterial);
          group_highlights.add(line);

          // Create icon sprite based on highlight type
          const iconUrl =
            highlight.type === "war"
              ? IMG_MAP_WAR_ICON
              : highlight.type === "focus"
                ? IMG_BADGE_MOVE_TO_LOCATION
                : IMG_MAP_QUEST_ICON;
          const texture = loadTexture(iconUrl);
          texture.generateMipmaps = false;
          texture.minFilter = LinearFilter;
          const iconMaterial = new SpriteMaterial({
            map: texture,
            // The icon art is alpha-cut; without this the sprite renders in the
            // OPAQUE pass, which draws before the translucent sector grid and so
            // lets the grid lines paint over the marker
            transparent: true,
            depthWrite: false,
            // Occlude quest/war pins that are on the globe's far side
            depthTest: true,
          });
          const iconSprite = new Sprite(iconMaterial);
          // Explicit order so quest/war pins always draw after the sector grid
          iconSprite.renderOrder = 2;
          iconSprite.scale.set(1, 1, 1);
          iconSprite.position.set(sector.x / 2.5, sector.y / 2.5, sector.z / 2.5);
          iconSprite.userData.sector = highlight.sector;
          labelTargets.push(iconSprite);
          group_highlights.add(iconSprite);
        }
      });

      //Enable controls
      const controls = new TrackballControls(camera, renderer.domElement);
      controls.noPan = true;
      controls.staticMoving = true;
      controls.zoomSpeed = 1.2;
      const cameraDistance = 22;
      // At distance 16 the tiles facing the camera render at twice their
      // default on-screen size, i.e. a 2x zoom - enough to tap the right
      // sector on mobile without the front village labels filling the view
      const minCameraDistance = 16;
      controls.minDistance = minCameraDistance;
      controls.maxDistance = cameraDistance;
      let lastTime = Date.now();
      let sigma = 0;
      let phi = 0;

      // Initial camera positioning - prioritize focus sector over user location
      if (props.focusSector !== undefined && props.focusSector !== null) {
        const focusSectorData = hexasphere?.tiles[props.focusSector]?.c;
        if (focusSectorData) {
          const { x, y, z } = focusSectorData;
          sigma = Math.atan2(y, x);
          phi = Math.acos(z / Math.sqrt(x * x + y * y + z * z));
        }
      } else if (props.userLocation && userData) {
        const sector = hexasphere?.tiles[userData.sector]?.c;
        if (sector) {
          const { x, y, z } = sector;
          sigma = Math.atan2(y, x);
          phi = Math.acos(z / Math.sqrt(x * x + y * y + z * z));
        }
      }

      // Place the camera before the first frame; the render loop keeps the
      // CURRENT distance from then on, so zooming is not undone each frame
      camera.position.set(
        cameraDistance * Math.sin(phi) * Math.cos(sigma),
        cameraDistance * Math.sin(phi) * Math.sin(sigma),
        cameraDistance * Math.cos(phi),
      );
      camera.lookAt(scene.position);

      // Zoom helper for the overlay buttons, clamped to the same distance
      // limits as the wheel/pinch zoom
      zoomActionRef.current = (factor: number) => {
        const distance = camera.position.length();
        if (distance === 0) return;
        const next = Math.min(
          Math.max(distance * factor, minCameraDistance),
          cameraDistance,
        );
        camera.position.multiplyScalar(next / distance);
      };

      // Render the image
      let animationId = 0;
      // Gate the ~486-mesh hover raycast: only re-run it when the pointer or the
      // camera pose actually changed since the last raycast (the globe auto-
      // rotates, so the camera moving is itself a reason to re-test). Skips the
      // full raycast on truly idle frames.
      let lastRaycastCamX = Number.NaN;
      let lastRaycastCamY = Number.NaN;
      let lastRaycastCamZ = Number.NaN;
      let lastRaycastMouseX = Number.NaN;
      let lastRaycastMouseY = Number.NaN;
      let hoveredLabelSector: number | null = null;
      function render() {
        // Update all TWEEN animations (color pulsing, etc.)
        TWEEN.update();

        // Apply highlight colors to sectors (mesh resolved once, then cached)
        if (sectorsToHighlight.length > 0) {
          sectorsToHighlight.forEach((highlight) => {
            if (highlight.mesh === undefined) {
              highlight.mesh =
                (group_tiles.getObjectByName(
                  `${highlight.sector}`,
                ) as HexagonalFaceMesh | null) ?? null;
            }
            const mesh = highlight.mesh;
            if (mesh) {
              const color =
                highlight.type === "war"
                  ? warTweenColor
                  : highlight.type === "focus"
                    ? focusTweenColor
                    : questTweenColor;
              mesh.material.color.setRGB(color.r, color.g, color.b);
            }
          });
        }
        // Intersections with mouse: https://threejs.org/docs/index.html#api/en/core/Raycaster
        const cameraOrPointerMoved =
          camera.position.x !== lastRaycastCamX ||
          camera.position.y !== lastRaycastCamY ||
          camera.position.z !== lastRaycastCamZ ||
          mouse.x !== lastRaycastMouseX ||
          mouse.y !== lastRaycastMouseY;
        if (props.intersection && cameraOrPointerMoved) {
          lastRaycastCamX = camera.position.x;
          lastRaycastCamY = camera.position.y;
          lastRaycastCamZ = camera.position.z;
          lastRaycastMouseX = mouse.x;
          lastRaycastMouseY = mouse.y;
          // Labels and pins take hover precedence over the tiles behind them;
          // hovering one outlines its target sector, matching what a click does
          const labelSector = pickLabelTarget(mouse);
          if (labelSector !== null) {
            if (hoveredLabelSector !== labelSector) {
              hoveredLabelSector = labelSector;
              intersected = undefined;
              setHoverOutline(labelSector);
              hoverCanvas.style.cursor = "pointer";
              const tile = hexasphere?.tiles[labelSector];
              if (props.onTileHover && tile) props.onTileHover(labelSector, tile);
              setHoverSector(labelSector);
            }
          } else {
            if (hoveredLabelSector !== null) {
              hoveredLabelSector = null;
              setHoverOutline(null);
              hoverCanvas.style.cursor = "default";
            }
            raycaster.setFromCamera(mouse, camera);
            const intersects = raycaster.intersectObjects(group_tiles.children);
            if (intersects.length > 0) {
              // if the closest object intersected is not the currently stored intersection object
              if (intersects[0] && intersects[0].object !== intersected) {
                intersected = intersects[0].object as HexagonalFaceMesh;
                const sector = intersected.userData.id;
                // Outline the hovered sector (its terrain colour is untouched) and
                // show a pointer, signalling a click starts global travel
                setHoverOutline(sector);
                hoverCanvas.style.cursor = "pointer";
                const tile = hexasphere?.tiles[sector];
                if (props.onTileHover && tile) props.onTileHover(sector, tile);
                setHoverSector(sector);
              }
            } else if (intersected) {
              // Pointer moved off the globe: clear the outline and the pointer
              intersected = undefined;
              setHoverOutline(null);
              hoverCanvas.style.cursor = "default";
            }
          }
        }

        // Rotate the camera, only if trackball not enabled && highlight not selected
        const current = controls.up0 as GlobalPoint;
        const previous = controls?.object as { up: GlobalPoint };
        const isUserInteracting =
          current.x !== previous.up.x ||
          current.y !== previous.up.y ||
          current.z !== previous.up.z;

        // Auto-rotate when not user interacting
        if (autoRotate && (animationId === 0 || !isTravelStep) && !isUserInteracting) {
          const dt = Date.now() - lastTime;
          const rotateCameraBy = (1 * Math.PI) / (50000 / dt);
          phi += rotateCameraBy;
        }
        lastTime = Date.now();

        // Update camera position when not user interacting. Keep the CURRENT
        // camera distance rather than the fixed default, so wheel/pinch/button
        // zoom is not undone on the next frame
        if (!isUserInteracting) {
          const distance = camera.position.length() || cameraDistance;
          camera.position.x = distance * Math.sin(phi) * Math.cos(sigma);
          camera.position.y = distance * Math.sin(phi) * Math.sin(sigma);
          camera.position.z = distance * Math.cos(phi);
          camera.lookAt(scene.position);
        }

        // Trackball updates
        controls.update();

        // Render the scene (skip if WebGL context is lost or invalid)
        animationId = requestAnimationFrame(render);
        if (!contextHandlers.isContextLost() && renderer) {
          renderer.render(scene, camera);
        }

        // Performance monitor
        // stats.update();
      }
      render();

      // Remove the intersection listener

      return () => {
        cancelAnimationFrame(animationId);
        zoomActionRef.current = null;

        // Remove event listeners safely
        try {
          if (props.intersection) {
            sceneRef.removeEventListener("mousemove", onDocumentMouseMove);
          }
          if (onDblClick) {
            renderer.domElement.removeEventListener("dblclick", onDblClick, true);
          }
          if (onTouchEnd) {
            renderer.domElement.removeEventListener("touchend", onTouchEnd);
          }
          if (onLabelPointerDown) {
            renderer.domElement.removeEventListener("pointerdown", onLabelPointerDown);
          }
          if (onLabelPointerMove) {
            renderer.domElement.removeEventListener("pointermove", onLabelPointerMove);
          }
          if (onLabelPointerUp) {
            renderer.domElement.removeEventListener("pointerup", onLabelPointerUp);
          }
          if (onLabelPointerCancel) {
            renderer.domElement.removeEventListener(
              "pointercancel",
              onLabelPointerCancel,
            );
          }
          controls.dispose();
          window.removeEventListener("resize", handleResize);
          contextHandlers.cleanup();
        } catch {
          // Ignore errors if elements are already removed
        }

        // Safely remove renderer DOM element
        safeRemoveRendererElement(renderer, sceneRef);

        cleanUp(scene, renderer);

        // Note: Do NOT call clearTextureCaches() here as it clears module-wide caches
        // that may be in use by other Map instances. Texture caches are shared across
        // all scenes for performance. Individual texture cleanup happens in cleanUp().
      };
    }
  }, [
    props.highlights,
    props.usersHighlighted,
    props.intersection,
    props.focusSector,
    showOwnership,
    ownershipData,
    atlasTexture,
    autoRotate,
  ]);

  return (
    // The overlay labels anchor to this wrapper (the map itself), so they sit
    // on the globe no matter what page embeds the component
    <div className="relative">
      <div ref={mountRef} id={"tutorial-global-map"}></div>
      {webglError && <WebGlError />}
      <div className="absolute top-0 left-0 m-5">
        <ul>
          {hoverSector && (
            <li className="flex flex-row items-center">
              <span className="mr-1 animate-pulse text-2xl text-orange-500">⬢</span>{" "}
              Quest
            </li>
          )}
          {props.focusSector !== undefined && props.focusSector !== null && (
            <li className="flex flex-row items-center">
              <span className="mr-1 animate-pulse text-2xl text-purple-500">⬢</span>{" "}
              {props.focusSectorLabel || "Target"}
            </li>
          )}
        </ul>
      </div>
      <div className="absolute top-0 right-0 m-5">
        <ul>
          {hoverSector && (
            <>
              <li>- Highlighting sector {hoverSector}</li>
              <li>- {actionExplanation}</li>
            </>
          )}
        </ul>
      </div>
      <div className="absolute right-0 bottom-0 m-3 flex flex-col gap-2">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Zoom in"
          onClick={() => zoomActionRef.current?.(0.8)}
        >
          <ZoomIn className="h-5 w-5" />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Zoom out"
          onClick={() => zoomActionRef.current?.(1.25)}
        >
          <ZoomOut className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
};

export default GlobalMap;
