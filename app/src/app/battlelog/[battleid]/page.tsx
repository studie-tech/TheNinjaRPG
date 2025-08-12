"use client";

import { useEffect, useState, useMemo, use } from "react";
import dynamic from "next/dynamic";
import { api } from "@/app/_trpc/client";
import { useRequiredUserData } from "@/utils/UserContext";
import ActionTimer from "@/layout/ActionTimer";
import ContentBox from "@/layout/ContentBox";
import CombatHistory from "@/layout/CombatHistory";
import type { BattleState } from "@/libs/combat/types";
import { Button } from "@/components/ui/button";
import { LayoutGrid } from "lucide-react";
import { useLocalStorage } from "@/hooks/localstorage";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import ReportUser from "@/layout/Report";
import { Flag } from "lucide-react";

const Combat = dynamic(() => import("@/layout/Combat"));

export default function BattleLog(props: { params: Promise<{ battleid: string }> }) {
  const params = use(props.params);
  // State
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [showGridNumbers, setShowGridNumbers] = useLocalStorage<boolean>(
    "showGridNumbers",
    true,
  );
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
          showGridNumbers={showGridNumbers}
        />
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, userId, showGridNumbers]);

  return (
    <ContentBox
      title="Spectate"
      subtitle="Available for 3h! "
      defaultBackHref="/profile"
      padding={false}
      topRightContent={
        <div className="flex flex-row items-center gap-2">
          {battle && (
            <ActionTimer
              user={{
                userId: userId,
                actionPoints:
                  battle.usersState.find((u) => u.userId === userId)?.actionPoints ?? 0,
              }}
              battle={battle}
              isPending={battleState.isPending}
            />
          )}
          {otherUser && (
            <ReportUser
              button={
                <TooltipProvider delayDuration={50}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Flag className="h-6 w-6 cursor-pointer hover:text-orange-500" />
                    </TooltipTrigger>
                    <TooltipContent>Report User</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
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
          )}

          {battle && (
            <Button
              variant={showGridNumbers ? "default" : "outline"}
              size="icon"
              onClick={() => setShowGridNumbers(!showGridNumbers)}
              className="h-8 w-8 min-w-8 min-h-8"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          )}
        </div>
      }
    >
      {combat}
      <CombatHistory battleId={battleId} battleVersion={versionId} />
    </ContentBox>
  );
}
