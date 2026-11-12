"use client";

import {
  Crown,
  Handshake,
  Landmark,
  ScrollText,
  Shield,
  Swords,
  UsersRound,
} from "lucide-react";
import type React from "react";
import { useLocalStorage } from "@/hooks/localstorage";
import { AllianceHall } from "@/layout/AllianceHall";
import BanInfo from "@/layout/BanInfo";
import { ElderHall } from "@/layout/ElderHall";
import { KageHall } from "@/layout/KageHall";
import Loader from "@/layout/Loader";
import NavTabs, { resolveRememberedTab } from "@/layout/NavTabs";
import { ShrineHall } from "@/layout/ShrineHall";
import { VillageDuty } from "@/layout/VillageDuty";
import { VillageMission } from "@/layout/VillageMission";
import { VillageStructureMaintenance } from "@/layout/VillageStructureMaintenance";
import { WarRoom } from "@/layout/WarSystem";
import { useRequiredUserData } from "@/utils/UserContext";

/** Route village governance and diplomacy to the panels available to the current character. */
export default function TownHall() {
  const { data: userData } = useRequiredUserData();
  const availableTabs = userData?.isOutlaw
    ? ["Alliance", "Wars", "Shrines"]
    : [
        "Alliance",
        "Kage",
        "Elders",
        "Wars",
        "Shrines",
        "Village Mission",
        "Patrol Duty",
      ];
  const [storedTab, setTab] = useLocalStorage<(typeof availableTabs)[number] | null>(
    "townhallTab",
    null,
    true,
  );
  const tab = storedTab
    ? (resolveRememberedTab(storedTab, availableTabs, townhallTabAliases) ?? null)
    : null;

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (userData.isBanned) return <BanInfo />;

  const NavBarBlock = (
    <NavTabs
      id={`townhallSelection-${userData.villageId}`}
      current={tab}
      options={availableTabs}
      aliases={townhallTabAliases}
      setValue={setTab}
      icons={{
        Alliance: (
          <Handshake
            className="size-4 shrink-0 @min-[640px]/townhall:hidden"
            aria-hidden="true"
          />
        ),
        Kage: (
          <Crown
            className="size-4 shrink-0 @min-[640px]/townhall:hidden"
            aria-hidden="true"
          />
        ),
        Elders: (
          <UsersRound
            className="size-4 shrink-0 @min-[640px]/townhall:hidden"
            aria-hidden="true"
          />
        ),
        Wars: (
          <Swords
            className="size-4 shrink-0 @min-[640px]/townhall:hidden"
            aria-hidden="true"
          />
        ),
        Shrines: (
          <Landmark
            className="size-4 shrink-0 @min-[640px]/townhall:hidden"
            aria-hidden="true"
          />
        ),
        "Patrol Duty": (
          <Shield
            className="size-4 shrink-0 @min-[640px]/townhall:hidden"
            aria-hidden="true"
          />
        ),
        "Village Mission": (
          <ScrollText
            className="size-4 shrink-0 @min-[640px]/townhall:hidden"
            aria-hidden="true"
          />
        ),
      }}
      iconOnlyOptions={availableTabs}
      labelClassName={(option) =>
        option === (tab ?? "Alliance")
          ? "not-sr-only"
          : "@min-[640px]/townhall:not-sr-only"
      }
      fontSize="text-xs"
      listClassName="flex-nowrap gap-0.5"
      itemClassName={() => "mr-0 shrink-0"}
      className="min-h-11 min-w-8 px-1.5 @min-[640px]/townhall:px-2"
    />
  );

  let content: React.ReactNode;
  if (tab === "Alliance" || !tab) {
    content = <AllianceHall user={userData} navTabs={NavBarBlock} />;
  } else if (tab === "Kage") {
    content = <KageHall user={userData} navTabs={NavBarBlock} />;
  } else if (tab === "Elders") {
    content = <ElderHall user={userData} navTabs={NavBarBlock} />;
  } else if (tab === "Wars") {
    content = <WarRoom user={userData} navTabs={NavBarBlock} />;
  } else if (tab === "Shrines") {
    content = <ShrineHall user={userData} navTabs={NavBarBlock} />;
  } else if (tab === "Patrol Duty") {
    content = (
      <VillageDuty
        villageId={userData.villageId ?? ""}
        sector={userData.village?.sector}
        navTabs={NavBarBlock}
      />
    );
  } else if (tab === "Village Mission") {
    content = (
      <>
        <VillageMission villageId={userData.villageId ?? ""} navTabs={NavBarBlock} />
        {userData.userId === userData.village?.kageId && (
          <VillageStructureMaintenance villageId={userData.villageId ?? ""} />
        )}
      </>
    );
  }
  return <div className="@container/townhall min-w-0">{content}</div>;
}

/** Keep existing town hall selections usable when a tab's displayed name changes. */
const townhallTabAliases = { "Village Duty": "Patrol Duty" };
