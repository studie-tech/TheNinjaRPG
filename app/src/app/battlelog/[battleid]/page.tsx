"use client";

import { useEffect, useState, useMemo, useCallback, use } from "react";
import dynamic from "next/dynamic";
import { api } from "@/app/_trpc/client";
import { useRequiredUserData } from "@/utils/UserContext";
import ActionTimer from "@/layout/ActionTimer";
import ContentBox from "@/layout/ContentBox";
import CombatHistory from "@/layout/CombatHistory";
import type { BattleState } from "@/libs/combat/types";
import { useCombatPreferences, type CombatLayoutComponentId } from "@/hooks/combat";
import { UserCombatSettings } from "@/layout/UserCombatSettings";
import { TooltipProvider } from "@/components/ui/tooltip";
import ReportUser from "@/layout/Report";
import { Flag } from "lucide-react";

const Combat = dynamic(() => import("@/layout/Combat"), { ssr: false });

export default function BattleLog(props: { params: Promise<{ battleid: string }> }) {
  const params = use(props.params);
  // State
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const config = useCombatPreferences();
  const [battleState, setBattleState] = useState<BattleState | undefined>(undefined);
  const battleId = params.battleid;

  const { data: userData } = useRequiredUserData();
  const { data } = api.combat.getBattle.useQuery(
    { battleId: battleId },
    { enabled: !!battleId },
  );
  const { data: battleHistory } = api.combat.getBattleHistoryEntry.useQuery(
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
      setUserId(userData.userId);
      setBattleState({ battle: data?.battle, result: undefined, isPending: false });
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
        />
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, userId, config.showGridNumbers]);

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
                      <div className="flex h-10 w-10 min-h-10 min-w-10 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground">
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
              <UserCombatSettings config={config} userData={userData} />
            </div>
          }
        />
      </div>
    );
  }, [battle, battleState, userId, otherUser, battleId, config, userData]);

  const renderBattlefield = useCallback(() => {
    return (
      <div className="relative rounded-lg border bg-card shadow-lg text-card-foreground overflow-hidden">
        {combat}
      </div>
    );
  }, [combat]);

  const renderBattleLog = useCallback(() => {
    if (!config.showBattleLog) return null;
    return <CombatHistory battleId={battleId} battleVersion={versionId} />;
  }, [config.showBattleLog, battleId, versionId]);

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

  return (
    <ContentBox
      title="Spectate"
      subtitle="Available for 3h!"
      defaultBackHref="/profile"
    >
      <div className="flex flex-col gap-1">
        {spectateLayoutOrder.map((id) => (
          <div key={id}>{renderComponent(id)}</div>
        ))}
      </div>
    </ContentBox>
  );
}
