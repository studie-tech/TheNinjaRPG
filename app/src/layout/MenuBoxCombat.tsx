import { useAtomValue } from "jotai";
import { Dna, Gem, Link2 } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { SideBannerTitle } from "@/components/layout/core4_default";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useEffectivePools } from "@/hooks/useEffectivePools";
import AvatarImage from "@/layout/Avatar";
import ItemWithEffects from "@/layout/ItemWithEffects";
import { VisualizeEffects } from "@/layout/MenuBoxProfile";
import StatusBar from "@/layout/StatusBar";
import { getBloodline, getKeystoneItem } from "@/libs/combat/util";
import { userBattleAtom, useUserData } from "@/utils/UserContext";

const MenuBoxCombat: React.FC = () => {
  // State
  const { data: userData, timeDiff } = useUserData();
  const battle = useAtomValue(userBattleAtom);

  // Battle user state (enemy)
  const battleUser = battle?.usersState.find(
    (u) => u.userId !== userData?.userId && !u.isSummon,
  );

  // Calculate effective pool values with fallbacks
  const pools = useEffectivePools({
    battleUser,
    usersEffects: battle?.usersEffects,
  });

  // Guard
  if (!battleUser) return null;

  return (
    <>
      <SideBannerTitle>
        <Link
          href={`/userid/${battleUser.userId}`}
          className="inline-block flex flex-row hover:text-orange-500"
        >
          {battleUser.username} <Link2 className="inline-block h-5 w-5" />
        </Link>
      </SideBannerTitle>
      <div className="grid grid-cols-2 items-center justify-center md:grid-cols-1">
        <Link href="/profile">
          <AvatarImage
            href={battleUser.avatar}
            userId={battleUser.userId}
            alt={battleUser.username}
            refetchUserData={true}
            size={100}
            hover_effect={true}
            priority
          />
        </Link>

        <div className="pt-5">
          <StatusBar
            key={`hp-${pools.curHealth}-${pools.maxHealth}`}
            title="HP"
            tooltip="Health"
            color="bg-red-500"
            showText={true}
            lastRegenAt={battleUser.regenAt}
            regen={0}
            status={"AWAKE"}
            current={pools.curHealth}
            total={pools.maxHealth}
            timeDiff={timeDiff}
          />
          <StatusBar
            key={`cp-${pools.curChakra}-${pools.maxChakra}`}
            title="CP"
            tooltip="Chakra"
            color="bg-blue-500"
            showText={true}
            lastRegenAt={battleUser.regenAt}
            regen={0}
            status={"AWAKE"}
            current={pools.curChakra}
            total={pools.maxChakra}
            timeDiff={timeDiff}
          />
          <StatusBar
            key={`sp-${pools.curStamina}-${pools.maxStamina}`}
            title="SP"
            tooltip="Stamina"
            color="bg-green-500"
            showText={true}
            lastRegenAt={battleUser.regenAt}
            regen={0}
            status={"AWAKE"}
            current={pools.curStamina}
            total={pools.maxStamina}
            timeDiff={timeDiff}
          />
        </div>
      </div>
      {(() => {
        if (!battle || !battleUser?.bloodlineId) return null;
        const bloodline = getBloodline(battle, battleUser.bloodlineId);
        if (!bloodline) return null;
        return (
          <Popover>
            <PopoverTrigger>
              <div className="flex flex-row items-center hover:cursor-pointer hover:text-orange-500">
                <Dna className="mr-2 h-6 w-6" /> {bloodline.name ?? "??"}
              </div>
            </PopoverTrigger>
            <PopoverContent>
              <div className="max-w-[320px]">
                <ItemWithEffects item={bloodline} key={bloodline.id} hideDetails />
              </div>
            </PopoverContent>
          </Popover>
        );
      })()}
      {(() => {
        if (!battleUser?.keystoneName || !battle) return null;
        const keystoneItem = getKeystoneItem(battle, battleUser.keystoneItemId);
        if (!keystoneItem) return null;
        return (
          <Popover>
            <PopoverTrigger>
              <div className="flex flex-row items-center hover:cursor-pointer hover:text-orange-500">
                <Gem className="mr-2 h-6 w-6" /> {battleUser.keystoneName}
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-[320px]">
              <div className="p-4">
                <ItemWithEffects
                  item={keystoneItem}
                  key={keystoneItem.id}
                  hideDetails
                />
              </div>
            </PopoverContent>
          </Popover>
        );
      })()}
      {/* Active Effects on opponent */}
      {battle?.usersEffects && (
        <div className="mt-2">
          <VisualizeEffects effects={battle.usersEffects} userId={battleUser.userId} />
        </div>
      )}
    </>
  );
};

export default MenuBoxCombat;
