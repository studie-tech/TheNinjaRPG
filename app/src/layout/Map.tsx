import { ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Sphere,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
} from "three";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  IMG_BADGE_MOVE_TO_LOCATION,
  IMG_MAP_QUEST_ICON,
  IMG_MAP_WAR_ICON,
  MAP_RESERVED_SECTORS,
  MAP_WAR_TORN_BATTLEGROUND_COLOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
} from "@/drizzle/constants";
import type { Village } from "@/drizzle/schema";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";
import { useTutorialStep } from "@/hooks/tutorial";
import WebGlError from "@/layout/WebGLError";
import {
  buildGlobeSurface,
  createUserAvatarSprite,
  pickGlobeSector,
  samplePolarCapColor,
} from "@/libs/threejs/globe";
import { TrackballControls } from "@/libs/threejs/TrackBallControls";
import type { GlobalMapData, GlobalTile } from "@/libs/threejs/types";
import {
  cleanUp,
  createTexture,
  isRendererContextValid,
  loadTexture,
  safeRemoveRendererElement,
  setupContextLossHandling,
  setupScene,
} from "@/libs/threejs/util";
import { contrastingTextColor, getReadableVillageHexColor } from "@/utils/color";
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

const GLOBAL_MAP_ZOOM_STORAGE_KEY = "globalMapZoom";

/**
 * Persist a projection-independent fraction of the allowed camera-distance
 * range: 0 is fully zoomed in and 1 is fully zoomed out.
 */
const getStoredGlobalMapZoom = () => {
  const stored = safeLocalStorageGetItem(GLOBAL_MAP_ZOOM_STORAGE_KEY);
  if (stored === null) return 0;
  try {
    const parsed = JSON.parse(stored) as unknown;
    return typeof parsed === "number" && Number.isFinite(parsed)
      ? Math.min(1, Math.max(0, parsed))
      : 0;
  } catch {
    return 0;
  }
};

const GlobalMap: React.FC<MapProps> = (props) => {
  const { data: userData } = useUserData();
  const [webglError, setWebglError] = useState<boolean>(false);
  const [hoverSector, setHoverSector] = useState<number | null>(null);
  // Whether the built scene actually carries quest pins, so the legend below
  // only explains markers that are on the globe
  const [hasQuestMarkers, setHasQuestMarkers] = useState<boolean>(false);
  const mountRef = useRef<HTMLDivElement | null>(null);
  // Bridges the overlay zoom buttons into the three.js scene built below
  const zoomActionRef = useRef<((factor: number) => void) | null>(null);
  // Scene handlers close over this ref so they always call the latest callback
  // without rebuilding the three.js scene when travel state changes.
  const onTileClickRef = useRef(props.onTileClick);
  onTileClickRef.current = props.onTileClick;
  const { hexasphere, showOwnership } = props;
  const autoRotate = props.autoRotate ?? true;
  const actionExplanation = props.actionExplanation || "Click tile to move there";

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

  // Tutorial step
  const { currentStep } = useTutorialStep();
  const isTravelStep = currentStep?.title === "Travel";

  useEffect(() => {
    // Reference to the mount
    const sceneRef = mountRef.current;
    if (sceneRef) {
      // Performance stats
      // const stats = new Stats();
      // document.body.appendChild(stats.dom);

      const WIDTH = sceneRef.getBoundingClientRect().width;
      const HEIGHT = WIDTH;

      // A narrower lens reduces the near-vs-limb distortion of the globe. The
      // camera distance is compensated below so its on-screen size stays put.
      const originalFov = 75;
      const fov = 50;
      const aspect = WIDTH / HEIGHT;
      const near = 0.5;
      const far = 1000;

      // Setup scene, renderer and raycaster. Unlike the other views, the globe
      // NEEDS render-list sorting: with sortObjects false three.js draws in
      // scene-graph order and ignores renderOrder entirely, and since
      // group_highlights is traversed before group_tiles the translucent sector
      // grid painted OVER every marker. Sorting makes the marker/label/pin
      // renderOrder tiers effective (a few dozen objects, negligible sort cost).
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

      /**
       * Viewport coordinates to normalized device coordinates, measured against
       * the canvas itself rather than the event target, so a pointer event that
       * originated on an overlay still maps to the right point on the globe.
       */
      const toPointerNdc = (clientX: number, clientY: number) => {
        const bounds = hoverCanvas.getBoundingClientRect();
        return new Vector2(
          ((clientX - bounds.left) / bounds.width) * 2 - 1,
          -((clientY - bounds.top) / bounds.height) * 2 + 1,
        );
      };

      // Latest pointer position, consumed by the hover pick in the render loop.
      // It stays unset until a real pointer lands: an unset Vector2 is the
      // canvas centre in NDC, which would otherwise highlight whatever sector
      // happens to sit there before anyone pointed at it.
      const mouse = new Vector2();
      let hasPointerPosition = false;
      const trackPointer = (point: Vector2) => {
        mouse.copy(point);
        hasPointerPosition = true;
      };
      const onDocumentMouseMove = (event: MouseEvent) => {
        trackPointer(toPointerNdc(event.clientX, event.clientY));
      };
      if (props.intersection) {
        hoverCanvas.addEventListener("mousemove", onDocumentMouseMove, false);
      }

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
      const villageLabelSprites: Sprite[] = [];
      const ownershipVillageBySector = new Map(
        ownershipData?.sectors.map((entry) => [entry.sector, entry.villageId]),
      );
      const ownershipColorByVillageId = new Map(
        ownershipData?.colors.map((entry) => [
          entry.id,
          getReadableVillageHexColor(entry.hexColor),
        ]),
      );

      /**
       * Make the owner of the hovered sector immediately identifiable without
       * adding another label to the globe. The matching village label receives
       * a small scale lift while the other labels recede. A DOM chip below
       * mirrors the owner name for cases where its home marker is off-screen.
       */
      const setOwnershipLabelEmphasis = (sector: number | null) => {
        if (!showOwnership || villageLabelSprites.length === 0) return;
        const ownerVillageId =
          sector === null ? null : (ownershipVillageBySector.get(sector) ?? null);
        const hasOwnerLabel =
          ownerVillageId !== null &&
          villageLabelSprites.some(
            (label) => label.userData.villageId === ownerVillageId,
          );
        for (const label of villageLabelSprites) {
          const material = label.material as SpriteMaterial;
          const baseWidth = label.userData.baseWidth as number;
          const baseHeight = label.userData.baseHeight as number;
          const isOwner =
            ownerVillageId !== null && label.userData.villageId === ownerVillageId;
          const scale = isOwner ? 1.14 : 1;
          label.scale.set(baseWidth * scale, baseHeight * scale, 1);
          material.opacity = hasOwnerLabel && !isOwner ? 0.48 : 1;
          label.renderOrder = isOwner ? 3 : 2;
        }
      };

      // The latitude/longitude sector grid intentionally stops short of the
      // poles. A continuous sphere underlay supplies the deterministic polar
      // biome colors and depth occlusion, but never contributes sector edges or
      // intercepts sector raycasts.
      if (hexasphere.projection === "cylindrical") {
        const polarGeometry = new SphereGeometry(
          (hexasphere.radius / 3) * 0.998,
          hexasphere.polarCapColumns ?? 72,
          Math.max(
            72,
            Math.round(
              ((hexasphere.polarCapRows ?? 10) * 180) /
                (90 - (hexasphere.latitudeLimit ?? 65)),
            ),
          ),
        );
        const positions = polarGeometry.getAttribute("position");
        const colors = new Float32Array(positions.count * 3);
        const underlayColor = { x: 0.78, y: 0.91, z: 0.94 };
        for (let i = 0; i < positions.count; i++) {
          const color =
            samplePolarCapColor(hexasphere, {
              x: positions.getX(i),
              y: positions.getY(i),
              z: positions.getZ(i),
            }) ?? underlayColor;
          colors[i * 3] = color.x;
          colors[i * 3 + 1] = color.y;
          colors[i * 3 + 2] = color.z;
        }
        polarGeometry.setAttribute("color", new BufferAttribute(colors, 3));
        const globeUnderlay = new Mesh(
          polarGeometry,
          new MeshBasicMaterial({
            vertexColors: true,
            side: DoubleSide,
          }),
        );
        globeUnderlay.name = "biome-colored-polar-underlay";
        globeUnderlay.raycast = () => {};
        group_tiles.add(globeUnderlay);
      }

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
        setOwnershipLabelEmphasis(sector);
        const tile = sector !== null ? hexasphere?.tiles[sector] : null;
        if (tile?.b.length !== 4) {
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
          const a = corner[k];
          const b = corner[(k + 1) % 4];
          if (!a || !b) {
            hoverOutline.visible = false;
            return;
          }
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
       * Sprites still raycast when the globe occludes them, so a label hit only
       * counts when the globe surface does not sit in front of it.
       */
      const globeSphere = new Sphere(new Vector3(0, 0, 0), hexasphere.radius / 3);
      const globeHit = new Vector3();
      const pickLabelTarget = (point: Vector2): number | null => {
        if (labelTargets.length === 0) return null;
        raycaster.setFromCamera(point, camera);
        const labelHit = raycaster.intersectObjects(labelTargets, false)[0];
        if (!labelHit) return null;
        if (
          raycaster.ray.intersectSphere(globeSphere, globeHit) &&
          globeHit.distanceTo(raycaster.ray.origin) < labelHit.distance
        ) {
          return null;
        }
        const sector = labelHit.object.userData.sector as number;
        return typeof sector === "number" ? sector : null;
      };

      /**
       * Sector under an NDC point: labels and pins win over the bare terrain
       * beneath them, matching what hovering highlights.
       */
      const pickSector = (point: Vector2): number | null => {
        const labelSector = pickLabelTarget(point);
        if (labelSector !== null) return labelSector;
        raycaster.setFromCamera(point, camera);
        return pickGlobeSector(raycaster, hexasphere);
      };

      // Currently highlighted sector, shared by the hover pick and the tap
      // handler so a tap-set outline is not immediately treated as stale.
      let highlightedSector: number | null = null;
      const highlightSector = (sector: number | null) => {
        if (sector === highlightedSector) return;
        highlightedSector = sector;
        setHoverOutline(sector);
        hoverCanvas.style.cursor = sector === null ? "default" : "pointer";
        const tile = sector !== null ? hexasphere?.tiles[sector] : undefined;
        if (props.onTileHover && sector !== null && tile) {
          props.onTileHover(sector, tile);
        }
        setHoverSector(sector);
      };

      // Single click/tap selects the sector under the pointer, whether that is
      // a village label, a map pin or bare terrain. Pointer events cover mouse
      // and touch alike, so desktop and mobile share one code path. A gesture
      // only counts as a tap when it was single-pointer for its whole lifetime
      // and the pointer never strayed from the start point - peak displacement,
      // not start-to-end, so a rotate drag that circles back and a pinch whose
      // primary finger barely moves both stay navigation.
      let onLabelPointerDown: ((e: PointerEvent) => void) | null = null;
      let onLabelPointerMove: ((e: PointerEvent) => void) | null = null;
      let onLabelPointerUp: ((e: PointerEvent) => void) | null = null;
      let onLabelPointerCancel: (() => void) | null = null;

      if (props.intersection && props.onTileClick) {
        const TAP_SLOP_PX = 10;
        const tapGesture = { x: 0, y: 0, active: false, navigated: false };
        onLabelPointerDown = (e: PointerEvent) => {
          if (e.isPrimary) {
            // A finger or pen taking over means the mouse has stopped pointing
            // at anything, so its last position must stop driving the hover
            // pick - on a hybrid device it would otherwise reclaim the outline
            // from the tap as soon as the globe turned.
            if (e.pointerType !== "mouse") hasPointerPosition = false;
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
          const point = toPointerNdc(e.clientX, e.clientY);
          const sector = pickSector(point);
          const tile = sector !== null ? hexasphere?.tiles[sector] : undefined;
          if (sector !== null && tile) {
            // Outline the picked sector while the caller decides what to do
            // with it - on touch there is no hover to show what was hit. A
            // mouse goes on hovering afterwards, so its position stays live; a
            // finger leaves no pointer behind, so the outline stays where the
            // tap put it rather than being replaced by a pick at a phantom
            // position the moment the globe turns.
            if (e.pointerType === "mouse") trackPointer(point);
            highlightSector(sector);
            onTileClickRef.current?.(sector, tile);
          }
        };
        renderer.domElement.addEventListener("pointerdown", onLabelPointerDown);
        renderer.domElement.addEventListener("pointermove", onLabelPointerMove);
        renderer.domElement.addEventListener("pointerup", onLabelPointerUp);
        renderer.domElement.addEventListener("pointercancel", onLabelPointerCancel);
      }

      // Textured globe: every logical sector is rendered from a finer visual
      // terrain field, merged into a single indexed mesh so the whole world is
      // one draw call. The sector grid stops with the navigable tiles; the
      // separate polar-cap sphere never contributes edges and therefore remains
      // a solid surface.
      const surface = buildGlobeSurface(hexasphere, (sector) => {
        // Ownership view tints the tile texture by owning village
        if (!showOwnership || !ownershipData?.sectors || !ownershipData?.colors) {
          return null;
        }
        const ownerVillageId = ownershipVillageBySector.get(sector);
        const villageColor = ownerVillageId
          ? ownershipColorByVillageId.get(ownerVillageId)
          : undefined;
        if (villageColor) return new Color(villageColor);
        return MAP_RESERVED_SECTORS.includes(sector) ? new Color("#b3afae") : null;
      });
      const globeMesh = new Mesh(
        surface.geometry,
        new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }),
      );
      globeMesh.matrixAutoUpdate = false;
      // Picking is arithmetic (pickGlobeSector), so the terrain never needs to
      // be a raycast target - and a 400k-vertex mesh would be a costly one.
      globeMesh.raycast = () => {};
      group_tiles.add(globeMesh);

      const edgePositions: number[] = [];
      const EDGE_LIFT = 1.0015; // sit the outline just above the tile faces
      for (const tile of hexasphere.tiles) {
        if (tile.b.length !== 4) continue;
        // Quad boundary (corners NW,NE,SE,SW), lifted just above the surface,
        // for the sector-separation wireframe
        const corner = tile.b.map((p) => ({
          x: (Number(p.x) / 3) * EDGE_LIFT,
          y: (Number(p.y) / 3) * EDGE_LIFT,
          z: (Number(p.z) / 3) * EDGE_LIFT,
        }));
        for (let k = 0; k < 4; k++) {
          const a = corner[k];
          const b = corner[(k + 1) % 4];
          if (!a || !b) continue;
          edgePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }

      // Soft sector-separation grid overlaid on the globe. A translucent light
      // grey keeps sectors readable without obscuring the terrain underneath.
      // It is occluded by opaque tiles on the far side (depthTest), so only
      // front edges show.
      if (edgePositions.length > 0) {
        const edgeGeometry = new BufferGeometry();
        edgeGeometry.setAttribute(
          "position",
          new BufferAttribute(new Float32Array(edgePositions), 3),
        );
        const edgeLines = new LineSegments(
          edgeGeometry,
          new LineBasicMaterial({
            color: 0x4b5563,
            transparent: true,
            opacity: 0.2,
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
                const labelFill = getReadableVillageHexColor(highlight.hexColor);
                const labelText = contrastingTextColor(labelFill);
                context.globalAlpha = 0.9;
                context.fillStyle = labelFill;
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
                context.fillStyle = labelText;
                context.strokeStyle = labelText === "#000000" ? "#F0F0F0" : "#1a1a1a";
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
              labelSprite.userData.villageId = highlight.id;
              labelSprite.userData.baseWidth = labelSprite.scale.x;
              labelSprite.userData.baseHeight = labelSprite.scale.y;
              villageLabelSprites.push(labelSprite);
              labelTargets.push(labelSprite);
              group_highlights.add(labelSprite);
            }
          });
      }

      scene.add(group_highlights);
      scene.add(group_tiles);

      // Highlight pulses are driven straight from the clock in the render loop
      // rather than through tween.js. Its yoyo emits the opposite endpoint for a
      // single frame on each repeat boundary, which showed up as the marker
      // snapping full size for one frame at both ends of its travel; a cosine
      // phase has no boundary to glitch on. (The tweens were also never
      // animating at all before: v25 only registers a tween with a group when
      // one is passed to the constructor, so the global update advanced an empty
      // set and every colour sat on its opening value.)
      //
      // These multiply the tile's terrain colour, so a channel left at 0 erases
      // that channel rather than tinting it -- which is why the quest sector
      // used to read as a shadow next to the focus sector's purple. Warm amber
      // for quests against the cool purple of a focus, matching the orange and
      // purple the legend uses for them.
      const PULSE_PERIOD_MS = 2000;
      const questPulseFrom = { r: 1.0, g: 0.55, b: 0.2 };
      const questPulseTo = { r: 0.5, g: 0.28, b: 0.1 };
      const warBase = new Color(MAP_WAR_TORN_BATTLEGROUND_COLOR);
      const warPulseFrom = { r: warBase.r, g: warBase.g, b: warBase.b };
      const warPulseTo = { r: 0.4, g: 0.0, b: 0.0 };
      const focusPulseFrom = { r: 0.66, g: 0.33, b: 0.97 };
      const focusPulseTo = { r: 0.33, g: 0.17, b: 0.5 };
      // Live values the render loop rewrites each frame and the pulse code reads
      const questTweenColor = { ...questPulseFrom };
      const warTweenColor = { ...warPulseFrom };
      const focusTweenColor = { ...focusPulseFrom };
      // Quest pins breathe as well as pulse: the tile tint alone is easy to miss
      // on a first visit, and the scroll is what a new player is told to press.
      const questIconScale = { value: 1 };
      const QUEST_ICON_SCALE_MAX = 1.3;

      const sectorsToHighlight: {
        sector: number;
        color: typeof questTweenColor;
        type: "quest" | "war" | "focus";
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

      if (props.userLocation && userData?.userQuests && !showOwnership) {
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
      }

      // One pin per sector. A sector can be a quest target, a war zone and the
      // focused sector at once -- the tutorial deliberately focuses the sector
      // its quest is in -- and pushing all three stacks their icons on the same
      // point, which just reads as a smudge. The quest scroll wins because it is
      // the marker the player has to act on; losing the focus pin costs nothing,
      // since focusing still centres the camera and names the sector in the
      // legend either way.
      const highlightPriority = { quest: 0, war: 1, focus: 2 } as const;
      const pinnedSectors = [...sectorsToHighlight]
        .sort((a, b) => highlightPriority[a.type] - highlightPriority[b.type])
        .filter(
          (highlight, index, all) =>
            all.findIndex((other) => other.sector === highlight.sector) === index,
        );

      // Highlighted GPS pins for quests and wars
      const questIconSprites: Sprite[] = [];
      pinnedSectors.forEach((highlight) => {
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
          if (highlight.type === "quest") questIconSprites.push(iconSprite);
          iconSprite.position.set(sector.x / 2.5, sector.y / 2.5, sector.z / 2.5);
          iconSprite.userData.sector = highlight.sector;
          labelTargets.push(iconSprite);
          group_highlights.add(iconSprite);
        }
      });

      setHasQuestMarkers(pinnedSectors.some((highlight) => highlight.type === "quest"));

      // Pulsing a sector means rewriting its slice of the merged surface's
      // shared color buffer every frame. Snapshot each one's terrain colors up
      // front - taken lazily they would capture an already-pulsed slice
      // whenever two highlights land on the same sector, and the tile would
      // then darken a little more each frame.
      const surfaceColors = surface.geometry.getAttribute("color") as BufferAttribute;
      const surfaceColorValues = surfaceColors.array as Float32Array;
      const pulses = pinnedSectors.flatMap((highlight) => {
        const start = surface.vertexRanges[highlight.sector * 2] ?? -1;
        const count = surface.vertexRanges[highlight.sector * 2 + 1] ?? 0;
        if (start < 0) return [];
        return [
          {
            type: highlight.type,
            offset: start * 3,
            terrain: surfaceColorValues.slice(start * 3, (start + count) * 3),
          },
        ];
      });

      // Compensate camera distance for the narrower lens using the globe's
      // projected angular radius. This keeps the established zoom range while
      // making the globe read flatter.
      const globeRadius = hexasphere.radius / 3;
      const compensateDistanceForFov = (originalDistance: number) => {
        const originalHalfFov = (originalFov * Math.PI) / 360;
        const nextHalfFov = (fov * Math.PI) / 360;
        const originalAngularRadius = Math.asin(globeRadius / originalDistance);
        const projectedRadius =
          Math.tan(originalAngularRadius) / Math.tan(originalHalfFov);
        const nextAngularRadius = Math.atan(projectedRadius * Math.tan(nextHalfFov));
        return globeRadius / Math.sin(nextAngularRadius);
      };
      // Distance 16 was the previous maximum zoom; compensate it through the
      // same projection so mobile tile sizing remains familiar.
      const minCameraDistance = compensateDistanceForFov(16);
      const maxCameraDistance = compensateDistanceForFov(22);
      // New visitors start fully zoomed in. Returning visitors resume at the
      // same relative point in the current projection's allowed zoom range.
      const storedZoom = getStoredGlobalMapZoom();
      const cameraDistance =
        minCameraDistance + storedZoom * (maxCameraDistance - minCameraDistance);
      const initialCameraDirection = new Vector3(0, 0, 1);

      // Initial camera positioning - prioritize focus sector over user location
      if (props.focusSector !== undefined && props.focusSector !== null) {
        const focusSectorData = hexasphere?.tiles[props.focusSector]?.c;
        if (focusSectorData) {
          const { x, y, z } = focusSectorData;
          initialCameraDirection.set(x, y, z).normalize();
        }
      } else if (props.userLocation && userData) {
        const sector = hexasphere?.tiles[userData.sector]?.c;
        if (sector) {
          const { x, y, z } = sector;
          initialCameraDirection.set(x, y, z).normalize();
        }
      }

      camera.position.copy(initialCameraDirection.multiplyScalar(cameraDistance));
      camera.lookAt(scene.position);

      // Keep the globe upright while allowing bounded north-south tilt. The
      // camera can reach every navigable latitude but cannot flip over a pole.
      const controls = new TrackballControls(camera, renderer.domElement);
      controls.maxLatitude = ((hexasphere.latitudeLimit ?? 65) * Math.PI) / 180;
      controls.noPan = true;
      controls.staticMoving = true;
      controls.zoomSpeed = 1.2;
      controls.minDistance = minCameraDistance;
      controls.maxDistance = maxCameraDistance;
      let isUserInteracting = false;
      const onControlStart = () => {
        isUserInteracting = true;
      };
      const onControlEnd = () => {
        isUserInteracting = false;
      };
      controls.addEventListener("start", onControlStart);
      controls.addEventListener("end", onControlEnd);
      let zoomSaveTimeout: ReturnType<typeof setTimeout> | null = null;
      let lastZoomDistance = cameraDistance;
      const persistZoomDistance = (distance: number) => {
        const zoomRange = maxCameraDistance - minCameraDistance;
        const normalizedZoom =
          zoomRange > 0
            ? Math.min(1, Math.max(0, (distance - minCameraDistance) / zoomRange))
            : 0;
        safeLocalStorageSetItem(
          GLOBAL_MAP_ZOOM_STORAGE_KEY,
          JSON.stringify(normalizedZoom),
        );
      };
      const onZoomChange = () => {
        const distance = camera.position.length();
        // TrackballControls also emits changes while the globe rotates. Only
        // camera-distance changes represent zoom and should touch storage.
        if (Math.abs(distance - lastZoomDistance) < 0.001) return;
        lastZoomDistance = distance;
        if (zoomSaveTimeout) clearTimeout(zoomSaveTimeout);
        zoomSaveTimeout = setTimeout(() => {
          persistZoomDistance(lastZoomDistance);
          zoomSaveTimeout = null;
        }, 300);
      };
      controls.addEventListener("change", onZoomChange);
      const worldUp = new Vector3(0, 1, 0);
      let lastTime = Date.now();

      // Zoom helper for the overlay buttons, clamped to the same distance
      // limits as the wheel/pinch zoom
      zoomActionRef.current = (factor: number) => {
        const distance = camera.position.length();
        if (distance === 0) return;
        const next = Math.min(
          Math.max(distance * factor, minCameraDistance),
          maxCameraDistance,
        );
        camera.position.multiplyScalar(next / distance);
      };

      // Render the image
      let animationId = 0;
      // Gate the hover pick: only re-run it when the pointer or the camera pose
      // actually changed since the last one (the globe auto-rotates, so the
      // camera moving is itself a reason to re-test).
      let lastRaycastCamX = Number.NaN;
      let lastRaycastCamY = Number.NaN;
      let lastRaycastCamZ = Number.NaN;
      let lastRaycastMouseX = Number.NaN;
      let lastRaycastMouseY = Number.NaN;
      function render() {
        // One cosine phase, 0 -> 1 -> 0, drives every highlight pulse. Continuous
        // at both ends by construction, so nothing jumps on the turnaround.
        const phase =
          (1 -
            Math.cos(
              ((Date.now() % PULSE_PERIOD_MS) / PULSE_PERIOD_MS) * Math.PI * 2,
            )) /
          2;
        const lerp = (from: number, to: number) => from + (to - from) * phase;
        questTweenColor.r = lerp(questPulseFrom.r, questPulseTo.r);
        questTweenColor.g = lerp(questPulseFrom.g, questPulseTo.g);
        questTweenColor.b = lerp(questPulseFrom.b, questPulseTo.b);
        warTweenColor.r = lerp(warPulseFrom.r, warPulseTo.r);
        warTweenColor.g = lerp(warPulseFrom.g, warPulseTo.g);
        warTweenColor.b = lerp(warPulseFrom.b, warPulseTo.b);
        focusTweenColor.r = lerp(focusPulseFrom.r, focusPulseTo.r);
        focusTweenColor.g = lerp(focusPulseFrom.g, focusPulseTo.g);
        focusTweenColor.b = lerp(focusPulseFrom.b, focusPulseTo.b);
        questIconScale.value = lerp(1, QUEST_ICON_SCALE_MAX);

        // Nothing below reaches the GPU while the context is lost, and queueing
        // buffer update ranges that never get uploaded would grow unbounded.
        const canRender = !contextHandlers.isContextLost();

        // Tint each highlighted sector's slice of the merged surface's colors
        if (canRender && pulses.length > 0) {
          for (const pulse of pulses) {
            const color =
              pulse.type === "war"
                ? warTweenColor
                : pulse.type === "focus"
                  ? focusTweenColor
                  : questTweenColor;
            for (let i = 0; i < pulse.terrain.length; i += 3) {
              surfaceColorValues[pulse.offset + i] = (pulse.terrain[i] ?? 0) * color.r;
              surfaceColorValues[pulse.offset + i + 1] =
                (pulse.terrain[i + 1] ?? 0) * color.g;
              surfaceColorValues[pulse.offset + i + 2] =
                (pulse.terrain[i + 2] ?? 0) * color.b;
            }
            // Upload only the pulsed vertices, not the whole 400k-vertex buffer
            surfaceColors.addUpdateRange(pulse.offset, pulse.terrain.length);
          }
          surfaceColors.needsUpdate = true;
        }

        // Breathe the quest pins in step with their tile tint. Sprite scale is
        // in world units and the sprite always faces the camera, so this stays
        // an even pulse at every zoom without any per-frame maths of its own.
        if (canRender && questIconSprites.length > 0) {
          for (const sprite of questIconSprites) {
            sprite.scale.set(questIconScale.value, questIconScale.value, 1);
          }
        }
        // Intersections with mouse: https://threejs.org/docs/index.html#api/en/core/Raycaster
        const cameraOrPointerMoved =
          camera.position.x !== lastRaycastCamX ||
          camera.position.y !== lastRaycastCamY ||
          camera.position.z !== lastRaycastCamZ ||
          mouse.x !== lastRaycastMouseX ||
          mouse.y !== lastRaycastMouseY;
        if (props.intersection && hasPointerPosition && cameraOrPointerMoved) {
          lastRaycastCamX = camera.position.x;
          lastRaycastCamY = camera.position.y;
          lastRaycastCamZ = camera.position.z;
          lastRaycastMouseX = mouse.x;
          lastRaycastMouseY = mouse.y;
          // Labels and pins take hover precedence over the tiles behind them;
          // hovering one outlines its target sector, matching what a click does
          highlightSector(pickSector(mouse));
        }

        // Auto-rotate around the same fixed north-south axis as manual drags.
        if (autoRotate && (animationId === 0 || !isTravelStep) && !isUserInteracting) {
          const dt = Date.now() - lastTime;
          const rotateCameraBy = (1 * Math.PI) / (50000 / dt);
          camera.position.applyAxisAngle(worldUp, rotateCameraBy);
          camera.lookAt(scene.position);
        }
        lastTime = Date.now();

        // Trackball updates
        controls.update();

        // Render the scene (skip if WebGL context is lost or invalid)
        animationId = requestAnimationFrame(render);
        if (canRender && renderer) {
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
        if (zoomSaveTimeout) clearTimeout(zoomSaveTimeout);
        persistZoomDistance(camera.position.length());

        // Remove event listeners safely
        try {
          if (props.intersection) {
            hoverCanvas.removeEventListener("mousemove", onDocumentMouseMove);
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
          controls.removeEventListener("start", onControlStart);
          controls.removeEventListener("end", onControlEnd);
          controls.removeEventListener("change", onZoomChange);
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
    autoRotate,
  ]);

  const hoveredOwnership =
    showOwnership && hoverSector !== null
      ? ownershipData?.sectors.find((entry) => entry.sector === hoverSector)
      : undefined;
  const hoveredOwner = hoveredOwnership
    ? ownershipData?.colors.find((village) => village.id === hoveredOwnership.villageId)
    : undefined;
  const hoveredOwnerColor = getReadableVillageHexColor(hoveredOwner?.hexColor ?? "");
  const hoveredOwnerName =
    hoveredOwner?.mapName ??
    hoveredOwner?.name ??
    (hoveredOwnership ? "Claimed" : "Unclaimed");

  return (
    // The overlay labels anchor to this wrapper (the map itself), so they sit
    // on the globe no matter what page embeds the component
    <div className="relative">
      <div ref={mountRef} id={"tutorial-global-map"}></div>
      {webglError && <WebGlError />}
      <div className="pointer-events-none absolute top-0 left-0 m-5">
        <ul>
          {hoverSector !== null && showOwnership && (
            <li className="flex min-w-36 items-center gap-2 rounded-lg border border-white/20 bg-black/75 px-3 py-2 shadow-lg backdrop-blur-sm">
              <span
                className="h-3 w-3 shrink-0 rounded-sm border border-white/50 shadow-sm"
                style={{ backgroundColor: hoveredOwnerColor }}
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-[10px] text-white/65 uppercase tracking-wide">
                  Sector {hoverSector} · Owned by
                </span>
                <span className="truncate font-semibold text-sm text-white">
                  {hoveredOwnerName}
                </span>
              </span>
            </li>
          )}
          {hasQuestMarkers && (
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
      <div className="pointer-events-none absolute top-0 right-0 m-5">
        <ul className="flex flex-col items-end gap-2">
          {hoverSector !== null && (
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
