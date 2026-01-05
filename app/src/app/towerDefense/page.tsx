"use client";

import React, { useEffect, useCallback, useRef, useMemo, memo } from "react";
import dynamic from "next/dynamic";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUserData } from "@/utils/UserContext";
import Link from "next/link";
import { useTowerDefense, useHudStoreValues } from "@/hooks/useTowerDefense";
import { useLocalStorage } from "@/hooks/localstorage";
import TowerDefenseUpgrades from "@/layout/TowerDefenseUpgrades";
import { api } from "@/app/_trpc/client";
import { ID_ANIMATION_HIT, ID_SFX_HIT } from "@/drizzle/constants";
import type { TowerDefenseUpgradeCategory } from "@/drizzle/constants";
import type { TowerDefenseHandle } from "@/layout/TowerDefense";
import {
  Sword,
  Play,
  Trophy,
  Heart,
  Coins,
  Target,
  AlertCircle,
  SkipForward,
  Home,
  Zap,
  Crosshair,
  BarChart3,
  Sparkles,
  RefreshCw,
  X,
  LogIn,
  Info,
} from "lucide-react";

// Dynamically import the ThreeJS component
const TowerDefenseCanvas = dynamic(() => import("@/layout/TowerDefense"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[500px] items-center justify-center">
      <Loader explanation="Loading game..." />
    </div>
  ),
});

const GAME_NAME = "Tower Defense";
const PAGE_TITLE = `${GAME_NAME} (Unstable Preview)`;
const PAGE_SUBTITLE = "For experimentation with TNR tech, visuals & performance.";

const TowerDefensePage: React.FC = () => {
  const { data: userData } = useUserData();
  const [upgradeTab, setUpgradeTab] = useLocalStorage<TowerDefenseUpgradeCategory>(
    "towerDefenseUpgradeTab",
    "ATTACK",
  );

  const {
    gameState,
    upgradesData,
    upgradeDefinitions,
    startRun,
    resumeRun,
    throwShuriken,
    update,
    submitWave,
    abandonRun,
    returnToLobby,
    clearError,
    purchaseInRunUpgrade,
    cancelExistingSession,
    checkForExistingSession,
    isStarting,
    isSubmitting,
    isGuest,
    // NOTE: hudStore is now imported at module level from "@/hooks/useTowerDefense"
    // PERFORMANCE: Direct refs to avoid React re-renders
    entitiesRef,
    runtimeStateRef,
    playerHitEventsRef,
  } = useTowerDefense(userData?.userId);

  // Ref for imperative updates to ThreeJS scene
  const canvasRef = useRef<TowerDefenseHandle>(null);

  // PERFORMANCE: Fetch game assets at page level (stable across re-renders)
  const { data: gameAssets } = api.misc.getAllGameAssetNames.useQuery({
    ids: [ID_ANIMATION_HIT, ID_SFX_HIT],
  });

  // PERFORMANCE: Cache asset lookups to avoid repeated .find() calls
  const cachedAssets = useMemo(() => {
    if (!gameAssets) return { impactAsset: undefined, sfxUrl: undefined };
    const impactAsset = gameAssets.find((a) => a.id === ID_ANIMATION_HIT);
    const sfxAsset = gameAssets.find((a) => a.id === ID_SFX_HIT);
    return {
      impactAsset,
      sfxUrl: sfxAsset?.url,
    };
  }, [gameAssets]);

  // Game loop ref
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  // Game loop
  const gameLoop = useCallback(
    (timestamp: number) => {
      if (gameState.mode === "playing") {
        const deltaTime = (timestamp - lastTimeRef.current) / 1000;
        lastTimeRef.current = timestamp;

        if (deltaTime < 0.1) {
          update(deltaTime);
        }

        animationFrameRef.current = requestAnimationFrame(gameLoop);
      }
    },
    [gameState.mode, update],
  );

  // Start/stop game loop
  useEffect(() => {
    if (gameState.mode === "playing") {
      lastTimeRef.current = performance.now();
      animationFrameRef.current = requestAnimationFrame(gameLoop);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [gameState.mode, gameLoop]);

  // Check for existing sessions on mount or when user data becomes available
  useEffect(() => {
    if (userData?.userId && gameState.mode === "lobby" && !gameState.existingSession) {
      void checkForExistingSession();
    }
  }, [
    userData?.userId,
    gameState.mode,
    gameState.existingSession,
    checkForExistingSession,
  ]);

  // PERFORMANCE: Stable callback for tile clicks (never changes reference)
  const handleTileClick = useCallback(
    (position: { col: number; row: number }) => {
      throwShuriken(position);
    },
    [throwShuriken],
  );

  // Lobby mode
  if (gameState.mode === "lobby") {
    return (
      <ContentBox title={PAGE_TITLE} subtitle={PAGE_SUBTITLE}>
        {/* Guest Mode Notice */}
        {isGuest && (
          <div className="mb-6 rounded-lg border border-blue-500/50 bg-blue-500/10 p-4">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
              <div className="flex-1 space-y-2">
                <p className="font-semibold text-blue-600 dark:text-blue-400">
                  Playing as Guest
                </p>
                <p className="text-sm text-muted-foreground">
                  You can play the game without logging in, but you won&apos;t be able
                  to earn or save permanent upgrade points. Log in to save your progress
                  and purchase permanent upgrades!
                </p>
                <Link href="/login">
                  <Button variant="outline" size="sm" className="mt-1">
                    <LogIn className="mr-2 h-4 w-4" />
                    Log In
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {/* Start/Resume Game Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sword className="h-5 w-5" />
                Battle Arena
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Existing Session Panel - only for logged in users */}
              {!isGuest && gameState.existingSession && (
                <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                    <AlertCircle className="h-4 w-4" />
                    <span className="font-semibold">Active Run Found</span>
                  </div>
                  <div className="text-sm space-y-1">
                    <p>
                      Wave: <strong>{gameState.existingSession.wave}</strong>
                    </p>
                    <p>
                      Score: <strong>{gameState.existingSession.score}</strong>
                    </p>
                    <p>
                      Health:{" "}
                      <strong>
                        {gameState.existingSession.health}/
                        {gameState.existingSession.maxHealth}
                      </strong>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={resumeRun}
                      disabled={isStarting}
                      className="flex-1"
                      variant="default"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      {isStarting ? "Connecting..." : "Resume Run"}
                    </Button>
                    <Button
                      onClick={cancelExistingSession}
                      disabled={isStarting}
                      variant="outline"
                      className="border-destructive/50 text-destructive hover:bg-destructive/10"
                    >
                      <X className="mr-2 h-4 w-4" />
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Start New Run Button - only show if no existing session */}
              {(isGuest || !gameState.existingSession) && (
                <>
                  <Button
                    onClick={startRun}
                    disabled={isStarting}
                    className="w-full"
                    size="lg"
                  >
                    <Play className="mr-2 h-4 w-4" />
                    {isStarting ? "Connecting..." : "Start New Run"}
                  </Button>

                  <div className="text-sm text-muted-foreground">
                    <p>Survive as many waves as possible!</p>
                    <p>Enemies get stronger each wave.</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Stats Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5" />
                Your Stats
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {isGuest ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        Tower Defense Points
                      </span>
                      <Badge variant="secondary" className="text-lg">
                        <Coins className="mr-1 h-4 w-4" />0
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <Link href="/login" className="text-blue-500 hover:underline">
                        Log in
                      </Link>{" "}
                      to earn points and purchase permanent upgrades!
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        Tower Defense Points
                      </span>
                      <Badge variant="secondary" className="text-lg">
                        <Coins className="mr-1 h-4 w-4" />
                        {upgradesData?.points ?? 0}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Earn points by surviving waves. Use them to purchase permanent
                      upgrades!
                    </p>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Upgrades Section */}
        <div className="mt-6">
          <TowerDefenseUpgrades
            mode="permanent"
            upgradeDefinitions={upgradeDefinitions ?? []}
            userUpgrades={upgradesData?.upgrades ?? []}
            currency={upgradesData?.points ?? 0}
            activeTab={upgradeTab}
            onTabChange={setUpgradeTab}
            isGuest={isGuest}
          />
        </div>

        {/* Error Display */}
        {gameState.error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{gameState.error}</span>
            <Button variant="ghost" size="sm" onClick={clearError}>
              Dismiss
            </Button>
          </div>
        )}
      </ContentBox>
    );
  }

  // Playing / Wave-end mode
  return (
    <ContentBox
      title={`${GAME_NAME} - Wave ${gameState.currentWave}`}
      subtitle={
        gameState.mode === "wave-end" ? "Wave Complete!" : `Score: ${gameState.score}`
      }
    >
      {/* Game HUD - Subscribes directly to module-level hudStore, parent never re-renders */}
      <GameHUD />

      {/* Game Canvas */}
      <div className="relative w-full overflow-hidden rounded-lg border bg-slate-900">
        {/* PERFORMANCE: TowerDefenseCanvas is internally memoized with () => true */}
        {gameState.seed && gameState.state && (
          <TowerDefenseCanvas
            ref={canvasRef}
            seed={gameState.seed}
            initialGridSize={gameState.state.gridSize}
            initialPlayerPosition={gameState.state.playerPosition}
            onTileClick={handleTileClick}
            entitiesRef={entitiesRef}
            runtimeStateRef={runtimeStateRef}
            playerHitEventsRef={playerHitEventsRef}
            impactAsset={cachedAssets.impactAsset}
            sfxUrl={cachedAssets.sfxUrl}
          />
        )}

        {/* Wave Complete Overlay - covers the game field */}
        {gameState.mode === "wave-end" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="max-w-md rounded-xl border-2 border-green-500/50 bg-background/95 p-8 text-center shadow-2xl">
              <h2 className="text-4xl font-bold text-green-500">
                Wave {gameState.currentWave} Complete!
              </h2>
              <p className="mt-3 text-muted-foreground">
                {gameState.enemyCount === 0
                  ? "All enemies defeated!"
                  : "Preparing next wave..."}
              </p>
              <div className="mt-6 flex justify-center gap-4">
                <Button
                  onClick={submitWave}
                  disabled={isSubmitting || gameState.waveInProgress}
                  size="lg"
                >
                  <SkipForward className="mr-2 h-4 w-4" />
                  {isSubmitting ? "Submitting..." : "Next Wave"}
                </Button>
                <Button variant="outline" onClick={abandonRun} disabled={isSubmitting}>
                  <Home className="mr-2 h-4 w-4" />
                  Abandon Run
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Game Over Overlay - covers the game field */}
        {gameState.mode === "game-over" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="max-w-md rounded-xl border-2 border-destructive/50 bg-background/95 p-8 text-center shadow-2xl">
              <h2 className="text-4xl font-bold text-destructive">Game Over!</h2>
              <div className="mt-6 space-y-3">
                <p className="text-2xl">
                  Final Score:{" "}
                  <strong className="text-3xl text-primary">{gameState.score}</strong>
                </p>
                <p className="text-muted-foreground">
                  You survived{" "}
                  <strong className="text-foreground">{gameState.currentWave}</strong>{" "}
                  wave{gameState.currentWave !== 1 ? "s" : ""}
                </p>

                {/* Points Earned Section - Different for guest vs logged in */}
                {isGuest ? (
                  <div className="mt-4 rounded-lg p-4 bg-blue-500/10 border border-blue-500/30">
                    <p className="text-lg font-semibold text-blue-500">
                      <Info className="mr-2 inline h-5 w-5" />
                      Would have earned {Math.floor(gameState.score / 100)} points
                    </p>
                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                      <p>
                        <Link href="/login" className="text-blue-500 hover:underline">
                          Log in
                        </Link>{" "}
                        to save your points and purchase permanent upgrades!
                      </p>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`mt-4 rounded-lg p-4 ${
                      (gameState.finalPointsEarned ?? 0) > 0
                        ? "bg-primary/10 border border-primary/30"
                        : "bg-muted/50 border border-muted"
                    }`}
                  >
                    <p
                      className={`text-lg font-semibold ${
                        (gameState.finalPointsEarned ?? 0) > 0
                          ? "text-primary"
                          : "text-muted-foreground"
                      }`}
                    >
                      <Coins className="mr-2 inline h-5 w-5" />
                      {(gameState.finalPointsEarned ?? 0) > 0
                        ? `+${gameState.finalPointsEarned} Tower Defense Points Earned!`
                        : "0 Tower Defense Points Earned"}
                    </p>

                    {/* Calculation explanation */}
                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                      <p className="font-medium">How points are calculated:</p>
                      <p>
                        {gameState.score} score ÷ 100 ={" "}
                        {Math.floor(gameState.score / 100)} points
                      </p>
                      {(gameState.finalPointsEarned ?? 0) === 0 && (
                        <p className="text-amber-500/80">
                          Reach 100+ score to earn points!
                        </p>
                      )}
                      {(gameState.finalPointsEarned ?? 0) > 0 && (
                        <p>Use these to purchase permanent upgrades</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <Button onClick={returnToLobby} className="mt-6" size="lg">
                <Home className="mr-2 h-4 w-4" />
                Return to Lobby
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* In-Run Upgrades Bar - show during active gameplay and between waves */}
      {(gameState.mode === "playing" || gameState.mode === "wave-end") &&
        upgradeDefinitions && (
          <div className="mt-4">
            <InRunUpgradesWrapper
              upgradeDefinitions={upgradeDefinitions}
              userUpgrades={upgradesData?.upgrades ?? []}
              activeTab={upgradeTab}
              onTabChange={setUpgradeTab}
              onInRunPurchase={purchaseInRunUpgrade}
              isPurchasing={isSubmitting}
            />
          </div>
        )}

      {/* Error Display */}
      {gameState.error && (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-destructive/10 p-3 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{gameState.error}</span>
          <Button variant="ghost" size="sm" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}
    </ContentBox>
  );
};

export default TowerDefensePage;

// ============================================================================
// PERFORMANCE: HUD components that subscribe directly to hudStore (module-level singleton)
// Parent page NEVER re-renders for HUD updates - only these components do
// ============================================================================

/**
 * PERFORMANCE-CRITICAL: GameHUD subscribes directly to module-level hudStore.
 * Only this component re-renders on HUD changes - parent page stays static.
 * Wrapped in memo() to ensure parent re-renders don't affect this component.
 */
const GameHUD = memo(function GameHUD() {
  // Use custom hook that subscribes via useSyncExternalStore
  const values = useHudStoreValues();
  const ability = values.abilities[0];

  return (
    <div className="mb-4 flex items-center justify-between">
      <TooltipProvider delayDuration={100}>
        <div className="flex items-center gap-2">
          {/* Health Badge */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="h-8 text-lg">
                <Heart className="mr-1 h-4 w-4 text-red-500" />
                {values.playerHealth} / {values.maxHealth}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="bg-slate-700 text-white">
              <p>Health - Game ends when this reaches 0</p>
            </TooltipContent>
          </Tooltip>

          {/* Enemy Count Badge */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="h-8 text-lg">
                <Target className="mr-1 h-4 w-4" />
                {values.enemyCount}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="bg-slate-700 text-white">
              <p>Enemies remaining in the current wave</p>
            </TooltipContent>
          </Tooltip>

          {/* Stats Popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Badge
                variant="outline"
                className="h-8 cursor-pointer text-lg hover:bg-accent"
              >
                <BarChart3 className="h-4 w-4" />
              </Badge>
            </PopoverTrigger>
            <PopoverContent className="w-72" side="bottom" align="start">
              <div className="space-y-2">
                <h4 className="border-b pb-2 font-semibold">Current Stats</h4>
                {ability && (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Sword className="h-3 w-3 text-orange-500" />
                        <span>Damage</span>
                      </div>
                      <span className="font-medium">{ability.damage}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Crosshair className="h-3 w-3 text-blue-500" />
                        <span>Range</span>
                      </div>
                      <span className="font-medium">{ability.range} tiles</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Zap className="h-3 w-3 text-yellow-500" />
                        <span>Attack Speed</span>
                      </div>
                      <span className="font-medium">
                        {(1000 / ability.cooldownMs).toFixed(1)}/s
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-3 w-3 text-purple-500" />
                        <span>Crit Chance</span>
                      </div>
                      <span className="font-medium">
                        {((ability.critChance ?? 0) * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Target className="h-3 w-3 text-green-500" />
                        <span>Damage/Tile</span>
                      </div>
                      <span className="font-medium">
                        +{(ability.damagePerTile ?? 0).toFixed(1)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex items-center gap-2">
          {/* Score Badge */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="h-8 text-lg">
                <Trophy className="mr-1 h-4 w-4" />
                {values.score} pts
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="bg-slate-700 text-white">
              <p>Score - Earn permanent upgrade points based on your score</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
});

/**
 * PERFORMANCE: In-run upgrades wrapper that subscribes to module-level hudStore.
 * Only re-renders when activeUpgrades or inRunCurrency change.
 * Wrapped in memo() to ensure parent re-renders don't affect this component.
 */
interface InRunUpgradesWrapperProps {
  upgradeDefinitions: Parameters<typeof TowerDefenseUpgrades>[0]["upgradeDefinitions"];
  userUpgrades: Parameters<typeof TowerDefenseUpgrades>[0]["userUpgrades"];
  activeTab: TowerDefenseUpgradeCategory | undefined;
  onTabChange: (tab: TowerDefenseUpgradeCategory) => void;
  onInRunPurchase: (upgradeId: string) => void;
  isPurchasing: boolean;
}

const InRunUpgradesWrapper = memo(function InRunUpgradesWrapper({
  upgradeDefinitions,
  userUpgrades,
  activeTab,
  onTabChange,
  onInRunPurchase,
  isPurchasing,
}: InRunUpgradesWrapperProps) {
  // Use custom hook that subscribes via useSyncExternalStore
  const values = useHudStoreValues();

  return (
    <TowerDefenseUpgrades
      mode="inRun"
      upgradeDefinitions={upgradeDefinitions}
      userUpgrades={userUpgrades}
      currency={values.inRunCurrency}
      activeTab={activeTab}
      onTabChange={onTabChange}
      inRunUpgrades={values.activeUpgrades}
      onInRunPurchase={onInRunPurchase}
      isPurchasing={isPurchasing}
    />
  );
});
