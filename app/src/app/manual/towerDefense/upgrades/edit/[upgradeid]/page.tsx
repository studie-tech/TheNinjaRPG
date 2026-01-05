"use client";

import { useEffect, use } from "react";
import { useRouter } from "next/navigation";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { EditContent } from "@/layout/EditContent";
import { api } from "@/app/_trpc/client";
import { useRequiredUserData } from "@/utils/UserContext";
import { canChangeContent } from "@/utils/permissions";
import { useTowerDefenseUpgradeEditForm } from "@/hooks/towerDefenseUpgrade";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { getUpgradeIcon, getUpgradeColor } from "@/libs/towerDefense/upgrades";
import type { TowerDefenseUpgrade } from "@/drizzle/schema";

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
      <div className="flex items-center gap-3 mb-6 p-4 bg-muted/50 rounded-lg">
        <div
          className={`rounded-lg p-3 bg-background ${getUpgradeColor(upgrade.upgradeType)}`}
        >
          {getUpgradeIcon(upgrade.upgradeType, "h-8 w-8")}
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Upgrade Icon</p>
          <p className="text-xs text-muted-foreground">
            Icon is determined by the upgrade type
          </p>
        </div>
      </div>

      <EditContent
        schema={form}
        form={form}
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

