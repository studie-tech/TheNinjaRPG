"use client";

import React, { useMemo } from "react";
import { BaseCanvas } from "../core/Canvas";
import { OrthoCamera } from "../core/OrthographicCamera";
import { CombatControls } from "../controls/CombatControls";
import { BackgroundSprite } from "../sprites/BackgroundSprite";
import { CombatHexTile } from "../hex/CombatHexTile";
import { HexEdges } from "../hex/HexEdges";
import { HexLabels } from "../hex/HexLabels";
import { CombatUserSprite } from "../sprites/CombatUserSprite";
import { CombatEffectSprite } from "../sprites/CombatEffectSprite";
import { findHex } from "@/libs/hexgrid";
import { stillInBattle } from "@/libs/combat/actions";
import { getBattleGrid } from "@/libs/combat/util";
import { COMBAT_WIDTH } from "@/libs/combat/constants";
import type { ReturnedBattle, CombatAction } from "@/libs/combat/types";
import type { GameAsset } from "@/drizzle/schema";
import type { TerrainHex } from "@/libs/hexgrid";

interface CombatSceneProps {
  battle: ReturnedBattle;
  userId: string;
  action?: CombatAction;
  timeDiff: number;
  precomputedActions: CombatAction[];
  showGridNumbers: boolean;
  onTileClick: (hex: TerrainHex) => void;
  gameAssets: GameAsset[];
  width: number;
  height: number;
}

/**
 * Combat Scene - Complete R3F scene for combat
 * Replaces the imperative Three.js implementation in Combat.tsx
 */
const CombatScene: React.FC<CombatSceneProps> = ({
  battle,
  userId,
  action,
  timeDiff,
  precomputedActions,
  showGridNumbers,
  onTileClick,
  gameAssets,
  width,
  height,
}) => {
  // Generate battle grid dynamically
  const battleGrid = useMemo(() => {
    const backgroundLengthToWidth = 576 / 1024;
    const hexsize = (width / COMBAT_WIDTH / 2.6) * 1.31;
    const leftPadding = 0.11 * width;
    const bottomPadding = 0.1 * (width * backgroundLengthToWidth);
    return getBattleGrid(hexsize, {
      x: -hexsize - leftPadding,
      y: -hexsize - bottomPadding,
    });
  }, [width]);

  // Convert battle grid to array for rendering
  const hexArray = useMemo(() => Array.from(battleGrid), [battleGrid]);

  return (
    <BaseCanvas
      type="combat"
      width={width}
      height={height}
      backgroundColor={0x000000}
      backgroundAlpha={1}
    >
      <OrthoCamera width={width} height={height} initialZoom={1.5} minZoom={1} maxZoom={3} />
      <CombatControls enableRotate={false} zoomSpeed={0.3} />

      {/* Background */}
      <BackgroundSprite texturePath={battle.background} width={width} height={height} />

      {/* Hex tiles */}
      <group name="hex-tiles">
        {hexArray.map((hex) => (
          <CombatHexTile
            key={`${hex.col}-${hex.row}`}
            hex={hex}
            battle={battle}
            battleGrid={battleGrid}
            userId={userId}
            action={action}
            timeDiff={timeDiff}
            precomputedActions={precomputedActions}
            onClick={onTileClick}
          />
        ))}
      </group>

      {/* Hex edges */}
      <HexEdges grid={battleGrid} color={0x000000} lineWidth={1} />

      {/* Ground effects */}
      <group name="ground-effects">
        {battle.groundEffects.map((effect) => {
          const hex = findHex(battleGrid, {
            x: effect.longitude,
            y: effect.latitude,
          });
          if (!hex) return null;

          return (
            <CombatEffectSprite
              key={effect.id}
              effect={effect}
              hex={hex}
              gameAssets={gameAssets}
            />
          );
        })}
      </group>

      {/* User sprites */}
      <group name="users">
        {battle.usersState
          .filter((user) => stillInBattle(user))
          .map((user) => {
            const hex = findHex(battleGrid, {
              x: user.longitude,
              y: user.latitude,
            });
            if (!hex) return null;

            return (
              <CombatUserSprite key={user.userId} user={user} hex={hex} playerId={userId} />
            );
          })}
      </group>

      {/* User effects (attached to users) */}
      <group name="user-effects">
        {battle.usersEffects.map((effect) => {
          const user = battle.usersState.find((u) => u.userId === effect.targetId);
          if (!user || !stillInBattle(user)) return null;

          const hex = findHex(battleGrid, {
            x: user.longitude,
            y: user.latitude,
          });
          if (!hex) return null;

          return (
            <CombatEffectSprite
              key={effect.id}
              effect={effect}
              hex={hex}
              gameAssets={gameAssets}
            />
          );
        })}
      </group>

      {/* Grid labels (optional) */}
      {showGridNumbers && <HexLabels grid={battleGrid} color="#ffffff" fontSize={8} />}
    </BaseCanvas>
  );
};

export { CombatScene };
export default CombatScene;

