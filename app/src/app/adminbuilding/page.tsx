"use client";

import { Gamepad2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { IMG_BUILDING_ADMINBUILDING, VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import Accordion from "@/layout/Accordion";
import BanInfo from "@/layout/BanInfo";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import { LogbookEntry } from "@/layout/Logbook";
import { showMutationToast } from "@/libs/toast";
import { availableQuestLetterRanks } from "@/libs/train";
import { useRequireInVillage } from "@/utils/UserContext";

export default function AdministrationBuilding() {
  const util = api.useUtils();

  const [activeElement, setActiveElement] = useState<string>("");
  const { userData, access } = useRequireInVillage("/adminbuilding");

  // Query
  const { data: hallData } = api.quests.allianceBuilding.useQuery(
    {
      villageId: userData?.isOutlaw
        ? VILLAGE_SYNDICATE_ID
        : (userData?.villageId ?? VILLAGE_SYNDICATE_ID),
      level: userData?.level,
      rank: userData?.rank ? availableQuestLetterRanks(userData.rank) : [],
    },
    { enabled: !!userData },
  );

  // Mutations
  const { mutate: startQuest, isPending } = api.quests.startQuest.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await Promise.all([
        util.profile.getUser.invalidate(),
        util.quests.allianceBuilding.invalidate(),
      ]);
    },
  });

  // Default active tab
  useEffect(() => {
    if (userData && !activeElement) {
      const currentQuest = userData?.userQuests?.find((uq) =>
        ["event"].includes(uq.quest.questType),
      );
      if (currentQuest) {
        setActiveElement(currentQuest.quest.name);
      }
    }
  }, [userData]);

  // Guard
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Hall" />;
  if (userData.isBanned) return <BanInfo />;

  return (
    <ContentBox
      title="Administration Building"
      subtitle="Information Board"
      defaultBackHref="/village"
      padding={false}
    >
      <Image
        alt="welcome"
        src={IMG_BUILDING_ADMINBUILDING}
        width={512}
        height={195}
        className="w-full"
        priority={true}
      />
      <p className="p-3">
        Welcome, fellow ninja, to the administration building of Wake Island. I am
        headmaster Tenjiro and it is my privilege to welcome you to this center of
        discovery and challenge. Within these walls, the path to greatness awaits you.
      </p>
      <p className="px-3">
        Listed below, you will find the array of quests currently available for your
        undertaking. As you pursue them, know that our dedicated assistants are here to
        offer guidance and support whenever you require it. They stand ready to aid you
        in your noble pursuits.
      </p>
      {isPending && <Loader explanation="Accepting..." />}
      {!isPending && (
        <div className="mt-3 bg-popover">
          {hallData?.length === 0 && (
            <p className="font-bold">No current quests for you</p>
          )}
          {hallData?.map((quest, i) => {
            const currentQuest = userData?.userQuests?.find(
              (uq) => uq.quest.id === quest.id && !uq.endAt,
            );
            const currentTracker = userData?.questData?.find((q) => q.id === quest.id);
            const active = currentQuest && currentTracker;

            return (
              <div key={`${quest.id}-${i}`}>
                <Accordion
                  title={quest.name}
                  selectedTitle={activeElement}
                  titlePrefix={`${active ? "Active" : "Available"}: `}
                  onClick={setActiveElement}
                >
                  {active ? (
                    <div className="p-3">
                      <LogbookEntry
                        userQuest={currentQuest}
                        tracker={currentTracker}
                        hideTitle
                        showScene
                      />
                    </div>
                  ) : (
                    <ItemWithEffects
                      item={quest}
                      showEdit="quest"
                      imageExtra={
                        <Button
                          className="mt-2"
                          onClick={() =>
                            startQuest({
                              questId: quest.id,
                              userSector: userData.sector,
                            })
                          }
                        >
                          <Gamepad2 className="mr-1 h-6 w-6" />
                          Take Quest
                        </Button>
                      }
                      hideTitle
                    />
                  )}
                </Accordion>
              </div>
            );
          })}
        </div>
      )}
    </ContentBox>
  );
}
