"use client";

import { useLocalStorage } from "@/hooks/localstorage";
import BanInfo from "@/layout/BanInfo";
import BountyBoard from "@/layout/BountyBoard";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import MissionHall from "@/layout/MissionHall";
import NavTabs from "@/layout/NavTabs";
import { useRequireInVillage } from "@/utils/UserContext";

export default function MissionHallPage() {
  const { userData, access } = useRequireInVillage("/missionhall");

  const [activeTab, setActiveTab] = useLocalStorage<string>(
    "MissionHallTab",
    "Missions",
  );
  const showMissions = activeTab === "Missions";
  const showBounties = activeTab === "Bounties";

  if (!userData) return <Loader explanation="Loading userdata" />;
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
      {showMissions && <MissionHall userData={userData} />}
      {showBounties && <BountyBoard userData={userData} />}
    </ContentBox>
  );
}
