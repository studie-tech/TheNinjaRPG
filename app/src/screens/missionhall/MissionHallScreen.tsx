"use client";

import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocalStorage } from "@/hooks/localstorage";
import BanInfo from "@/layout/BanInfo";
import BountyBoard from "@/layout/BountyBoard";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import MissionHall from "@/layout/MissionHall";
import NavTabs from "@/layout/NavTabs";
import { SystemIntroBanner } from "@/layout/SystemIntroBanner";
import { useRequireInVillage } from "@/utils/UserContext";

/** Render the missionhall screen independently of its route adapter. */
export function MissionHallScreen() {
  const { userData, access, deniedMessage } = useRequireInVillage("/missionhall", {
    stayWhenDenied: true,
  });

  const [activeTab, setActiveTab] = useLocalStorage<string>(
    "MissionHallTab",
    "Missions",
  );
  const showMissions = activeTab === "Missions";
  const showBounties = activeTab === "Bounties";

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (deniedMessage) {
    const homeSector = userData.village?.sector;
    return (
      <ContentBox
        title="Mission Hall"
        subtitle="Not reachable from here"
        defaultBackHref="/village"
      >
        <p>{deniedMessage}</p>
        {homeSector !== undefined && (
          <Link href={`/travel?sector=${homeSector}`} className="mt-3 inline-block">
            <Button>
              <MapPin className="mr-2 h-5 w-5" />
              Travel to {userData.village?.name ?? "your village"}
            </Button>
          </Link>
        )}
      </ContentBox>
    );
  }
  if (!access) return <Loader explanation="Accessing Hall" />;
  if (userData.isBanned) return <BanInfo />;

  return (
    <ContentBox
      title={userData.isOutlaw ? "Crimes Board" : "Mission Hall"}
      subtitle={
        userData.isOutlaw ? "Small and big assignments" : "Help the village grow"
      }
      defaultBackHref="/village"
      padding={false}
      topRightContent={
        <NavTabs
          current={activeTab}
          options={["Missions", "Bounties"]}
          setValue={setActiveTab}
        />
      }
    >
      <SystemIntroBanner system="missionhall" className="m-3" />
      {showMissions && <MissionHall userData={userData} />}
      {showBounties && <BountyBoard userData={userData} />}
    </ContentBox>
  );
}
