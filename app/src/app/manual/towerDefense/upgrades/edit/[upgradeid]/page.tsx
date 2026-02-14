"use client";

import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { TowerDefenseUpgrade } from "@/drizzle/schema";
import {
  type UpdateTowerDefenseUpgrade,
  updateTowerDefenseUpgradeSchema,
  useTowerDefenseUpgradeEditForm,
} from "@/hooks/towerDefenseUpgrade";
import ContentBox from "@/layout/ContentBox";
import { EditContent } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { getUpgradeColor, getUpgradeIcon } from "@/libs/towerDefense/upgrades";
import { canChangeContent } from "@/utils/permissions";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";

export default function TowerDefenseUpgradeEdit(props: {
  params: Promise<{ upgradeid: string }>;
}) {
  const params = use(props.params);
  const upgradeId = params.upgradeid;

  const router = useRouter();
  const { data: userData } = useRequiredUserData();

  // Queries
  const { data, isPending, refetch } = api.towerDefense.getUpgrade.useQuery(
    { id: upgradeId },
    { retry: false, enabled: !!upgradeId },
  );

  // Convert key null values to empty strings
  setNullsToEmptyStrings(data);

  // Redirect if not content editor
  useEffect(() => {
    if (userData && !canChangeContent(userData.role)) {
      void router.push("/profile");
    }
  }, [userData, router]);

  if (isPending || !userData || !canChangeContent(userData.role) || !data) {
    return <Loader explanation="Loading data" />;
  }

  return <SingleEditUpgrade upgrade={data} refetch={refetch} />;
}

interface SingleEditUpgradeProps {
  upgrade: TowerDefenseUpgrade;
  refetch: () => void;
}

const SingleEditUpgrade: React.FC<SingleEditUpgradeProps> = ({ upgrade, refetch }) => {
  const { form, formData, isUpdating, handleUpgradeSubmit } =
    useTowerDefenseUpgradeEditForm(upgrade, refetch);

  return (
    <ContentBox
      title="Content Panel"
      subtitle="Upgrade Configuration"
      defaultBackHref="/manual/towerDefense/upgrades"
    >
      {/* Upgrade Icon Display */}
      <div className="mb-6 flex items-center gap-3 rounded-lg bg-muted/50 p-4">
        <div
          className={`rounded-lg bg-background p-3 ${getUpgradeColor(upgrade.upgradeType)}`}
        >
          {getUpgradeIcon(upgrade.upgradeType, "h-8 w-8")}
        </div>
        <div>
          <p className="text-muted-foreground text-sm">Upgrade Icon</p>
          <p className="text-muted-foreground text-xs">
            Icon is determined by the upgrade type
          </p>
        </div>
      </div>

      <EditContent
        schema={updateTowerDefenseUpgradeSchema}
        form={form as unknown as UseFormReturn<UpdateTowerDefenseUpgrade, unknown>}
        formData={formData}
        showSubmit={true}
        buttonTxt="Save to Database"
        type="towerDefenseUpgrade"
        relationId={upgrade.id}
        allowImageUpload={false}
        onAccept={handleUpgradeSubmit}
      />
      {isUpdating && <Loader explanation="Saving..." />}
    </ContentBox>
  );
};
