import { useEffect, useRef, useState } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
} from "three";
import {
  IMG_MAP_WAR_ICON,
  IMG_MAP_QUEST_ICON,
  IMG_BADGE_MOVE_TO_LOCATION,
  MAP_RESERVED_SECTORS,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
} from "@/drizzle/constants";
import { createUserAvatarSprite } from "@/libs/threejs/globe";
import WebGlError from "@/layout/WebGLError";
import alea from "alea";
import * as TWEEN from "@tweenjs/tween.js";
import { createTexture, loadTexture } from "@/libs/threejs/util";
import { useTutorialStep } from "@/hooks/tutorial";
import { cleanUp, setupScene } from "@/libs/threejs/util";
import {
  groundColors,
  oceanColors,
  dessertColors,
  iceColors,
} from "@/libs/threejs/biome";
import { TrackballControls } from "@/libs/threejs/TrackBallControls";
import { useUserData } from "@/utils/UserContext";
import { api } from "@/app/_trpc/client";
import type { Village } from "@/drizzle/schema";
import type { GlobalTile } from "@/libs/threejs/types";
import type { GlobalMapData } from "@/libs/threejs/types";
import type { GlobalPoint } from "@/libs/threejs/types";
import type { HexagonalFaceMesh } from "@/libs/hexgrid";

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
  actionExplanation?: string;
  focusSector?: number | null;
  focusSectorLabel?: string;
  onTileClick?: (sector: number | null, tile: GlobalTile | null) => void;
  onTileHover?: (sector: number | null, tile: GlobalTile | null) => void;
}

const Map: React.FC<MapProps> = (props) => {
  const { data: userData } = useUserData();
  const [webglError, setWebglError] = useState<boolean>(false);
  const [hoverSector, setHoverSector] = useState<number | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const mouse = new Vector2();
  const { hexasphere, showOwnership } = props;
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
  useEffect(() => {
    // Reference to the mount
    const sceneRef = mountRef.current;
    if (sceneRef) {
      // Performance stats
      // const stats = new Stats();
      // document.body.appendChild(stats.dom);

      // Interacivity with mouse
      if (props.intersection) {
        sceneRef.addEventListener("mousemove", onDocumentMouseMove, false);
      }
      let intersected: HexagonalFaceMesh | undefined = undefined;

      const WIDTH = sceneRef.getBoundingClientRect().width;
      const HEIGHT = WIDTH;

      const fov = 75;
      const aspect = WIDTH / HEIGHT;
      const near = 0.5;
      const far = 1000;

      // Setup scene, renderer and raycaster
      const { scene, renderer, raycaster, handleResize } = setupScene({
        mountRef: mountRef,
        width: WIDTH,
        height: HEIGHT,
        sortObjects: false,
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

      // Track WebGL context loss to prevent shader errors on iOS mobile browsers
      let isContextLost = false;
      const handleContextLost = (event: Event) => {
        event.preventDefault();
        isContextLost = true;
      };
      const handleContextRestored = () => {
        isContextLost = false;
      };
      renderer.domElement.addEventListener("webglcontextlost", handleContextLost);
      renderer.domElement.addEventListener(
        "webglcontextrestored",
        handleContextRestored,
      );

      // Setup camera
      const camera = new PerspectiveCamera(fov, aspect, near, far);

      // Random number gen
      const prng = alea(42);

      // Groups to hold items
      const group_tiles = new Group();
      const group_highlights = new Group();

      // Add on double click/tap tile handler
      let onDblClick: (() => void) | null = null;
      let onTouchEnd: ((e: TouchEvent) => void) | null = null;

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
      }

      // Spheres from here: https://www.robscanlon.com/hexasphere/
      // Create the map first
      for (let i = 0; i < hexasphere.tiles.length; i++) {
        const t = hexasphere.tiles[i];
        if (t) {
          const geometry = new BufferGeometry();
          const points =
            t.b.length > 5
              ? [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]
              : [0, 1, 2, 0, 2, 3, 0, 3, 4];
          const vertices = new Float32Array(
            points
              .map((p) => t.b[p])
              .flatMap((p) => (p ? [p.x / 3, p.y / 3, p.z / 3] : [])),
          );
          geometry.setAttribute("position", new BufferAttribute(vertices, 3));
          const consistentRandom = prng();
          let color = null;

          // If no ownership or not showing ownership, use biome colors
          if (t.t === 0) {
            color = oceanColors[Math.floor(consistentRandom * oceanColors.length)];
          } else if (t.t === 1) {
            color = groundColors[Math.floor(consistentRandom * groundColors.length)];
          } else if (t.t === 2) {
            color = dessertColors[Math.floor(consistentRandom * dessertColors.length)];
          } else {
            color = iceColors[Math.floor(consistentRandom * iceColors.length)];
          }

          // If showing ownership and we have the data, color by owner
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
          const material = new MeshBasicMaterial({ color });

          const mesh = new Mesh(geometry, material?.clone());
          mesh.matrixAutoUpdate = false;
          mesh.userData.id = i;
          mesh.name = `${i}`;
          group_tiles.add(mesh);
        }
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
              distance: 0.0,
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
              const bar_material = new SpriteMaterial({ map: texture });
              const labelSprite = new Sprite(bar_material);
              labelSprite.scale.set(canvas.width / 40, canvas.height / 40, 1);
              labelSprite.position.set(sector.x / 2.5, sector.y / 2.5, sector.z / 2.5);
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

      if (props.userLocation && userData && !showOwnership) {
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
            depthWrite: false,
            depthTest: false,
          });
          const iconSprite = new Sprite(iconMaterial);
          iconSprite.scale.set(1, 1, 1);
          iconSprite.position.set(sector.x / 2.5, sector.y / 2.5, sector.z / 2.5);
          group_highlights.add(iconSprite);
        }
      });

      //Enable controls
      const controls = new TrackballControls(camera, renderer.domElement);
      controls.noPan = true;
      controls.staticMoving = true;
      controls.zoomSpeed = 0.1;
      const cameraDistance = 22;
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

      // Render the image
      let animationId = 0;
      function render() {
        // Update all TWEEN animations (color pulsing, etc.)
        TWEEN.update();

        // Apply highlight colors to sectors
        if (sectorsToHighlight.length > 0) {
          sectorsToHighlight.forEach((highlight) => {
            const mesh = group_tiles.getObjectByName(`${highlight.sector}`);
            if (mesh) {
              const color =
                highlight.type === "war"
                  ? warTweenColor
                  : highlight.type === "focus"
                    ? focusTweenColor
                    : questTweenColor;
              (mesh as HexagonalFaceMesh).material.color.setRGB(color.r, color.g, color.b);
            }
          });
        }
        // Intersections with mouse: https://threejs.org/docs/index.html#api/en/core/Raycaster
        if (props.intersection) {
          raycaster.setFromCamera(mouse, camera);
          const intersects = raycaster.intersectObjects(group_tiles.children);
          if (intersects.length > 0) {
            // if the closest object intersected is not the currently stored intersection object
            if (intersects[0] && intersects[0].object != intersected) {
              // restore previous intersection object (if it exists) to its original color
              if (intersected) {
                intersected.material.color.setHex(intersected.currentHex);
              }
              // store reference to closest object as current intersection object
              intersected = intersects[0].object as HexagonalFaceMesh;
              // store color of closest object (for later restoration)
              intersected.currentHex = intersected.material.color.getHex();
              // set a new color for closest object
              intersected.material.color.setHex(0x00ffd8);
              // Call outside stuff
              const sector = intersected.userData.id;
              if (props.onTileHover) {
                const tile = hexasphere?.tiles[sector];
                if (tile) props.onTileHover(sector, tile);
              }
              setHoverSector(sector);
            }
          } else {
            if (intersected) {
              intersected.material.color.setHex(intersected.currentHex);
            }
            intersected = undefined;
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
        if ((animationId === 0 || !isTravelStep) && !isUserInteracting) {
          const dt = Date.now() - lastTime;
          const rotateCameraBy = (1 * Math.PI) / (50000 / dt);
          phi += rotateCameraBy;
          lastTime = Date.now();
        }

        // Update camera position when not user interacting
        if (!isUserInteracting) {
          camera.position.x = cameraDistance * Math.sin(phi) * Math.cos(sigma);
          camera.position.y = cameraDistance * Math.sin(phi) * Math.sin(sigma);
          camera.position.z = cameraDistance * Math.cos(phi);
          camera.lookAt(scene.position);
        }

        // Trackball updates
        controls.update();

        // Render the scene (skip if WebGL context is lost)
        animationId = requestAnimationFrame(render);
        if (!isContextLost) {
          renderer?.render(scene, camera);
        }

        // Performance monitor
        // stats.update();
      }
      render();

      // Remove the intersection listener

      return () => {
        cancelAnimationFrame(animationId);

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
          window.removeEventListener("resize", handleResize);
          renderer.domElement.removeEventListener(
            "webglcontextlost",
            handleContextLost,
          );
          renderer.domElement.removeEventListener(
            "webglcontextrestored",
            handleContextRestored,
          );
        } catch {
          // Ignore errors if elements are already removed
        }

        // Safely remove renderer DOM element
        try {
          if (sceneRef.contains(renderer.domElement)) {
            sceneRef.removeChild(renderer.domElement);
          }
        } catch {
          // Ignore errors if element is already removed
        }

        cleanUp(scene, renderer);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.highlights,
    props.usersHighlighted,
    props.intersection,
    props.focusSector,
    showOwnership,
    ownershipData,
  ]);

  return (
    <>
      <div ref={mountRef} id={"tutorial-global-map"}></div>
      {webglError && <WebGlError />}
      <div className="absolute left-0 top-0 m-5">
        <ul>
          {hoverSector && (
            <li className="flex flex-row items-center">
              <span className="text-2xl mr-1 animate-pulse text-orange-500">⬢</span>{" "}
              Quest
            </li>
          )}
          {props.focusSector !== undefined && props.focusSector !== null && (
            <li className="flex flex-row items-center">
              <span className="text-2xl mr-1 animate-pulse text-purple-500">⬢</span>{" "}
              {props.focusSectorLabel || "Target"}
            </li>
          )}
        </ul>
      </div>
      <div className="absolute right-0 top-0 m-5">
        <ul>
          {hoverSector && (
            <>
              <li>- Highlighting sector {hoverSector}</li>
              <li>- {actionExplanation}</li>
            </>
          )}
        </ul>
      </div>
    </>
  );
};

export default Map;
