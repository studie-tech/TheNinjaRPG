"use client";

import { useSetAtom } from "jotai";
import { Flag } from "lucide-react";
import dynamic from "next/dynamic";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { type CombatLayoutComponentId, useCombatPreferences } from "@/hooks/combat";
import { useLpcCatalogLoader } from "@/hooks/lpc";
import ActionTimer from "@/layout/ActionTimer";
import CombatHistory from "@/layout/CombatHistory";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import ReportUser from "@/layout/Report";
import { UserCombatSettings } from "@/layout/UserCombatSettings";
import type { BattleState } from "@/libs/combat/types";
import { useRequiredUserData, userBattleAtom } from "@/utils/UserContext";

const loadCombat = () => import("@/layout/Combat");
const Combat = dynamic(loadCombat, {
  ssr: false,
  loading: () => <Loader explanation="Loading Battlefield" />,
});

/** Renders the embedded battle viewer while preserving live-combat layout preferences. */
export default function BattleLog(props: { params: Promise<{ battleid: string }> }) {
  const params = use(props.params);
  // State
  const config = useCombatPreferences();
  const [battleState, setBattleState] = useState<BattleState | undefined>(undefined);
  const battleId = params.battleid;
  const utils = api.useUtils();
  const setBattleAtom = useSetAtom(userBattleAtom);
  // The battlefield reuses a held catalog, refreshing it for later scenes; a cold cache
  // loads it alongside the battle rather than after it.
  const loadLpcCatalog = useLpcCatalogLoader({
    revalidateInBackground: true,
    preload: true,
  });

  // Shared combat handlers can publish snapshots while this viewer is mounted.
  useEffect(
    () => () => {
      setBattleAtom(undefined);
    },
    [setBattleAtom],
  );

  useEffect(() => {
    void loadCombat().catch(() => undefined);
  }, []);

  const { data: userData } = useRequiredUserData();
  const userId = userData?.userId;
  const { data } = api.combat.getBattle.useQuery(
    { battleId: battleId },
    { enabled: !!battleId },
  );
  const {
    data: battleHistory,
    isPending: isLoadingHistory,
    isError: isHistoryError,
  } = api.combat.getBattleHistoryEntry.useQuery(
    { battleId: battleId },
    { enabled: !!battleId },
  );
  const otherUser =
    battleHistory?.attacker?.userId === userData?.userId
      ? battleHistory?.defender
      : battleHistory?.attacker;

  // Derived variables
  const battle = battleState?.battle;
  const versionId = battle?.version;

  useEffect(() => {
    if (data?.battle && userData) {
      void utils.misc.getAllGameAssetNames.prefetch({
        ids: [
          ...(data.battle.extraState.textureAssets ?? []),
          ...(data.battle.extraState.sfxAssets ?? []),
        ],
      });
      setBattleState({
        battle: data?.battle,
        result: undefined,
        isPending: false,
      });
    }
  }, [userData, data]);

  // Battle scene
  const combat = useMemo(() => {
    return (
      battleState &&
      userId && (
        <Combat
          battleState={battleState}
          action={undefined}
          userId={userId}
          setBattleState={setBattleState}
          config={config}
          loadLpcCatalog={loadLpcCatalog}
        />
      )
    );
  }, [
    battleState,
    userId,
    config.showGridNumbers,
    config.showAggro,
    config.resourceBarsVisibility,
    loadLpcCatalog,
  ]);

  // Render functions for layout components
  const renderTimer = useCallback(() => {
    if (!battle || !battleState) return null;
    return (
      <div className="flex flex-row items-center gap-2">
        <ActionTimer
          user={{
            userId: userId,
            actionPoints:
              battle.usersState.find((u) => u.userId === userId)?.actionPoints ?? 0,
          }}
          battle={battle}
          isPending={battleState.isPending}
          options={
            <div className="flex flex-row items-center gap-2">
              {otherUser && (
                <TooltipProvider delayDuration={50}>
                  <ReportUser
                    button={
                      <div className="flex h-10 min-h-10 w-10 min-w-10 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                        <Flag className="h-6 w-6" />
                      </div>
                    }
                    system="battle_log"
                    user={otherUser}
                    content={{
                      id: battleId,
                      title: "Report Battle Log",
                      content:
                        "Reporting this battle log will cause it to not be deleted the next 72 hours, so that a moderator may review it",
                    }}
                  />
                </TooltipProvider>
              )}
              <UserCombatSettings
                config={config}
                userData={userData}
                supportsBattleFocus={false}
              />
            </div>
          }
        />
      </div>
    );
  }, [battle, battleState, userId, otherUser, battleId, config, userData]);

  const renderBattlefield = useCallback(() => {
    return (
      <div className="relative overflow-hidden rounded-lg border bg-card text-card-foreground shadow-lg">
        {combat}
      </div>
    );
  }, [combat]);

  const renderBattleLog = useCallback(() => {
    // Saved fights still need their history when the live combat layout hides its log.
    return <CombatHistory battleId={battleId} battleVersion={versionId} />;
  }, [battleId, versionId]);

  // Component renderer based on ID (only timer, battlefield, and battlelog for spectate view)
  const renderComponent = useCallback(
    (id: CombatLayoutComponentId) => {
      switch (id) {
        case "timer":
          return renderTimer();
        case "battlefield":
          return renderBattlefield();
        case "battlelog":
          return renderBattleLog();
        default:
          return null;
      }
    },
    [renderTimer, renderBattlefield, renderBattleLog],
  );

  // Filter layout order to only include components relevant for spectate view
  const spectateLayoutOrder = config.layoutOrder.filter((id) =>
    ["timer", "battlefield", "battlelog"].includes(id),
  );

  // Format battle date/time for subtitle
  const battleDate = battleHistory?.createdAt;
  const dateString = battleDate
    ? battleDate.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const subtitle = dateString
    ? `Battle from ${dateString}`
    : isHistoryError
      ? "Could not load this battle"
      : isLoadingHistory
        ? "Loading..."
        : "Battle not found";

  return (
    <ContentBox title="Spectate" subtitle={subtitle} defaultBackHref="/profile">
      <div className="flex flex-col gap-1">
        {spectateLayoutOrder.map((id) => (
          <div key={id}>{renderComponent(id)}</div>
        ))}
      </div>
    </ContentBox>
  );
}
