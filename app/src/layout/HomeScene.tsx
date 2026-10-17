"use client";

import {
  BedDouble,
  ChefHat,
  Maximize,
  Minus,
  Package,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Sprout,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type CombatBiome,
  HOME_FLOOR_TILES,
  HOME_FURNITURE_MAX_PLACEMENTS,
  HOME_FURNITURE_ROTATION_DEGREES,
  HOME_WALL_PAINTS,
  type HomeFurnitureRotation,
  type HomeType,
} from "@/drizzle/constants";
import { HomePropertyBackdrop } from "@/layout/HomePropertyBackdrop";
import Image from "@/layout/Image";
import {
  fitHomeFurniturePlacement,
  getHomeFurnitureGeometry,
  getHomeFurnitureRotations,
  getHomeFurnitureView,
  type HomeFurniture,
  isPointInHomePolygon,
  projectHomePlacement,
  recoverHomeLayout,
  unprojectHomePlacement,
} from "@/libs/home";
import {
  boundHomeCamera,
  getHomeOverviewCamera,
  getHomePlacementRoom,
  getHomeRoomCamera,
  getHomeRooms,
  type HomeRoomId,
  zoomHomeCamera,
} from "@/libs/homeProperty";
import { HOME_ART_PLANS } from "@/libs/homeRoomGeometry";
import { cn } from "@/libs/shadui";
import { bunnyImageUrl } from "@/utils/image";
import { clamp } from "@/utils/math";
import type { HomePlacement, HomeRoomStyle } from "@/validators/home";

/** A furnished residence with a reversible draft; the page owns persistence and game actions. */
export const HomeScene = ({
  homeType,
  biome = "ground",
  isGuest,
  isAsleep,
  isTogglingSleep,
  onSleep,
  onStorage,
  onKitchen,
  onFarm,
  isDecorating,
  onDecoratingChange,
  layout = [],
  furniture = [],
  revision = 0,
  canDecorate = false,
  isSaving = false,
  isRefreshingFurniture = false,
  furnitureError,
  onSave,
  styles = [],
  isVisiting = false,
}: HomeSceneProps) => {
  const sceneRef = useRef<HTMLFieldSetElement>(null);
  const dragRef = useRef<{
    placement: HomePlacement;
    clientX: number;
    clientY: number;
    pointerId: number;
  } | null>(null);
  const rooms = getHomeRooms(homeType);
  const [activeRoom, setActiveRoom] = useState<HomeRoomId>("main");
  const [camera, setCamera] = useState(() => getHomeOverviewCamera(homeType));
  const cameraPointers = useRef(
    new Map<
      number,
      { x: number; y: number; startX: number; startY: number; canPan: boolean }
    >(),
  );
  const hasPinched = useRef(false);
  const hasPanned = useRef(false);
  /** Inventory selection frames the piece’s room without changing the decoration draft. */
  const focusRoom = (id: HomeRoomId) => {
    if (!rooms.some((room) => room.id === id)) return;
    setActiveRoom(id);
    setCamera(getHomeRoomCamera(homeType, id));
  };
  /** Translate local furniture bounds into the continuous property's coordinate system. */
  const roomBounds = (piece: HomeFurniture, placement: HomePlacement) => {
    const room = rooms.find(({ id }) => id === getHomePlacementRoom(placement));
    const bounds = getHomeFurnitureGeometry(piece, placement, homeType).visibleBounds;
    return {
      ...bounds,
      width: (bounds.width * (room?.width ?? 100)) / 100,
      x: (bounds.x * (room?.width ?? 100)) / 100 + (room?.x ?? 0),
      height: (bounds.height * (room?.height ?? 100)) / 100,
      y: (bounds.y * (room?.height ?? 100)) / 100 + (room?.y ?? 0),
    };
  };
  useEffect(() => {
    cameraPointers.current.clear();
    hasPinched.current = false;
    setCamera(getHomeOverviewCamera(homeType));
    setActiveRoom("main");
  }, [homeType]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = scene.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) return;
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      setCamera((current) => {
        const scale = clamp(
          current.scale * (event.deltaY > 0 ? 0.9 : 1.1),
          getHomeOverviewCamera(homeType).scale,
          1.8,
        );
        return boundHomeCamera(zoomHomeCamera(current, scale, { x, y }), homeType);
      });
    };
    // A non-passive listener keeps wheel zoom from scrolling the surrounding page.
    scene.addEventListener("wheel", wheel, { passive: false });
    return () => scene.removeEventListener("wheel", wheel);
  }, [homeType]);
  const [failedHomeType, setFailedHomeType] = useState<HomeType | null>(null);
  const [draft, setDraft] = useState<HomeDraft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [storageTargetId, setStorageTargetId] = useState<string | null>(null);
  const [placementError, setPlacementError] = useState<string | null>(null);
  const furnitureById = new Map(furniture.map((piece) => [piece.id, piece]));
  const placements =
    draft?.placements ?? recoverHomeLayout(layout, furniture, homeType);
  const selectedFurniture = selectedId ? furnitureById.get(selectedId) : undefined;
  const selected = placements.find((placement) => placement.id === selectedId);
  const isEditing = isDecorating && draft !== null;
  const isTierChanged = draft !== null && draft.homeType !== homeType;
  const hasMissingFurniture =
    isEditing && placements.some((placement) => !furnitureById.has(placement.id));
  const saveError = isTierChanged
    ? "Your home tier changed. Cancel and reopen the editor for this home."
    : hasMissingFurniture
      ? "Some furniture is no longer in your inventory. Undo changes to continue."
      : placementError || furnitureError;
  const isMovementDisabled = isSaving || isTierChanged || !canDecorate;
  const hasPlacementLimit =
    placements.filter((placement) => getHomePlacementRoom(placement) === activeRoom)
      .length >= HOME_FURNITURE_MAX_PLACEMENTS;
  const hasImageError = failedHomeType === homeType;
  const sleepLabel = isTogglingSleep
    ? "Please wait…"
    : isAsleep
      ? "Wake up"
      : "Go to sleep";

  // Capture the revision only when editing begins; subsequent query refreshes must not rebase unsaved edits.
  useEffect(() => {
    if (isDecorating && !draft && !isRefreshingFurniture) {
      const placements = recoverHomeLayout(layout, furniture, homeType);
      setDraft({ homeType, revision, placements, styles });
      setSelectedId(
        placements.find((placement) => getHomePlacementRoom(placement) === activeRoom)
          ?.id ?? null,
      );
      setPlacementError(null);
    } else if (!isDecorating && draft) {
      dragRef.current = null;
      cameraPointers.current.clear();
      hasPinched.current = false;
      setDraft(null);
      setStorageTargetId(null);
    }
  }, [
    isDecorating,
    draft,
    layout,
    furniture,
    homeType,
    revision,
    isRefreshingFurniture,
    activeRoom,
  ]);

  /** Change placements without replacing the draft's optimistic concurrency snapshot. */
  const updatePlacements = (
    transform: (placements: HomePlacement[]) => HomePlacement[],
  ) => {
    if (isMovementDisabled) return;
    setPlacementError(null);
    setDraft(
      (current) => current && { ...current, placements: transform(current.placements) },
    );
  };

  /** Merge one finish into its room while retaining other finishes and the original save revision. */
  const updateRoomStyle = (
    changes: Partial<Pick<HomeRoomStyle, "paint" | "floor">>,
  ) => {
    setDraft(
      (current) =>
        current && {
          ...current,
          styles: [
            ...current.styles.filter(({ room }) => room !== activeRoom),
            {
              room: activeRoom,
              paint: "ivory",
              floor: "original",
              ...current.styles.find(({ room }) => room === activeRoom),
              ...changes,
            },
          ],
        },
    );
  };

  /** Furniture moves use the same painted floor and collision rules as saving. */
  const moveFurniture = (id: string, x: number, y: number, room?: HomeRoomId) => {
    const piece = furnitureById.get(id);
    const placement = placements.find((placement) => placement.id === id);
    if (!piece || !placement || isMovementDisabled) return;
    if (
      room &&
      placements.filter(
        (placement) => placement.id !== id && getHomePlacementRoom(placement) === room,
      ).length >= HOME_FURNITURE_MAX_PLACEMENTS
    )
      return;
    const fitted = fitHomeFurniturePlacement(
      { ...placement, x, y, ...(room ? { room } : {}) },
      piece,
      placements,
      furniture,
      homeType,
    );
    if (!fitted) return;
    updatePlacements((current) =>
      current.map((placement) => (placement.id === id ? fitted : placement)),
    );
    if (room) setActiveRoom(room);
    return fitted;
  };

  /** Removing a placement keeps the owned inventory row and its quantity unchanged. */
  const storeFurniture = (id: string) => {
    if (dragRef.current) cameraPointers.current.delete(dragRef.current.pointerId);
    dragRef.current = null;
    setStorageTargetId(null);
    updatePlacements((placements) =>
      placements.filter((placement) => placement.id !== id),
    );
  };

  /** A drop onto another storage fixture takes precedence over floor collision fitting. */
  const findStorageTarget = (id: string, clientX: number, clientY: number) => {
    const drag = dragRef.current;
    // Tall art can cover the armory; selecting it must not count as a storage drop.
    if (!drag || Math.hypot(clientX - drag.clientX, clientY - drag.clientY) < 4)
      return null;
    const scene = sceneRef.current?.getBoundingClientRect();
    if (!scene?.width || !scene.height) return null;
    const x = (((clientX - scene.left) / scene.width) * 100 - camera.x) / camera.scale;
    const y = (((clientY - scene.top) / scene.height) * 100 - camera.y) / camera.scale;
    return (
      placements.find((placement) => {
        const piece = furnitureById.get(placement.id);
        if (placement.id === id || piece?.action !== "storage") return false;
        const bounds = roomBounds(piece, placement);
        return (
          x >= bounds.x &&
          x <= bounds.x + bounds.width &&
          y >= bounds.y &&
          y <= bounds.y + bounds.height
        );
      })?.id ?? null
    );
  };

  /** Cancellation restores the starting placement; a completed armory drop returns it to inventory. */
  const finishDrag = (
    id: string,
    pointerId: number,
    shouldRestore = false,
    targetId: string | null = null,
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId || drag.placement.id !== id) return;
    dragRef.current = null;
    setStorageTargetId(null);
    if (shouldRestore) {
      updatePlacements((placements) =>
        placements.map((placement) =>
          placement.id === id ? drag.placement : placement,
        ),
      );
      setActiveRoom(getHomePlacementRoom(drag.placement));
    } else if (targetId) storeFurniture(id);
  };

  /** Place an owned piece on nearby free ground; a full room leaves it safely in inventory. */
  const selectFurniture = (id: string) => {
    setSelectedId(id);
    const existing = placements.find((placement) => placement.id === id);
    if (existing) focusRoom(getHomePlacementRoom(existing));
    const piece = furnitureById.get(id);
    const targetRoom = piece?.action === "farm" ? "yard" : activeRoom;
    if (
      !piece ||
      placements.some((placement) => placement.id === id) ||
      placements.filter((placement) => getHomePlacementRoom(placement) === targetRoom)
        .length >= HOME_FURNITURE_MAX_PLACEMENTS ||
      isMovementDisabled
    )
      return;
    const placement = fitHomeFurniturePlacement(
      {
        id,
        ...(targetRoom !== "main" ? { room: targetRoom } : {}),
        x: 50,
        y: piece.action === "farm" ? 95 : 50,
        rotation: 0,
      },
      piece,
      placements,
      furniture,
      homeType,
    );
    if (placement) {
      updatePlacements((placements) => [...placements, placement]);
      focusRoom(targetRoom);
    } else
      setPlacementError(
        `${piece.name} does not fit. Store or move another piece to make room.`,
      );
  };

  /** Keep the occupied floor center steady when changing between independently painted directions. */
  const rotateFurniture = () => {
    if (!selected || !selectedFurniture || isMovementDisabled) return;
    const rotations = getHomeFurnitureRotations(selectedFurniture);
    const rotation =
      rotations[(rotations.indexOf(selected.rotation) + 1) % rotations.length] ?? 0;
    const next = { ...selected, rotation };
    const before = getHomeFurnitureGeometry(
      selectedFurniture,
      selected,
      homeType,
    ).footprint;
    const after = getHomeFurnitureGeometry(selectedFurniture, next, homeType).footprint;
    const anchor = projectHomePlacement(next);
    const candidate = {
      ...next,
      ...unprojectHomePlacement({
        x: anchor.x + before.x + before.width / 2 - after.x - after.width / 2,
        y: anchor.y + before.y + before.height / 2 - after.y - after.height / 2,
      }),
    };
    const fitted = fitHomeFurniturePlacement(
      candidate,
      selectedFurniture,
      placements,
      furniture,
      homeType,
    );
    if (fitted)
      updatePlacements((placements) =>
        placements.map((placement) =>
          placement.id === selected.id ? fitted : placement,
        ),
      );
    else
      setPlacementError(
        "This view does not fit here. Move or store another piece first.",
      );
  };

  /** Preserve rejected drafts; only an accepted guarded save closes the editor. */
  const saveLayout = async () => {
    if (!draft || !onSave || isMovementDisabled || hasMissingFurniture) return;
    dragRef.current = null;
    setStorageTargetId(null);
    if (await onSave(draft)) onDecoratingChange(false);
  };

  // Share the visible selection projection between its actions and collision-free camera controls.
  const selectedScreenBounds = (() => {
    if (!isEditing || !selected || !selectedFurniture) return null;
    const bounds = roomBounds(selectedFurniture, selected);
    const left = camera.x + bounds.x * camera.scale;
    const top = camera.y + bounds.y * camera.scale;
    const width = bounds.width * camera.scale;
    const height = bounds.height * camera.scale;
    if (left + width < 0 || left > 100 || top + height < 0 || top > 100) return null;
    return { left, top, width };
  })();

  return (
    <div className="space-y-3">
      <fieldset
        ref={sceneRef}
        aria-label="Home scene"
        style={{ aspectRatio: HOME_ART_PLANS[homeType].aspectRatio ?? 4 / 3 }}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The scene supports keyboard camera panning.
        tabIndex={0}
        className={cn(
          "relative w-full overflow-hidden rounded-lg border border-stone-700/40 bg-[#24211c] shadow-md",
          "touch-none outline-none focus-visible:ring-2 focus-visible:ring-primary",
        )}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const direction = FURNITURE_DIRECTIONS.find(({ key }) => key === event.key);
          if (!direction) return;
          event.preventDefault();
          setCamera((current) =>
            boundHomeCamera(
              {
                ...current,
                x: current.x - direction.dx * 10,
                y: current.y - direction.dy * 10,
              },
              homeType,
            ),
          );
        }}
        onPointerDownCapture={(event) => {
          if (
            event.button !== 0 ||
            (event.target as HTMLElement).closest("[data-home-controls]")
          )
            return;
          if (cameraPointers.current.size === 0) {
            hasPinched.current = false;
            hasPanned.current = false;
          }
          const canPan = !(event.target as HTMLElement).closest(
            "button:not([data-home-room])",
          );
          cameraPointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
            startX: event.clientX,
            startY: event.clientY,
            canPan,
          });
          // A second pointer turns a furniture drag into navigation, preserving its starting placement.
          if (cameraPointers.current.size > 1) {
            hasPinched.current = true;
            const drag = dragRef.current;
            if (drag) finishDrag(drag.placement.id, drag.pointerId, true);
          }
          if (canPan || hasPinched.current) {
            // Capture on a room's button so a stationary pointer still clicks that room.
            const target =
              (event.target as HTMLElement).closest<HTMLElement>("[data-home-room]") ??
              event.currentTarget;
            target.setPointerCapture(event.pointerId);
          }
        }}
        onPointerMove={(event) => {
          const previous = cameraPointers.current.get(event.pointerId);
          const rect = sceneRef.current?.getBoundingClientRect();
          if (!previous || !rect || !(rect.width > 0 && rect.height > 0)) return;
          const others = [...cameraPointers.current.entries()].filter(
            ([id]) => id !== event.pointerId,
          );
          const other = others[0]?.[1];
          cameraPointers.current.set(event.pointerId, {
            ...previous,
            x: event.clientX,
            y: event.clientY,
          });
          if (!other && !previous.canPan && !hasPinched.current) return;
          if (
            Math.hypot(
              event.clientX - previous.startX,
              event.clientY - previous.startY,
            ) > 4
          )
            hasPanned.current = true;
          setCamera((current) => {
            const before = other
              ? Math.hypot(previous.x - other.x, previous.y - other.y)
              : 0;
            const after = other
              ? Math.hypot(event.clientX - other.x, event.clientY - other.y)
              : 0;
            if (other && before > 0) {
              const scale = clamp(
                (current.scale * after) / before,
                getHomeOverviewCamera(homeType).scale,
                1.8,
              );
              const midpoint = {
                x: (((previous.x + other.x) / 2 - rect.left) / rect.width) * 100,
                y: (((previous.y + other.y) / 2 - rect.top) / rect.height) * 100,
              };
              const moved = {
                x: (((event.clientX + other.x) / 2 - rect.left) / rect.width) * 100,
                y: (((event.clientY + other.y) / 2 - rect.top) / rect.height) * 100,
              };
              return boundHomeCamera(
                zoomHomeCamera(current, scale, midpoint, moved),
                homeType,
              );
            }
            return boundHomeCamera(
              {
                ...current,
                x: current.x + ((event.clientX - previous.x) / rect.width) * 100,
                y: current.y + ((event.clientY - previous.y) / rect.height) * 100,
              },
              homeType,
            );
          });
        }}
        onPointerUp={(event) => cameraPointers.current.delete(event.pointerId)}
        onPointerCancel={(event) => cameraPointers.current.delete(event.pointerId)}
        onLostPointerCapture={(event) => cameraPointers.current.delete(event.pointerId)}
      >
        <div
          className="absolute inset-0 origin-top-left"
          data-home-camera
          style={{
            transform: `translate(${camera.x}%, ${camera.y}%) scale(${camera.scale})`,
          }}
        >
          {!hasImageError && (
            <HomePropertyBackdrop
              homeType={homeType}
              cameraScale={camera.scale}
              biome={biome}
              styles={draft?.styles ?? styles}
              onError={() => setFailedHomeType(homeType)}
            />
          )}
          {isEditing &&
            rooms.map((room) => (
              <button
                key={room.id}
                type="button"
                data-home-room={room.id}
                aria-label={`Decorate ${room.name}`}
                aria-pressed={activeRoom === room.id}
                disabled={isSaving || !canDecorate}
                className="absolute cursor-grab focus-visible:bg-amber-200/20 active:cursor-grabbing"
                style={{
                  left: `${room.x}%`,
                  top: `${room.y}%`,
                  width: `${room.width}%`,
                  height: `${room.height}%`,
                  clipPath: room.isYard
                    ? undefined
                    : `polygon(${room.interior.map(({ x, y }) => `${x}% ${y}%`).join(",")})`,
                }}
                onClick={(event) => {
                  // Finishing a camera gesture must not select the room beneath the pointer.
                  if (event.detail > 0 && (hasPanned.current || hasPinched.current))
                    return;
                  setActiveRoom(room.id);
                  setSelectedId(null);
                }}
              />
            ))}
          {placements.map((placement) => {
            const details = furnitureById.get(placement.id);
            // Inventory can change while editing; preserve the draft and give a recoverable save error below.
            if (!details) return null;
            const bounds = roomBounds(details, placement);
            const room = rooms.find(({ id }) => id === getHomePlacementRoom(placement));
            if (!room) return null;
            const depth =
              room.y + (projectHomePlacement(placement).y * room.height) / 100;
            const isSelected = isEditing && selectedId === placement.id;
            const label = isEditing
              ? `Move ${details.name}`
              : details.action === "sleep"
                ? `${details.name}: ${sleepLabel}`
                : details.action === "storage"
                  ? `${details.name}: ${isGuest ? "Home storage is in your own village" : "Open home storage"}`
                  : details.action === "kitchen"
                    ? `${details.name}: Open kitchen`
                    : details.action === "farm"
                      ? `${details.name}: Open farm`
                      : details.name;
            const style = {
              left: `${bounds.x}%`,
              top: `${bounds.y}%`,
              width: `${bounds.width}%`,
              height: `${bounds.height}%`,
              zIndex: details.isFloor ? 1 : Math.round(depth * 10) + 2,
            };
            const className = cn(
              "group absolute rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-white",
              isEditing
                ? "cursor-grab touch-none active:cursor-grabbing"
                : "cursor-pointer transition-[filter] hover:brightness-125",
              isSelected && "ring-2 ring-amber-300",
              storageTargetId === placement.id && "ring-4 ring-emerald-400",
              "disabled:cursor-not-allowed disabled:opacity-60",
            );
            const image = (
              <FurnitureImage
                furniture={details}
                rotation={placement.rotation}
                isInScene
              />
            );
            if (!isEditing && (!details.action || isVisiting))
              return (
                <div
                  key={placement.id}
                  {...(isVisiting ? { role: "img", "aria-label": details.name } : {})}
                  className="pointer-events-none absolute"
                  style={style}
                >
                  {image}
                </div>
              );
            return (
              <button
                key={placement.id}
                type="button"
                aria-label={label}
                aria-pressed={isEditing ? isSelected : undefined}
                aria-description={
                  isEditing && details.action === "storage"
                    ? "Drop furniture here to store it"
                    : undefined
                }
                disabled={
                  isVisiting ||
                  (isEditing && isMovementDisabled) ||
                  (!isEditing &&
                    ((details.action === "storage" && isGuest) ||
                      (details.action === "sleep" && isTogglingSleep)))
                }
                className={className}
                style={style}
                onClick={(event) => {
                  if (isVisiting || (hasPinched.current && event.detail > 0)) return;
                  if (isEditing) {
                    setSelectedId(placement.id);
                    setActiveRoom(getHomePlacementRoom(placement));
                  } else if (details.action === "sleep") onSleep();
                  else if (details.action === "storage") onStorage(event.currentTarget);
                  else if (details.action === "kitchen") onKitchen(event.currentTarget);
                  else if (details.action === "farm") onFarm(event.currentTarget);
                }}
                onPointerDown={(event) => {
                  if (
                    !isEditing ||
                    isMovementDisabled ||
                    event.button !== 0 ||
                    hasPinched.current ||
                    dragRef.current
                  )
                    return;
                  event.stopPropagation();
                  setSelectedId(placement.id);
                  setActiveRoom(getHomePlacementRoom(placement));
                  dragRef.current = {
                    placement,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    pointerId: event.pointerId,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const drag = dragRef.current;
                  const scene = sceneRef.current?.getBoundingClientRect();
                  if (
                    isMovementDisabled ||
                    hasPinched.current ||
                    !drag ||
                    drag.pointerId !== event.pointerId ||
                    drag.placement.id !== placement.id ||
                    !scene
                  )
                    return;
                  setStorageTargetId(
                    findStorageTarget(placement.id, event.clientX, event.clientY),
                  );
                  const origin = rooms.find(
                    ({ id }) => id === getHomePlacementRoom(drag.placement),
                  );
                  const anchor = projectHomePlacement(drag.placement);
                  const point = {
                    x:
                      (origin?.x ?? 0) +
                      (anchor.x * (origin?.width ?? 100)) / 100 +
                      ((event.clientX - drag.clientX) / (scene.width * camera.scale)) *
                        100,
                    y:
                      (origin?.y ?? 0) +
                      (anchor.y * (origin?.height ?? 100)) / 100 +
                      ((event.clientY - drag.clientY) / (scene.height * camera.scale)) *
                        100,
                  };
                  const target = rooms.find((room) =>
                    isPointInHomePolygon(
                      {
                        x: ((point.x - room.x) * 100) / room.width,
                        y: ((point.y - room.y) * 100) / room.height,
                      },
                      details.action === "farm" ? room.outdoor : room.interior,
                    ),
                  );
                  if (!target) return;
                  const local = unprojectHomePlacement({
                    x: ((point.x - target.x) * 100) / target.width,
                    y: ((point.y - target.y) * 100) / target.height,
                  });
                  moveFurniture(placement.id, local.x, local.y, target.id);
                }}
                onPointerUp={(event) =>
                  finishDrag(
                    placement.id,
                    event.pointerId,
                    false,
                    findStorageTarget(placement.id, event.clientX, event.clientY),
                  )
                }
                onPointerCancel={(event) =>
                  finishDrag(placement.id, event.pointerId, true)
                }
                onLostPointerCapture={(event) =>
                  finishDrag(placement.id, event.pointerId)
                }
                onKeyDown={(event) => {
                  if (!isEditing || isMovementDisabled) return;
                  const direction = FURNITURE_DIRECTIONS.find(
                    (direction) => direction.key === event.key,
                  );
                  if (!direction) return;
                  event.preventDefault();
                  setSelectedId(placement.id);
                  setActiveRoom(getHomePlacementRoom(placement));
                  moveFurniture(
                    placement.id,
                    placement.x + direction.dx,
                    placement.y + direction.dy,
                  );
                }}
              >
                {image}
                {isAsleep && !isEditing && details.action === "sleep" && (
                  // A decorative cue follows the bed's painted bounds; reduced motion keeps the letters still.
                  <span
                    aria-hidden
                    className="pointer-events-none absolute bottom-full left-1/2 flex -translate-x-1/2 items-end font-bold text-amber-100 text-xl drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] sm:text-2xl"
                  >
                    {["z", "z", "Z"].map((letter, index) => (
                      <span
                        key={index}
                        className="inline-block motion-safe:animate-home-sleep"
                        style={{
                          animationDelay: `${-index}s`,
                          fontSize: `${0.7 + index * 0.2}em`,
                        }}
                      >
                        {letter}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {isEditing && !selectedScreenBounds && (
          <span className="pointer-events-none absolute top-3 left-3 z-[10000] rounded-full bg-slate-950/85 px-3 py-1 font-semibold text-amber-200 text-xs">
            Decorating
          </span>
        )}
        {hasImageError && (
          <p
            role="status"
            className="pointer-events-none absolute inset-x-4 top-4 z-[10000] text-center text-sm text-white"
          >
            Home artwork is unavailable. Your furniture and text controls still work.
          </p>
        )}
        {selectedScreenBounds &&
          selected &&
          selectedFurniture &&
          (() => {
            const rotations = getHomeFurnitureRotations(selectedFurniture);
            const { left, top, width } = selectedScreenBounds;
            // Clamp each highlight corner independently so an off-scene corner cannot shift the visible action.
            return (
              <fieldset
                aria-label="Furniture controls"
                data-home-controls
                className="pointer-events-none absolute z-[10000] min-w-8"
                style={{
                  left: `clamp(1rem, ${left}%, calc(100% - 3rem))`,
                  right: `clamp(1rem, ${100 - left - width}%, calc(100% - 3rem))`,
                  top: `clamp(1rem, ${top}%, calc(100% - 1rem))`,
                }}
              >
                <Button
                  variant="outline"
                  size="icon"
                  className="pointer-events-auto absolute top-0 left-0 h-8 w-8 -translate-x-1/2 -translate-y-1/2 shadow-md"
                  aria-label="Rotate clockwise"
                  aria-description={`Current orientation: ${HOME_FURNITURE_ROTATION_DEGREES[selected.rotation]}°`}
                  hoverText="Rotate clockwise"
                  disabled={
                    isMovementDisabled ||
                    (rotations.length === 1 && rotations.includes(selected.rotation))
                  }
                  onClick={rotateFurniture}
                >
                  <RotateCw className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="pointer-events-auto absolute top-0 right-0 h-8 w-8 translate-x-1/2 -translate-y-1/2 shadow-md"
                  aria-label="Store"
                  hoverText="Store in inventory"
                  disabled={isMovementDisabled}
                  onClick={() => storeFurniture(selected.id)}
                >
                  <Package className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </fieldset>
            );
          })()}
        <fieldset
          aria-label="Property navigation"
          data-home-controls
          // Keep navigation opposite the selected piece's screen-space action row.
          className={cn(
            "absolute right-2 z-[10000] flex items-center gap-1 rounded-md bg-slate-950/85 p-1 shadow-md",
            selectedScreenBounds && selectedScreenBounds.top > 50
              ? "top-2"
              : "bottom-2",
          )}
        >
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 hover:text-black"
            aria-label="Zoom out"
            onClick={() =>
              setCamera((current) =>
                boundHomeCamera(
                  zoomHomeCamera(
                    current,
                    Math.max(
                      getHomeOverviewCamera(homeType).scale,
                      current.scale / 1.2,
                    ),
                    {
                      x: 50,
                      y: 50,
                    },
                  ),
                  homeType,
                ),
              )
            }
          >
            <Minus className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <output
            aria-label="Camera zoom"
            className="min-w-10 text-center text-white text-xs tabular-nums"
          >
            {Math.round((camera.scale / getHomeOverviewCamera(homeType).scale) * 100)}%
          </output>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 hover:text-black"
            aria-label="Zoom in"
            onClick={() =>
              setCamera((current) =>
                boundHomeCamera(
                  zoomHomeCamera(current, Math.min(1.8, current.scale * 1.2), {
                    x: 50,
                    y: 50,
                  }),
                  homeType,
                ),
              )
            }
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 hover:text-black"
            aria-label="Reset view"
            hoverText="Reset view"
            onClick={() => setCamera(getHomeOverviewCamera(homeType))}
          >
            <Maximize className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </fieldset>
      </fieldset>
      <p className="px-3 text-muted-foreground text-xs">
        Drag empty space to pan. Pinch or scroll to zoom. Use arrow keys to pan.
        {isEditing && " Select a room to change its finishes."}
      </p>
      {isEditing && (
        <div className="mx-3 space-y-3 rounded-lg border bg-muted/40 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">
              {rooms.find(({ id }) => id === activeRoom)?.name} ·{" "}
              {
                placements.filter(
                  (placement) => getHomePlacementRoom(placement) === activeRoom,
                ).length
              }
              /{HOME_FURNITURE_MAX_PLACEMENTS} pieces
            </span>
            {activeRoom !== "yard" && (
              <label className="text-sm">
                Wall paint{" "}
                <select
                  aria-label="Wall paint"
                  className="rounded border bg-background p-2"
                  disabled={isMovementDisabled}
                  value={
                    (draft?.styles ?? styles).find(({ room }) => room === activeRoom)
                      ?.paint ?? "ivory"
                  }
                  onChange={(event) =>
                    updateRoomStyle({
                      paint: event.target.value as HomeRoomStyle["paint"],
                    })
                  }
                >
                  {Object.keys(HOME_WALL_PAINTS).map((paint) => (
                    <option key={paint} value={paint}>
                      {paint}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {activeRoom !== "yard" && (
              <label className="text-sm">
                Floor tiles{" "}
                <select
                  aria-label="Floor tiles"
                  className="rounded border bg-background p-2"
                  disabled={isMovementDisabled}
                  value={
                    (draft?.styles ?? styles).find(({ room }) => room === activeRoom)
                      ?.floor ?? "original"
                  }
                  onChange={(event) =>
                    updateRoomStyle({
                      floor: event.target.value as HomeRoomStyle["floor"],
                    })
                  }
                >
                  {Object.keys(HOME_FLOOR_TILES).map((floor) => (
                    <option key={floor} value={floor}>
                      {floor}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selected && (
              <label className="text-sm">
                Move selected to{" "}
                <select
                  aria-label="Furniture room"
                  className="rounded border bg-background p-2"
                  disabled={isMovementDisabled}
                  value={getHomePlacementRoom(selected)}
                  onChange={(event) => {
                    const room = event.target.value as HomeRoomId;
                    const piece = furnitureById.get(selected.id);
                    if (!piece) return;
                    if (
                      placements.filter(
                        (placement) => getHomePlacementRoom(placement) === room,
                      ).length >= HOME_FURNITURE_MAX_PLACEMENTS
                    ) {
                      setPlacementError("This room is full");
                      return;
                    }
                    const fitted = moveFurniture(
                      selected.id,
                      selected.x,
                      selected.y,
                      room,
                    );
                    if (fitted) focusRoom(room);
                    else setPlacementError("This furniture does not fit in that room");
                  }}
                >
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <fieldset
            aria-label="Owned furniture"
            className="flex min-w-0 gap-2 overflow-x-auto pb-1"
          >
            {furniture.map((piece) => {
              const copies = furniture.filter((other) => other.itemId === piece.itemId);
              const isPlaced = placements.some(
                (placement) => placement.id === piece.id,
              );
              return (
                <button
                  key={piece.id}
                  type="button"
                  aria-pressed={selectedId === piece.id}
                  disabled={
                    isMovementDisabled ||
                    (!isPlaced &&
                      placements.filter(
                        (placement) =>
                          getHomePlacementRoom(placement) ===
                          (piece.action === "farm" ? "yard" : activeRoom),
                      ).length >= HOME_FURNITURE_MAX_PLACEMENTS)
                  }
                  className={cn(
                    "flex w-24 shrink-0 flex-col rounded-lg border bg-background p-2 text-xs focus-visible:outline-2 focus-visible:outline-primary",
                    selectedId === piece.id && "border-primary ring-1 ring-primary",
                  )}
                  onClick={() => selectFurniture(piece.id)}
                >
                  <div className="relative mb-1 aspect-[4/3] w-full">
                    <FurnitureImage furniture={piece} rotation={0} />
                  </div>
                  <span className="line-clamp-2 min-h-8">{piece.name}</span>
                  {copies.length > 1 && (
                    <span className="text-muted-foreground">
                      {copies.findIndex((other) => other.id === piece.id) + 1} /{" "}
                      {copies.length}
                    </span>
                  )}
                  {piece.quantity > 1 && (
                    <span className="text-muted-foreground">
                      Quantity: {piece.quantity}
                    </span>
                  )}
                  <span className="mt-auto pt-1 text-muted-foreground">
                    {isPlaced ? "Placed" : "Place"}
                  </span>
                </button>
              );
            })}
            {furniture.length === 0 && (
              <p className="text-muted-foreground text-sm">
                Buy furniture in the item shop to furnish your home.
              </p>
            )}
          </fieldset>
          {hasPlacementLimit && (
            <p role="status" className="text-muted-foreground text-sm">
              Each room can display up to {HOME_FURNITURE_MAX_PLACEMENTS} pieces. Store
              a piece to make room.
            </p>
          )}
          {saveError && (
            <p role="alert" className="text-destructive text-sm">
              {saveError}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10"
              aria-label="Undo changes"
              hoverText="Undo changes"
              disabled={isSaving}
              onClick={() => {
                dragRef.current = null;
                setStorageTargetId(null);
                setPlacementError(null);
                const placements = recoverHomeLayout(layout, furniture, homeType);
                setDraft({ homeType, revision, placements, styles });
                setSelectedId(
                  placements.find(
                    (placement) => getHomePlacementRoom(placement) === activeRoom,
                  )?.id ?? null,
                );
              }}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant="outline"
              className="h-10"
              disabled={isSaving}
              onClick={() => onDecoratingChange(false)}
            >
              Cancel
            </Button>
            <Button
              className="h-10"
              aria-label={isSaving ? "Saving…" : "Save layout"}
              disabled={isMovementDisabled || hasMissingFurniture}
              onClick={() => void saveLayout()}
            >
              <Save className="mr-2 h-4 w-4" aria-hidden />
              {isSaving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {isTogglingSleep
          ? "Changing sleep status…"
          : isAsleep
            ? "You are asleep. Resting restores your energy."
            : "You are awake."}
      </p>
      {!isEditing && !isVisiting && (
        <fieldset
          aria-label="Home actions"
          className="grid grid-cols-2 gap-2 px-3 pb-3 sm:grid-cols-4"
        >
          <Button onClick={onSleep} disabled={isTogglingSleep} className="h-11 px-2">
            <BedDouble className="mr-2 h-4 w-4" aria-hidden />
            {sleepLabel}
          </Button>
          <Button
            onClick={(event) => onStorage(event.currentTarget)}
            disabled={isGuest}
            className="h-11 px-2"
          >
            <Package className="mr-2 h-4 w-4" aria-hidden />
            Home storage
          </Button>
          <Button
            onClick={(event) => onKitchen(event.currentTarget)}
            className="h-11 px-2"
          >
            <ChefHat className="mr-2 h-4 w-4" aria-hidden />
            Kitchen
          </Button>
          <Button
            onClick={(event) => onFarm(event.currentTarget)}
            className="h-11 px-2"
          >
            <Sprout className="mr-2 h-4 w-4" aria-hidden />
            Farm
          </Button>
        </fieldset>
      )}
    </div>
  );
};

/** Tight alpha bounds crop transparent margins in CSS; every painted direction keeps its native proportions. */
const FurnitureImage = ({
  furniture,
  rotation,
  isInScene = false,
}: {
  furniture: HomeFurniture;
  rotation: HomeFurnitureRotation;
  isInScene?: boolean;
}) => {
  const view = getHomeFurnitureView(furniture, rotation);
  const bounds = view.geometry.visibleBounds;
  const aspectRatio = (view.geometry.aspectRatio * bounds.width) / bounds.height;
  return (
    <div
      className={cn(
        "pointer-events-none relative overflow-hidden",
        isInScene ? "h-full w-full" : "mx-auto max-h-full max-w-full",
      )}
      style={
        isInScene
          ? undefined
          : {
              aspectRatio,
              width: aspectRatio < 4 / 3 ? `${(aspectRatio / (4 / 3)) * 100}%` : "100%",
            }
      }
    >
      <picture
        className="absolute"
        style={{
          width: `${10000 / bounds.width}%`,
          height: `${10000 / bounds.height}%`,
          left: `${(-bounds.x / bounds.width) * 100}%`,
          top: `${(-bounds.y / bounds.height) * 100}%`,
        }}
      >
        <source
          srcSet={[128, 256, 400, 768]
            .map((width) => `${bunnyImageUrl(view.image, width)} ${width}w`)
            .join(", ")}
          sizes={
            isInScene
              ? `(max-width: 768px) ${view.width}vw, ${Math.round(view.width * 7.68)}px`
              : "80px"
          }
        />
        <Image
          src={bunnyImageUrl(view.image, isInScene ? 400 : 128)}
          alt=""
          width={400}
          height={Math.round(400 / view.geometry.aspectRatio)}
          className="h-full w-full select-none"
          draggable={false}
        />
      </picture>
    </div>
  );
};

/** Keyboard users retain precise movement without a second visible movement toolbar. */
const FURNITURE_DIRECTIONS = [
  { key: "ArrowLeft", dx: -2, dy: 0 },
  { key: "ArrowUp", dx: 0, dy: -2 },
  { key: "ArrowDown", dx: 0, dy: 2 },
  { key: "ArrowRight", dx: 2, dy: 0 },
] as const;

/** A draft captures its home tier and revision once; refreshes cannot silently rebase unsaved edits. */
export type HomeDraft = {
  homeType: HomeType;
  revision: number;
  placements: HomePlacement[];
  styles: HomeRoomStyle[];
};

/** Draft editing covers placements and finishes; the page owns persistence and game actions. */
type HomeSceneProps = {
  homeType: HomeType;
  biome?: CombatBiome;
  styles?: HomeRoomStyle[];
  isVisiting?: boolean;
  isGuest: boolean;
  isAsleep: boolean;
  isTogglingSleep: boolean;
  isDecorating: boolean;
  onDecoratingChange: (isDecorating: boolean) => void;
  onSleep: () => void;
  onStorage: (trigger: HTMLButtonElement) => void;
  onKitchen: (trigger: HTMLButtonElement) => void;
  onFarm: (trigger: HTMLButtonElement) => void;
  layout?: HomePlacement[];
  furniture?: HomeFurniture[];
  revision?: number;
  canDecorate?: boolean;
  isSaving?: boolean;
  isRefreshingFurniture?: boolean;
  furnitureError?: string | null;
  /** Return success only after the guarded server save; rejection preserves the draft. */
  onSave?: (draft: HomeDraft) => Promise<boolean>;
};
