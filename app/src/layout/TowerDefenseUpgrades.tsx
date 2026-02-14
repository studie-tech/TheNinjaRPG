import { Coins, Lock, LogIn, Sparkles } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TowerDefenseUpgradeCategories,
  type TowerDefenseUpgradeCategory,
} from "@/drizzle/constants";
import type { TowerDefenseUpgrade, UserTowerDefenseUpgrade } from "@/drizzle/schema";
import { showMutationToast } from "@/libs/toast";
import { calculateUpgradeCost } from "@/libs/towerDefense/game";
import {
  getCategoryIcon,
  getCategoryLabel,
  getEffectDisplay,
  getEffectPerLevelDisplay,
  getUpgradeColor,
  getUpgradeIcon,
  getUpgradesByCategory,
} from "@/libs/towerDefense/upgrades";

interface TowerDefenseUpgradesProps {
  mode: "permanent" | "inRun";
  upgradeDefinitions: TowerDefenseUpgrade[];
  userUpgrades: (UserTowerDefenseUpgrade & { upgrade: TowerDefenseUpgrade })[];
  currency: number;
  activeTab?: TowerDefenseUpgradeCategory;
  onTabChange?: (tab: TowerDefenseUpgradeCategory) => void;
  // In-run specific props
  inRunUpgrades?: Record<string, number>;
  onInRunPurchase?: (upgradeId: string) => void;
  isPurchasing?: boolean;
  // Guest mode
  isGuest?: boolean;
}

const TowerDefenseUpgrades: React.FC<TowerDefenseUpgradesProps> = ({
  mode,
  upgradeDefinitions,
  userUpgrades,
  currency,
  activeTab,
  onTabChange,
  inRunUpgrades = {},
  onInRunPurchase,
  isPurchasing = false,
  isGuest = false,
}) => {
  const utils = api.useUtils();

  const purchaseMutation = api.towerDefense.purchasePermanentUpgrade.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        void utils.towerDefense.getUserUpgrades.invalidate();
      }
    },
  });

  const getPermanentLevel = (upgradeId: string): number => {
    const userUpgrade = userUpgrades.find((u) => u.upgradeId === upgradeId);
    return userUpgrade?.level ?? 0;
  };

  const getInRunLevel = (upgradeId: string): number => {
    return inRunUpgrades[upgradeId] ?? 0;
  };

  const handlePurchase = (upgradeId: string) => {
    if (mode === "permanent") {
      purchaseMutation.mutate({ upgradeId });
    } else {
      onInRunPurchase?.(upgradeId);
    }
  };

  // Filter out ABILITIES category for in-run mode
  const categories = (
    Object.keys(TowerDefenseUpgradeCategories) as TowerDefenseUpgradeCategory[]
  ).filter((cat) => (mode === "inRun" ? cat !== "ABILITIES" : true));

  if (upgradeDefinitions.length === 0) {
    if (mode === "permanent") {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Permanent Upgrades</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              No upgrades available yet. Check back later!
            </p>
          </CardContent>
        </Card>
      );
    }
    return null;
  }

  const currencyLabel = mode === "permanent" ? "points" : "tokens";

  const renderUpgradeItem = (upgrade: TowerDefenseUpgrade) => {
    const permanentLevel = getPermanentLevel(upgrade.id);
    const inRunLevel = getInRunLevel(upgrade.id);
    const currentLevel =
      mode === "permanent" ? permanentLevel : permanentLevel + inRunLevel;
    const isMaxLevel = currentLevel >= upgrade.maxLevel;

    // For permanent mode, cost is based on permanent level
    // For in-run mode, cost is based on in-run level only
    const costBasis = mode === "permanent" ? permanentLevel : inRunLevel;
    const cost = isMaxLevel
      ? 0
      : calculateUpgradeCost(upgrade.baseCost, upgrade.costMultiplier, costBasis);
    const canAfford = currency >= cost;
    const canPurchase = !isMaxLevel && canAfford;
    const isLoading = mode === "permanent" ? purchaseMutation.isPending : isPurchasing;

    return (
      <TooltipProvider key={upgrade.id} delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => canPurchase && !isLoading && handlePurchase(upgrade.id)}
              disabled={!canPurchase || isLoading}
              className={`flex w-full items-center gap-2 rounded-lg border-2 p-2.5 transition-all ${
                isMaxLevel
                  ? "border-yellow-500/50 bg-yellow-500/10"
                  : canPurchase
                    ? "cursor-pointer border-primary/50 bg-primary/5 hover:border-primary hover:bg-primary/15"
                    : "cursor-not-allowed border-border bg-muted/30 opacity-60"
              }
              `}
            >
              {/* Icon */}
              <div
                className={`rounded-md p-1.5 ${getUpgradeColor(upgrade.upgradeType)} ${isMaxLevel ? "bg-yellow-500/20" : canPurchase ? "bg-primary/20" : "bg-muted"}`}
              >
                {getUpgradeIcon(upgrade.upgradeType, "h-4 w-4")}
              </div>

              {/* Name and Level */}
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate font-medium text-sm leading-tight">
                  {upgrade.name}
                </div>
                <div className="text-muted-foreground text-xs">
                  {mode === "inRun" && permanentLevel > 0 ? (
                    <>
                      <span className="text-green-500">{permanentLevel}</span>
                      {inRunLevel > 0 && (
                        <>
                          <span className="text-muted-foreground">+</span>
                          <span className="text-amber-500">{inRunLevel}</span>
                        </>
                      )}
                    </>
                  ) : (
                    <span>{currentLevel}</span>
                  )}
                  <span>/{upgrade.maxLevel}</span>
                </div>
              </div>

              {/* Cost or Max indicator */}
              <div className="flex shrink-0 items-center gap-0.5 text-xs">
                {isMaxLevel ? (
                  <Sparkles className="h-3.5 w-3.5 text-white" />
                ) : (
                  <>
                    <Coins
                      className={`h-3 w-3 ${canAfford ? "text-green-500" : "text-red-500"}`}
                    />
                    <span className={canAfford ? "text-green-500" : "text-red-500"}>
                      {cost}
                    </span>
                  </>
                )}
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs bg-slate-700 text-white">
            <div className="space-y-1.5">
              <p className="font-semibold">{upgrade.name}</p>
              <p className="text-muted-foreground text-xs">{upgrade.description}</p>
              <div className="space-y-0.5 border-t pt-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Per level:</span>
                  <span>{getEffectPerLevelDisplay(upgrade)}</span>
                </div>
                {currentLevel > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Current:</span>
                    <span className={getUpgradeColor(upgrade.upgradeType)}>
                      {getEffectDisplay(upgrade, currentLevel)}
                    </span>
                  </div>
                )}
                {mode === "inRun" && permanentLevel > 0 && inRunLevel > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-green-500">Permanent:</span>
                      <span className="text-green-500">
                        {getEffectDisplay(upgrade, permanentLevel)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-amber-500">This run:</span>
                      <span className="text-amber-500">
                        {getEffectDisplay(upgrade, inRunLevel)}
                      </span>
                    </div>
                  </>
                )}
                {!isMaxLevel && (
                  <div className="flex justify-between pt-1">
                    <span className="text-muted-foreground">Cost:</span>
                    <span
                      className={canAfford ? "text-foreground" : "text-destructive"}
                    >
                      {cost} {currencyLabel}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const renderCategoryContent = (category: TowerDefenseUpgradeCategory) => {
    const categoryUpgrades = getUpgradesByCategory(upgradeDefinitions, category);

    if (categoryUpgrades.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-4 text-center">
          <div className="mb-2 rounded-full bg-muted p-3">
            {getCategoryIcon(category)}
          </div>
          <p className="text-muted-foreground text-sm">
            {category === "ABILITIES"
              ? "No abilities unlocked yet. Coming soon!"
              : "No upgrades available in this category yet."}
          </p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {categoryUpgrades.map(renderUpgradeItem)}
      </div>
    );
  };

  if (mode === "permanent") {
    // Guest mode - show login prompt instead of upgrades
    if (isGuest) {
      return (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <span>Permanent Upgrades</span>
              <Badge variant="secondary" className="text-base">
                <Lock className="mr-1 h-4 w-4" />
                Locked
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="mb-4 rounded-full bg-blue-500/10 p-4">
                <LogIn className="h-8 w-8 text-blue-500" />
              </div>
              <h3 className="mb-2 font-semibold text-lg">Login Required</h3>
              <p className="mb-4 max-w-md text-muted-foreground text-sm">
                Permanent upgrades are only available for logged-in users. Create an
                account or log in to earn Tower Defense Points and purchase upgrades
                that persist across all your runs!
              </p>
              <Link href="/login">
                <Button>
                  <LogIn className="mr-2 h-4 w-4" />
                  Log In to Unlock
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span>Permanent Upgrades</span>
            <Badge variant="secondary" className="text-base">
              <Coins className="mr-1 h-4 w-4" />
              {currency} {currencyLabel}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs
            value={activeTab}
            defaultValue="ATTACK"
            onValueChange={(v) => onTabChange?.(v as TowerDefenseUpgradeCategory)}
            className="w-full"
          >
            <TabsList className="mb-3">
              {categories.map((category, i) => (
                <TabsTrigger
                  key={`${category}-${i}`}
                  value={category}
                  className="gap-2"
                >
                  {getCategoryIcon(category)}
                  <span className="hidden sm:inline">{getCategoryLabel(category)}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {categories.map((category, i) => (
              <TabsContent key={`${category}-${i}`} value={category}>
                {renderCategoryContent(category)}
              </TabsContent>
            ))}
          </Tabs>

          <p className="mt-3 text-center text-muted-foreground text-xs">
            Hover over upgrades for details. Click to purchase.
          </p>
        </CardContent>
      </Card>
    );
  }

  // In-run mode - more compact layout
  return (
    <Card className="bg-background/80 backdrop-blur-sm">
      <CardContent className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-medium text-sm">In-Run Upgrades</span>
          <Badge variant="secondary">
            <Coins className="mr-1 h-3 w-3" />
            {currency} {currencyLabel}
          </Badge>
        </div>

        <Tabs
          value={activeTab}
          defaultValue="ATTACK"
          onValueChange={(v) => onTabChange?.(v as TowerDefenseUpgradeCategory)}
          className="w-full"
        >
          <TabsList className="mb-2 w-full">
            {categories.map((category, i) => (
              <TabsTrigger
                key={`${category}-${i}`}
                value={category}
                className="flex-1 gap-1.5"
              >
                {getCategoryIcon(category, "h-3.5 w-3.5")}
                <span className="hidden text-xs sm:inline">
                  {getCategoryLabel(category)}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          {categories.map((category, i) => (
            <TabsContent key={`${category}-${i}`} value={category} className="mt-0">
              {renderCategoryContent(category)}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default TowerDefenseUpgrades;
