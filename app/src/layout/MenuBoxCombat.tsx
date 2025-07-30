import React from "react";
import Link from "next/link";
import StatusBar from "@/layout/StatusBar";
import AvatarImage from "@/layout/Avatar";
import ItemWithEffects from "@/layout/ItemWithEffects";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dna, Link2, Gem } from "lucide-react";
import { useUserData } from "@/utils/UserContext";
import { useAtomValue } from "jotai";
import { userBattleAtom } from "@/utils/UserContext";
import { SideBannerTitle } from "@/components/layout/core4_default";
import { VisualizeEffects } from "@/layout/MenuBoxProfile";

const MenuBoxCombat: React.FC = () => {
  // State
  const { data: userData, timeDiff } = useUserData();
  const battle = useAtomValue(userBattleAtom);

  // Battle user state
  const battleUser = battle?.usersState.find(
    (u) => u.userId !== userData?.userId && !u.isSummon,
  );

  // Guard
  if (!battleUser) return null;

  return (
    <>
      <SideBannerTitle>
        <Link
          href={`/userid/${battleUser.userId}`}
          className="inline-block hover:text-orange-500 flex flex-row"
        >
          Enemy: {battleUser.username} <Link2 className="inline-block h-5 w-5" />
        </Link>
      </SideBannerTitle>
      <div className="grid grid-cols-2 md:grid-cols-1 items-center justify-center">
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
            title="HP"
            tooltip="Health"
            color="bg-red-500"
            showText={true}
            lastRegenAt={battleUser.regenAt}
            regen={0}
            status={"AWAKE"}
            current={battleUser?.curHealth}
            total={battleUser?.maxHealth}
            timeDiff={timeDiff}
          />
          <StatusBar
            title="CP"
            tooltip="Chakra"
            color="bg-blue-500"
            showText={true}
            lastRegenAt={battleUser.regenAt}
            regen={0}
            status={"AWAKE"}
            current={battleUser?.curChakra}
            total={battleUser?.maxChakra}
            timeDiff={timeDiff}
          />
          <StatusBar
            title="SP"
            tooltip="Stamina"
            color="bg-green-500"
            showText={true}
            lastRegenAt={battleUser.regenAt}
            regen={0}
            status={"AWAKE"}
            current={battleUser?.curStamina}
            total={battleUser?.maxStamina}
            timeDiff={timeDiff}
          />
        </div>
      </div>
      {battleUser?.bloodline && (
        <Popover>
          <PopoverTrigger>
            <div className="flex flex-row items-center hover:text-orange-500 hover:cursor-pointer">
              <Dna className="h-6 w-6 mr-2" /> {battleUser.bloodline.name ?? "??"}
            </div>
          </PopoverTrigger>
          <PopoverContent>
            <div className="max-w-[320px]">
              <ItemWithEffects
                item={battleUser.bloodline}
                key={battleUser.bloodline.id}
                hideDetails
              />
            </div>
          </PopoverContent>
        </Popover>
      )}
      {battleUser?.keystoneName && (
        <Popover>
          <PopoverTrigger>
            <div className="flex flex-row items-center hover:text-orange-500 hover:cursor-pointer">
              <Gem className="h-6 w-6 mr-2" /> {battleUser.keystoneName}
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-[320px]">
            <div className="p-4">
              {battleUser.keystoneItem && (
                <ItemWithEffects
                  item={battleUser.keystoneItem}
                  key={battleUser.keystoneItem.id}
                  hideDetails
                />
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
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
