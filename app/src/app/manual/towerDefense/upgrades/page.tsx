"use client";

import Link from "next/link";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { TowerDefenseUpgradeCategories } from "@/drizzle/constants";
import type { TowerDefenseUpgrade } from "@/drizzle/schema";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { getUpgradeColor, getUpgradeIcon } from "@/libs/towerDefense/upgrades";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ManualTowerDefenseUpgrades() {
  const { data: userData } = useUserData();

  // Fetch upgrades
  const { data: upgrades, isPending } = api.towerDefense.getUpgrades.useQuery();

  // Group upgrades by category
  const groupedUpgrades = upgrades
    ? Object.entries(TowerDefenseUpgradeCategories).map(([category, types]) => ({
        category,
        upgrades: upgrades.filter((u) =>
          (types as readonly string[]).includes(u.upgradeType),
        ),
      }))
    : [];

  return (
    <>
      <ContentBox
        title="Tower Defense Upgrades"
        subtitle="Permanent Upgrade Configuration"
        defaultBackHref="/manual/towerDefense"
      >
        <p className="mb-4">
          Configure permanent upgrades for the Tower Defense minigame. These upgrades
          can be purchased by players with points earned from completed runs. Each
          upgrade has multiple levels with increasing costs and effects.
        </p>
        <p className="text-muted-foreground text-sm">
          Note: Upgrades can only be created/deleted by coding admins as they are
          tightly coupled with game code.
        </p>
      </ContentBox>

      <ContentBox
        title="Database"
        subtitle="All upgrade definitions"
        initialBreak={true}
      >
        {isPending && <Loader explanation="Loading data" />}
        {!isPending && upgrades && upgrades.length === 0 && (
          <p className="text-muted-foreground">No upgrades configured yet.</p>
        )}
        {!isPending && upgrades && upgrades.length > 0 && (
          <div className="space-y-6">
            {groupedUpgrades.map(
              ({ category, upgrades: categoryUpgrades }) =>
                categoryUpgrades.length > 0 && (
                  <div key={category}>
                    <h3 className="mb-3 font-semibold text-lg capitalize">
                      {category.toLowerCase()} Upgrades
                    </h3>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {categoryUpgrades.map((upgrade) => (
                        <UpgradeCard
                          key={upgrade.id}
                          upgrade={upgrade}
                          canEdit={!!userData && canChangeContent(userData.role)}
                        />
                      ))}
                    </div>
                  </div>
                ),
            )}
          </div>
        )}
      </ContentBox>
    </>
  );
}

interface UpgradeCardProps {
  upgrade: TowerDefenseUpgrade;
  canEdit: boolean;
}

const UpgradeCard: React.FC<UpgradeCardProps> = ({ upgrade, canEdit }) => {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <div
          className={`rounded-lg bg-muted p-3 ${getUpgradeColor(upgrade.upgradeType)}`}
        >
          {getUpgradeIcon(upgrade.upgradeType, "h-8 w-8")}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{upgrade.name}</h3>
          <p className="text-muted-foreground text-xs">{upgrade.upgradeType}</p>
          <p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
            {upgrade.description || "No description"}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-muted-foreground">Max Level:</span> {upgrade.maxLevel}
        </div>
        <div>
          <span className="text-muted-foreground">Base Cost:</span> {upgrade.baseCost}
        </div>
        <div>
          <span className="text-muted-foreground">Cost Multi:</span>{" "}
          {upgrade.costMultiplier}x
        </div>
        <div>
          <span className="text-muted-foreground">Effect:</span> {upgrade.effectValue}
        </div>
      </div>

      {canEdit && (
        <div className="mt-3">
          <Link href={`/manual/towerDefense/upgrades/edit/${upgrade.id}`}>
            <Button variant="outline" size="sm" className="w-full">
              Edit
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
};
