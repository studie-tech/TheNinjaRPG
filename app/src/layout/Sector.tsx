"use client";

import React from "react";
import { useRef, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import alea from "alea";
import AvatarImage from "@/layout/Avatar";
import Modal2 from "@/layout/Modal2";
import SliderField from "@/layout/SliderField";
import WebGlError from "@/layout/WebGLError";
import { LogbookEntry } from "@/layout/Logbook";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "src/components/ui/label";
import { z } from "zod";
import { useLocalStorage } from "@/hooks/localstorage";
import { useForm } from "react-hook-form";
import { Vector2, OrthographicCamera, Group } from "three";
import { api } from "@/app/_trpc/client";
import { useRouter } from "next/navigation";
import { PathCalculator, findHex } from "@/libs/hexgrid";
import { OrbitControls } from "@/libs/threejs/OrbitControls";
import { getBackgroundColor } from "@/libs/travel/biome";
import { cleanUp, setupScene, setRaycasterFromMouse } from "@/libs/travel/util";
import { drawSector, drawVillage, drawUsers, drawQuest } from "@/libs/travel/sector";
import { intersectUsers } from "@/libs/travel/sector";
import { intersectTiles } from "@/libs/travel/sector";
import { useRequiredUserData } from "@/utils/UserContext";
import { showMutationToast } from "@/libs/toast";
import { isLocationObjective } from "@/libs/quest";
import { getAllyStatus } from "@/utils/alliance";
import { zodResolver } from "@hookform/resolvers/zod";
import { round } from "@/utils/math";
import { sleep } from "@/utils/time";
import { findVillageUserRelationship } from "@/utils/alliance";
import { isQuestObjectiveAvailable } from "@/libs/objectives";
import { SECTOR_LENGTH_TO_WIDTH } from "@/libs/travel/constants";
import { RANKS_RESTRICTED_FROM_PVP, MEDNIN_MIN_RANK } from "@/drizzle/constants";
import { WAR_SHRINE_IMAGE } from "@/drizzle/constants";
import {
  IMG_SECTOR_INFO,
  IMG_SECTOR_ATTACK,
  IMG_SECTOR_ROB,
  IMG_ICON_MOVE,
} from "@/drizzle/constants";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { UserData } from "@/drizzle/schema";
import type { Grid } from "honeycomb-grid";
import type { GlobalTile, SectorPoint, SectorUser } from "@/libs/travel/types";
import type { TerrainHex } from "@/libs/hexgrid";
import type { VillageStructure } from "@/drizzle/schema";
import { createGenericStructure } from "@/libs/travel/sector";
import { hasRequiredRank } from "@/libs/train";
import HealingPopover from "@/layout/HealingPopover";

interface SectorProps {
  sector: number;
  tile: GlobalTile;
  target: SectorPoint | null;
  showSorrounding: boolean;
  showActive: boolean;
  autoAttackMode: boolean;
  setShowSorrounding: React.Dispatch<React.SetStateAction<boolean>>;
  setTarget: React.Dispatch<React.SetStateAction<SectorPoint | null>>;
  setPosition: React.Dispatch<React.SetStateAction<SectorPoint | null>>;
}

const Sector: React.FC<SectorProps> = (props) => {
  // Incoming props
  const { sector, target, showActive, autoAttackMode } = props;
  const { setTarget, setPosition } = props;

  // State pertaining to the sector
  const [webglError, setWebglError] = useState<boolean>(false);
  const [targetUser, setTargetUser] = useState<SectorUser | null>(null);
  const [healTargetUser, setHealTargetUser] = useState<SectorUser | null>(null);
  const [moves, setMoves] = useState(0);
  const [sorrounding, setSorrounding] = useState<SectorUser[]>([]);
  const [allyAttack, setAllyAttack] = useLocalStorage<boolean>("friendlyAttack", false);
  const [storedLvl, setStoredLvl] = useLocalStorage<number>("minLevelOnScout", 1);
  const [currentStructure, setCurrentStructure] = useState<VillageStructure | null>(
    null,
  );
  const [logbookModalOpen, setLogbookModalOpen] = useState<boolean>(false);
  const [logbookModalQuestId, setLogbookModalQuestId] = useState<string | null>(null);

  // References which shouldn't update
  const origin = useRef<TerrainHex | undefined>(undefined);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const pathFinder = useRef<PathCalculator | null>(null);
  const grid = useRef<Grid<TerrainHex> | null>(null);
  const users = useRef<SectorUser[]>([]);
  const showUsers = useRef<boolean>(showActive);
  const minLevelDraw = useRef<number>(storedLvl);
  const showAllyAttack = useRef<boolean>(allyAttack);
  const userRef = useRef<UserWithRelations>(undefined);
  const mouse = new Vector2();

  // tRPC utility
  const utils = api.useUtils();

  // Data from db
  const { data: userData, pusher, updateUser } = useRequiredUserData();
  const { data } = api.travel.getSectorData.useQuery(
    { sector: sector },
    { enabled: sector !== undefined },
  );
  const villageData = data?.village;
  const fetchedUsers = data?.users;
  const structures = villageData?.structures || [];

  // If we're in an active sector war, then we add a shrine to the center of the sector
  const shrine = createGenericStructure({
    name: "Sector Shrine",
    route: "/shrine",
    image: WAR_SHRINE_IMAGE,
    longitude: 10,
    latitude: 5,
  });
  structures.push(shrine);

  // Router for forwarding
  const router = useRouter();

  // Convenience calculations
  const isInSector = userData?.sector === props.sector;

  // Background color for the map
  const { color } = getBackgroundColor(props.tile);

  // If new objective is available, then show a modal
  const modalUserQuest = userData?.userQuests?.find(
    (q) => q.questId === logbookModalQuestId,
  );
  const modalTracker = userData?.questData?.find((q) => q.id === logbookModalQuestId);

  // Update mouse position on mouse move
  const onDocumentMouseMove = (event: MouseEvent) => {
    if (mountRef.current) {
      const bounding_box = mountRef.current.getBoundingClientRect();
      mouse.x = (event.offsetX / bounding_box.width) * 2 - 1;
      mouse.y = -((event.offsetY / bounding_box.height) * 2 - 1);
    }
  };

  // Movement based on ASDQWE keys
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (origin.current && pathFinder.current) {
      const x = origin.current.col;
      const y = origin.current.row;
      switch (event.key) {
        // Up & Down
        case "w":
          setTarget({ x: x, y: y + 1 });
          break;
        case "s":
          setTarget({ x: x, y: y - 1 });
          break;
        // High left & right
        case "q":
          setTarget({ x: x - 1, y: x % 2 === 0 ? y : y + 1 });
          break;
        case "e":
          setTarget({ x: x + 1, y: x % 2 === 0 ? y : y + 1 });
          break;
        // Low left & right
        case "a":
          setTarget({ x: x - 1, y: x % 2 === 0 ? y - 1 : y });
          break;
        case "d":
          setTarget({ x: x + 1, y: x % 2 === 0 ? y - 1 : y });
          break;
      }
    }
  };

  const { mutate: checkQuest } = api.quests.checkLocationQuest.useMutation({
    onSuccess: async (result) => {
      if (result.success) {
        // Push any notifications
        result.notifications.forEach((notification) => {
          showMutationToast({
            success: true,
            message: notification,
          });
        });
        // Update user quest data immidiately
        if (result.questData && result.updateAt) {
          await updateUser({ questData: result.questData, updatedAt: result.updateAt });
        }
        // Invalidate user items
        await utils.item.getUserItems.invalidate();
      }
      // If there are any quest ids that have been updated,
      // let's see if we should show a modal with new objective for consecutive quests
      if (result.questIdsUpdated && result.questIdsUpdated.length > 0) {
        result.questIdsUpdated.forEach((questId) => {
          const quest = userData?.userQuests?.find((q) => q.questId === questId);
          if (quest?.quest?.consecutiveObjectives) {
            setLogbookModalOpen(true);
            setLogbookModalQuestId(questId);
          }
        });
      }
    },
  });

  // Convenience method for updating user list
  const updateUsersList = async (data: UserData, instantMove = false) => {
    if (data.userId) {
      if (users.current) {
        const allianceStatus = getAllyStatus(userData?.village, data.villageId);
        const idx = users.current
          .filter((u) => u.userId)
          .findIndex((u) => u.userId === data.userId);
        if (idx !== -1 && users.current[idx]) {
          if (instantMove) {
            // User exists - instant movement
            users.current[idx] = { ...data, allianceStatus };
          } else {
            // User exists - animate movement
            const currentHex = findHex(grid.current, {
              x: users.current[idx]?.longitude ?? 0,
              y: users.current[idx]?.latitude ?? 0,
            });
            const targetHex = findHex(grid.current, {
              x: data.longitude,
              y: data.latitude,
            });
            if (pathFinder.current && currentHex && targetHex) {
              const path = pathFinder.current.getShortestPath(currentHex, targetHex);
              if (path) {
                for (const tile of path) {
                  if (users.current[idx]) {
                    users.current[idx] = {
                      ...data,
                      avatar: users.current[idx].avatar,
                      avatarLight: users.current[idx].avatarLight,
                      username: users.current[idx].username,
                      allianceStatus,
                      longitude: tile.col,
                      latitude: tile.row,
                    };
                  }
                  await sleep(50);
                }
              }
            }
          }
        } else {
          // New user enters
          users.current.push({ ...data, allianceStatus });
        }
        // Remove users who are no longer in the sector
        users.current
          .map((user, idx) => (user.sector !== props.sector ? idx : null))
          .filter((idx): idx is number => idx !== null)
          .reverse()
          .map((idx) => users.current?.splice(idx, 1));
      }
    }
    setSorrounding(users.current.filter((u) => u?.userId) || []);
  };

  const { mutate: move, isPending: isMoving } = api.travel.moveInSector.useMutation({
    onSuccess: async (res) => {
      // Stop moving if failed
      if (res.success === false) {
        setTarget(null);
      }
      // If success without data, then we got attacked
      if (res.success && !res.data) {
        setTarget(null);
        showMutationToast(res);
        await utils.profile.getUser.invalidate();
      }
      // If success with data, then we moved
      const data = res.data;
      if (userData && res.success && data && pathFinder.current && origin.current) {
        // Get the path the user moved
        const target = findHex(grid.current, { x: data.longitude, y: data.latitude });
        if (!target) return;
        const path = pathFinder.current.getShortestPath(origin.current, target);
        if (!path) return;
        // Show movement 1 step at a time with a small sleep between moves
        for (const tile of path) {
          origin.current = tile;
          void updateUsersList(
            {
              ...userData,
              longitude: tile.col,
              latitude: tile.row,
              location: data.location,
            } as UserData,
            true,
          );
          setPosition({ x: tile.col, y: tile.row });
          setMoves((prev) => prev + 1);
          await updateUser({
            location: data.location,
            updatedAt: new Date(),
            longitude: tile.col,
            latitude: tile.row,
          });
          await sleep(50);
        }
      }
      // Check Quests
      if (userData && data) {
        userData?.userQuests?.forEach((userquest) => {
          const tracker = userData.questData?.find((q) => q.id === userquest.questId);
          userquest.quest.content.objectives.forEach((objective, i) => {
            // Check if we should check objective on backend
            const isOnLocation = isLocationObjective(
              {
                sector: data.sector,
                longitude: data.longitude,
                latitude: data.latitude,
              },
              objective,
            );
            if (
              // If we have don't have a tracker, or the objective is available, then check quest
              (!tracker || isQuestObjectiveAvailable(userquest.quest, tracker, i)) &&
              // If an objective is a location objective, then check quest
              (isOnLocation ||
                // If we have attackers, check for these
                ("attackers" in objective &&
                  objective.attackers &&
                  objective.attackers.length > 0))
            ) {
              checkQuest();
            }
            // For dialog objectives, check if we should show a modal
            if (objective.task === "dialog" && isOnLocation) {
              setLogbookModalOpen(true);
              setLogbookModalQuestId(userquest.questId);
            }
          });
        });
      }
    },
  });

  const { mutate: rob, isPending: isRobbing } = api.travel.robPlayer.useMutation({
    onSuccess: async (result) => {
      if (result?.battleId || result?.money) {
        await updateUser({
          ...(result.money ? { money: result.money } : {}),
          ...(result.battleId
            ? { battleId: result.battleId, updatedAt: new Date() }
            : {}),
        });
      }
      showMutationToast(result);
    },
  });

  const { mutate: attack, isPending: isAttacking } = api.combat.attackUser.useMutation({
    onSuccess: async (data) => {
      if (data.success) {
        await updateUser({
          status: "BATTLE",
          battleId: data.battleId,
          updatedAt: new Date(),
        });
      } else {
        showMutationToast({
          success: false,
          message: data.message,
        });
      }
    },
  });

  useEffect(() => {
    minLevelDraw.current = storedLvl;
  }, [storedLvl]);

  useEffect(() => {
    showAllyAttack.current = allyAttack;
  }, [allyAttack]);

  useEffect(() => {
    if (pusher) {
      const channel = pusher.subscribe(props.sector.toString());
      channel.bind("event", (data: UserData) => {
        if (data.userId && data.userId !== userData?.userId) {
          void updateUsersList(data);
        }
      });
      return () => {
        pusher.unsubscribe(props.sector.toString());
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    showUsers.current = showActive;
  }, [showActive]);

  // Auto-attack logic for ANBU users
  useEffect(() => {
    if (
      autoAttackMode &&
      userData?.anbuId &&
      userData?.status === "AWAKE" &&
      origin.current &&
      !isMoving &&
      !isAttacking
    ) {
      // Find nearby enemies to attack
      const nearbyEnemies = users.current.filter((user) => {
        if (!user.userId || user.userId === userData.userId) return false;
        if (user.status !== "AWAKE") return false;

        // Check if user is an enemy (different village and not ally)
        const isAlly =
          user.villageId === userData.villageId || user.allianceStatus === "ALLY";

        if (isAlly) return false;

        // Check if user is in PvP restricted rank
        if (RANKS_RESTRICTED_FROM_PVP.includes(user.rank)) return false;

        return true;
      });
      if (nearbyEnemies.length > 0) {
        // Find the closest enemy
        const closestEnemy = nearbyEnemies.reduce((closest, enemy) => {
          const currentDistance =
            Math.abs(enemy.longitude - origin.current!.col) +
            Math.abs(enemy.latitude - origin.current!.row);
          const closestDistance =
            Math.abs(closest.longitude - origin.current!.col) +
            Math.abs(closest.latitude - origin.current!.row);

          return currentDistance < closestDistance ? enemy : closest;
        });
        // If on the same tile, attack, otherwise setTarget
        if (
          closestEnemy.longitude === origin.current.col &&
          closestEnemy.latitude === origin.current.row
        ) {
          attack({
            userId: closestEnemy.userId,
            longitude: closestEnemy.longitude,
            latitude: closestEnemy.latitude,
            sector: sector,
            asset: origin.current?.asset,
          });
        } else {
          setTarget({ x: closestEnemy.longitude, y: closestEnemy.latitude });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorrounding]);

  // Clear heal target if user moves away or target moves away
  useEffect(() => {
    if (healTargetUser && userData && origin.current) {
      const isOnSameTile =
        healTargetUser.longitude === origin.current.col &&
        healTargetUser.latitude === origin.current.row;

      if (!isOnSameTile) {
        setHealTargetUser(null);
      }
    }
  }, [healTargetUser, userData, sorrounding]);

  // This is where the actual movement happens
  useEffect(() => {
    if (target && origin.current && pathFinder.current && userData && userData.avatar) {
      // Check user status
      if (userData.status !== "AWAKE") {
        setTarget(null);
        return;
      }
      // Get target hex
      const targetHex = grid?.current?.getHex({ col: target.x, row: target.y });
      // Guards
      if (!targetHex) return;
      if (target.x === origin.current.col && target.y === origin.current.row) return;
      // Clear heal target if moving away
      if (healTargetUser) {
        setHealTargetUser(null);
      }
      // Get shortest path
      if (!isMoving) {
        document.body.style.cursor = "wait";
        move({
          curLongitude: origin.current.col,
          curLatitude: origin.current.row,
          longitude: targetHex.col,
          latitude: targetHex.row,
          sector: sector,
          avatar: userData.avatar,
          avatarLight: userData.avatarLight || userData.avatar,
          villageId: userData.villageId,
          battleId: userData.battleId,
          username: userData.username,
          level: userData.level,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, userData, moves, sector, isMoving, move]);

  // Update the state containing sorrounding users on first load
  useEffect(() => {
    if (userData) {
      const enrichedData =
        fetchedUsers
          ?.map((user) => {
            const allianceStatus = getAllyStatus(userData?.village, user.villageId);
            return { ...user, allianceStatus };
          })
          .filter((u) => u?.userId) || [];
      setSorrounding(enrichedData);
      users.current = enrichedData;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedUsers]);

  // Update information whenever we fetch new user data
  useEffect(() => {
    if (userData) {
      void updateUsersList(userData);
      userRef.current = userData;

      // Check if user is on a structure
      if (structures) {
        const structure = structures.find(
          (s) => s.longitude === userData.longitude && s.latitude === userData.latitude,
        );
        setCurrentStructure(structure || null);
      } else {
        setCurrentStructure(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData, villageData]);

  useEffect(() => {
    const sceneRef = mountRef.current;
    if (sceneRef && userRef.current && fetchedUsers !== undefined) {
      // Map size
      const WIDTH = sceneRef.getBoundingClientRect().width;
      const HEIGHT = WIDTH * SECTOR_LENGTH_TO_WIDTH;

      // Performance monitor
      // const stats = new Stats();
      // document.body.appendChild(stats.dom);

      // Listeners
      sceneRef.addEventListener("mousemove", onDocumentMouseMove, false);
      document.addEventListener("keydown", onDocumentKeyDown, false);

      // Seeded noise generator for map gen
      const prng = alea(props.sector + 1);

      // Setup scene, renderer and raycaster
      const { scene, renderer, raycaster, handleResize } = setupScene({
        mountRef: mountRef,
        width: WIDTH,
        height: HEIGHT,
        sortObjects: false,
        color: color,
        colorAlpha: 1,
        width2height: SECTOR_LENGTH_TO_WIDTH,
      });

      // If no renderer, then we have an error with the browser, let the user know
      if (!renderer) {
        setWebglError(true);
        return;
      }

      // Create scene
      sceneRef.appendChild(renderer.domElement);

      // Setup camara
      const camera = new OrthographicCamera(0, WIDTH, HEIGHT, 0, -10, 10);
      camera.zoom = villageData ? 1 : 2;
      camera.updateProjectionMatrix();

      // Draw the map
      const { group_tiles, group_edges, group_assets, honeycombGrid } = drawSector(
        WIDTH,
        prng,
        villageData !== undefined,
        props.tile,
      );
      grid.current = honeycombGrid;

      // Draw any village in this sector
      group_assets.add(drawVillage(villageData, structures, grid.current));

      // Store current highlights and create a path calculator object
      pathFinder.current = new PathCalculator(grid.current);

      // Intersections & highlights from interactions
      let highlights = new Set<string>();
      let currentTooltips = new Set<string>();

      // js groups for organization
      const group_users = new Group();
      const group_quest = new Group();

      // Set the origin
      if (!origin.current) {
        origin.current = grid?.current?.getHex({
          col: userRef.current.longitude,
          row: userRef.current.latitude,
        });
      }

      // Enable controls
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableRotate = false;
      controls.zoomSpeed = 1.0;
      controls.minZoom = 1;
      controls.maxZoom = 3;

      // Set initial position of controls & camera
      if (isInSector && origin.current) {
        const { x, y } = origin.current.center;
        controls.target.set(-WIDTH / 2 - x, -HEIGHT / 2 - y, 0);
        camera.position.copy(controls.target);
      }

      // Add the group to the scene
      scene.add(group_tiles);
      scene.add(group_edges);
      scene.add(group_assets);
      scene.add(group_quest);
      scene.add(group_users);

      // Capture clicks to update move direction
      const onClick = (e: MouseEvent) => {
        // Find intersects with the scene
        setRaycasterFromMouse(raycaster, sceneRef, e, camera);
        const intersects = raycaster.intersectObjects(scene.children);
        intersects
          .filter((i) => i.object.visible)
          .every((i) => {
            if (i.object.userData.type === "tile") {
              const target = i.object.userData.tile as TerrainHex;
              setTarget({ x: target.col, y: target.row });
              return false;
            } else if (showUsers.current && i.object.userData.type === "attack") {
              const target = users.current?.find(
                (u) => u.userId === i.object.userData.userId,
              );
              if (target) {
                if (
                  target.longitude === origin.current?.col &&
                  target.latitude === origin.current?.row &&
                  !isAttacking
                ) {
                  document.body.style.cursor = "wait";
                  setTargetUser(target);
                  attack({
                    userId: target.userId,
                    longitude: target.longitude,
                    latitude: target.latitude,
                    sector: sector,
                    asset: origin.current?.asset,
                  });
                } else {
                  setTarget({ x: target.longitude, y: target.latitude });
                }
              }
              return false;
            } else if (showUsers.current && i.object.userData.type === "heal") {
              const target = users.current?.find(
                (u) => u.userId === i.object.userData.userId,
              );
              if (target) {
                if (
                  target.longitude === origin.current?.col &&
                  target.latitude === origin.current?.row
                ) {
                  setHealTargetUser(target);
                } else {
                  setTarget({ x: target.longitude, y: target.latitude });
                }
              }
              return false;
            } else if (showUsers.current && i.object.userData.type === "info") {
              const userId = i.object.userData.userId as string;
              void router.push(`/userid/${userId}`);
              return false;
            } else if (showUsers.current && i.object.userData.type === "marker") {
              return true;
            } else if (
              i.object.userData.type === "battleMarker" &&
              i.object.userData.battleId
            ) {
              void router.push(`/battlelog/${i.object.userData.battleId}`);
              return false;
            }
            return true;
          });
      };
      renderer.domElement.addEventListener("click", onClick, true);

      // Render the image
      let lastTime = Date.now();
      let animationId = 0;
      let userAngle = 0;
      function render() {
        // Use raycaster to detect mouse intersections
        raycaster.setFromCamera(mouse, camera);

        // Assume we have user, users and a grid
        if (userRef.current && users.current && grid.current) {
          // Draw all users on the map + indicators for positions with multiple users
          userAngle = drawUsers({
            group_users: group_users,
            users: showUsers.current
              ? users.current
              : users.current.filter((u) => u.userId === userRef?.current?.userId),
            grid: grid.current,
            lastTime: lastTime,
            angle: userAngle,
            minLevel: minLevelDraw.current,
          });
          lastTime = Date.now();

          // Draw interactions with user sprites
          currentTooltips = intersectUsers({
            group_users,
            raycaster,
            allyAttack: showAllyAttack.current,
            users: users.current,
            userData: userRef.current,
            currentTooltips,
          });

          // Draw quests
          drawQuest({ group_quest, user: userRef.current, grid: grid.current });
        }

        // Detect intersections with tiles for movement
        if (pathFinder.current && origin.current) {
          highlights = intersectTiles({
            group_tiles,
            raycaster,
            pathFinder: pathFinder.current,
            origin: origin.current,
            currentHighlights: highlights,
          });
        }

        // Trackball updates
        controls.update();

        // Render the scene
        animationId = requestAnimationFrame(render);
        renderer?.render(scene, camera);
      }
      render();

      // Every time we refresh this component, fire off a move counter to make sure other useEffects are updated
      setMoves((prev) => prev + 1);

      // Remove the mouseover listener
      return () => {
        window.removeEventListener("resize", handleResize);
        document.removeEventListener("keydown", onDocumentKeyDown, false);
        sceneRef.removeEventListener("mousemove", onDocumentMouseMove);
        cleanUp(scene, renderer);
        cancelAnimationFrame(animationId);
        if (sceneRef.contains(renderer.domElement)) {
          sceneRef.removeChild(renderer.domElement);
        }
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sector, isAttacking, fetchedUsers]);

  return (
    <>
      <div ref={mountRef}></div>
      {webglError && <WebGlError />}
      {currentStructure && (
        <div className="absolute bottom-4 left-4 z-20 rounded-lg bg-black/70 p-4 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              <Image
                src={currentStructure.image}
                alt={currentStructure.name}
                width={48}
                height={48}
                className="rounded-md"
              />
            </div>
            <div>
              <h3 className="text-lg font-semibold">{currentStructure.name}</h3>
              <Link
                href={currentStructure.route}
                className="mt-2 inline-block rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
              >
                Enter {currentStructure.name}
              </Link>
            </div>
          </div>
        </div>
      )}
      {props.showSorrounding && sorrounding && userData && origin.current && (
        <SorroundingUsers
          setIsOpen={props.setShowSorrounding}
          users={sorrounding}
          userId={userData.userId}
          hex={origin.current}
          allyAttack={allyAttack}
          setAllyAttack={setAllyAttack}
          storedLvl={storedLvl}
          setStoredLvl={setStoredLvl}
          attackUser={(userId) => {
            const target = sorrounding.find((u) => u.userId === userId);
            if (target && !isAttacking) {
              attack({
                userId: target.userId,
                longitude: target.longitude,
                latitude: target.latitude,
                sector: sector,
                asset: origin.current?.asset,
              });
            }
          }}
          robUser={(userId) => {
            const target = sorrounding.find((u) => u.userId === userId);
            if (target && !isRobbing) {
              rob({
                userId: target.userId,
                longitude: target.longitude,
                latitude: target.latitude,
                sector: sector,
              });
            }
          }}
          move={(longitude, latitude) => {
            setTarget({ x: longitude, y: latitude });
          }}
        />
      )}
      {logbookModalOpen && modalUserQuest && modalTracker && (
        <Modal2
          isOpen={logbookModalOpen}
          setIsOpen={setLogbookModalOpen}
          title="Quest Update"
        >
          <LogbookEntry
            userQuest={modalUserQuest}
            tracker={modalTracker}
            showScene={true}
            hideTitle={false}
          />
        </Modal2>
      )}
      {targetUser && (isAttacking || userData?.status === "BATTLE") && (
        <div className="absolute bottom-0 left-0 right-0 top-0 z-20 m-auto flex flex-col justify-center bg-black">
          <div className="m-auto text-center text-white">
            <p className="p-5  text-3xl">
              <AvatarImage
                href={targetUser.avatar}
                userId={targetUser.userId}
                alt={targetUser.username}
                size={256}
                priority
              />
            </p>
            <p className="text-5xl">Attacking {targetUser.username}</p>
          </div>
        </div>
      )}
      {healTargetUser && userData && origin.current && (
        <div className="pointer-events-auto absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
          <HealingPopover
            targetUser={healTargetUser}
            side="top"
            open={!!healTargetUser}
            onOpenChange={(open) => {
              if (!open) {
                setHealTargetUser(null);
              }
            }}
            onHealComplete={() => setHealTargetUser(null)}
            trigger={<div className="w-1 h-1 opacity-0" />}
          />
        </div>
      )}
    </>
  );
};

export default Sector;

interface SorroundingUsersProps {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  userId: string;
  hex: TerrainHex;
  users: SectorUser[];
  allyAttack: boolean;
  setAllyAttack: (newValue: boolean) => void;
  storedLvl: number;
  setStoredLvl: (newValue: number) => void;
  attackUser: (userId: string) => void;
  robUser: (userId: string) => void;
  move: (longitude: number, latitude: number) => void;
}

const SorroundingUsers: React.FC<SorroundingUsersProps> = (props) => {
  // Min level to show
  const { data: userData } = useRequiredUserData();
  const { storedLvl, setStoredLvl } = props;

  // Query
  const { data } = api.village.getAll.useQuery(undefined);

  // Form schema
  const levelSliderSchema = z.object({
    value: z.number().min(1).max(2),
  });
  type LevelSliderSchema = z.infer<typeof levelSliderSchema>;

  // Form control
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = useForm<LevelSliderSchema>({
    resolver: zodResolver(levelSliderSchema),
    defaultValues: { value: storedLvl || 1 },
  });
  const watchedLevel = round(watch("value", 2));

  // Filter users
  const users = props.users
    .filter((user) => user.userId !== props.userId)
    .filter((user) => user.status === "AWAKE")
    .filter((user) => user.level >= watchedLevel);

  // Update the localStorage whenever we change
  useEffect(() => {
    setStoredLvl(watchedLevel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedLevel]);

  if (!userData) return null;

  return (
    <Modal2
      isOpen={true}
      title={`Scouting. Your position: [${props.hex.col}, ${props.hex.row}]`}
      setIsOpen={props.setIsOpen}
      isValid={false}
      className="md:max-w-[calc(100%-2rem)]"
    >
      {users.length === 0 && (
        <p className="text-red-500">
          No awake users above level {watchedLevel} in this sector
        </p>
      )}
      <div className="grid grid-cols-3 gap-4 text-center sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10  xl:grid-cols-14 pb-3">
        {users.map((user, i) => {
          // Derived
          const sameHex =
            user.latitude === props.hex.row && user.longitude === props.hex.col;
          const village = data?.find((v) => v.id === user.villageId);
          const villageName = village ? village.name : "Unknown";
          const villageColor = village ? village.hexColor : "gray";
          const relationship =
            userData.village &&
            findVillageUserRelationship(userData.village, user.villageId);
          const isAlly =
            user.villageId === userData.villageId || relationship?.status === "ALLY";
          const showAttack =
            !RANKS_RESTRICTED_FROM_PVP.includes(user.rank) &&
            (props.allyAttack || !isAlly);

          // Show user
          return (
            <div key={i}>
              <div className="relative">
                <div className="absolute right-0 top-0 z-50 hover:opacity-80 hover:cursor-pointer max-w-1/3">
                  {showAttack && sameHex && (
                    <Image
                      src={IMG_SECTOR_ATTACK}
                      onClick={() => props.attackUser(user.userId)}
                      width={40}
                      height={40}
                      alt={`Attack-${user.userId}`}
                    />
                  )}

                  {!sameHex && (
                    <Image
                      src={IMG_ICON_MOVE}
                      onClick={() => props.move(user.longitude, user.latitude)}
                      width={40}
                      height={40}
                      alt={`Move-${user.userId}`}
                    />
                  )}
                </div>
                <div className="absolute left-0 top-0 z-50 hover:opacity-80  hover:cursor-pointer max-w-1/3">
                  <Link href={`/userid/${user.userId}`}>
                    <Image
                      src={IMG_SECTOR_INFO}
                      width={40}
                      height={40}
                      alt={`Info-${user.userId}`}
                    />
                  </Link>
                </div>
                <div className="absolute left-0 bottom-0 z-50 hover:opacity-80  hover:cursor-pointer max-w-1/3">
                  {user.curHealth < user.maxHealth &&
                    hasRequiredRank(userData.rank, MEDNIN_MIN_RANK) && (
                      <HealingPopover targetUser={user} side="top" />
                    )}
                </div>
                <AvatarImage
                  href={user.avatar}
                  userId={user.userId}
                  alt={user.username}
                  size={512}
                  priority
                />
              </div>
              <div className="relative">
                {sameHex && userData.isOutlaw && (
                  <div className="absolute right-0 bottom-0 z-50 w-1/3 hover:opacity-80  hover:cursor-pointer">
                    <Image
                      src={IMG_SECTOR_ROB}
                      onClick={() => {
                        if (
                          user.robImmunityUntil &&
                          user.robImmunityUntil > new Date()
                        ) {
                          showMutationToast({
                            success: false,
                            message: "Target is immune from being robbed",
                          });
                        } else {
                          props.robUser(user.userId);
                        }
                      }}
                      width={40}
                      height={40}
                      alt={`Rob-${user.userId}`}
                      className={`ml-1 ${user.robImmunityUntil && user.robImmunityUntil > new Date() ? "opacity-50" : ""}`}
                    />
                  </div>
                )}
              </div>
              <p>{user.username}</p>
              <p className="text-xs">
                Lvl. {user.level} [{user.longitude}, {user.latitude}]
              </p>
              <p style={{ color: villageColor }} className="font-bold">
                {villageName}
              </p>
            </div>
          );
        })}
      </div>
      <hr />
      <div className="pt-3">
        <SliderField
          id="value"
          default={0}
          min={0}
          max={100}
          unit="value"
          label="Select min level to show"
          register={register}
          setValue={setValue}
          watchedValue={watchedLevel}
          error={errors.value?.message}
        />
        <div className="flex flex-row items-center">
          <Checkbox
            className="m-1 mr-3"
            checked={props.allyAttack}
            onCheckedChange={() => props.setAllyAttack(!props.allyAttack)}
          />
          <Label>Attack button on allies</Label>
        </div>
      </div>
    </Modal2>
  );
};
