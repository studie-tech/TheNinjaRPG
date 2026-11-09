import { useAtomValue } from "jotai";
import {
  Atom,
  BookOpenText,
  Briefcase,
  Flag,
  Gavel,
  Globe2,
  Inbox,
  LifeBuoy,
  MessagesSquare,
  Receipt,
  ShieldHalf,
  User,
} from "lucide-react";
import { useMemo } from "react";
import { useSectorVillage } from "@/hooks/useSectorVillage";
import Image from "@/layout/Image";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import {
  chatMentionsAtom,
  chatTavernActivityAtom,
  countTavernUnread,
} from "@/libs/chatPanel";
import type { NavBarDropdownLink } from "@/libs/menus";
import { findVillageUserRelationship } from "@/utils/alliance";
import { usePublicPathname } from "@/utils/routing";
import { useUserDataSelector, useUserInfo } from "@/utils/UserContext";

/** Build game navigation from the current player state, public route and notifications. */
export const useGameMenu = () => {
  const { data: userData } = useUserDataSelector((user) => ({
    sector: user.sector,
    villageId: user.villageId,
    village: user.village,
    isOutlaw: user.isOutlaw,
    status: user.status,
    autoWakeUp: user.autoWakeUp,
    chatMuted: user.chatMuted,
    mutedConversationIds: user.mutedConversationIds,
    unmutedTavernIds: user.unmutedTavernIds,
  }));
  const pathname = usePublicPathname();
  const { notifications } = useUserInfo();

  // Extract inbox notifications
  const newInInbox =
    notifications?.find((n) => n.href === "/inbox")?.notificationCount || 0;
  const newInReports =
    notifications?.find((n) => n.href === "/reports")?.notificationCount || 0;
  const newInSupport =
    notifications?.find((n) => n.href === "/support")?.notificationCount || 0;
  const newInProfile =
    notifications?.find((n) => n.href.includes("/profile"))?.notificationCount || 0;
  // Counted in the browser from live tavern messages, like the chat button.
  const mentions = useAtomValue(chatMentionsAtom);
  const tavernActivity = useAtomValue(chatTavernActivityAtom);
  const newInTavern = countTavernUnread(userData, mentions, tavernActivity);

  const status = userData?.status;
  const autoWakeUp = userData?.autoWakeUp;
  const systems = useMemo(() => {
    const systems: NavBarDropdownLink[] = [
      {
        id: "tutorial-profile",
        href: "/profile",
        name: "Profile",
        icon: <User key="profile" className="h-6 w-6" />,
        notificationCount: newInProfile,
      },
      {
        id: "tutorial-tavern",
        href: "/tavern",
        name: "Tavern",
        icon: <MessagesSquare key="tavern" className="h-6 w-6" />,
        notificationCount: newInTavern,
      },
      {
        id: "tutorial-users",
        href: "/users",
        name: "Users",
        icon: <BookOpenText key="users" className="h-6 w-6" />,
      },
      {
        id: "tutorial-inbox",
        href: "/inbox",
        name: "Inbox",
        icon: <Inbox key="inbox" className="h-6 w-6" />,
        notificationCount: newInInbox,
      },
      {
        id: "tutorial-jutsus",
        href: "/jutsus",
        name: "Jutsus",
        requireAwake: false,
        icon: <Atom key="jutsus" className="h-6 w-6" />,
      },
      {
        id: "tutorial-reports",
        href: "/reports",
        name: "Reports",
        icon: <Flag key="reports" className="h-6 w-6" />,
        notificationCount: newInReports,
      },
      {
        href: "/travel",
        id: "tutorial-travel",
        name: "Travel",
        requireAwake: true,
        icon: <Globe2 key="travel" className="h-6 w-6" />,
      },

      {
        id: "tutorial-points",
        href: "/points",
        name: "Points",
        icon: <Receipt key="travel" className="h-6 w-6" />,
      },
      {
        href: "/items",
        id: "tutorial-items",
        name: "Items",
        requireAwake: false,
        icon: <ShieldHalf key="items" className="h-6 w-6" />,
      },
      {
        id: "tutorial-jobs",
        href: "/occupation",
        name: "Jobs",
        icon: <Briefcase key="jobs" className="h-6 w-6" />,
      },
      {
        id: "tutorial-support",
        href: "/support",
        name: "Help",
        icon: <LifeBuoy key="support" className="h-6 w-6" />,
        notificationCount: newInSupport,
      },
      {
        id: "tutorial-rules",
        href: "/rules",
        name: "Rules",
        icon: <Gavel key="rules" className="h-6 w-6" />,
      },
    ];
    // Based on user status, update href of systems
    if (status) {
      // For entries that require awake, check if user is awake
      const inBattle = status === "BATTLE";
      const inHospital = status === "HOSPITALIZED";
      const inBed = status === "ASLEEP";
      const notAwake = !canAttemptAwakeAction({ status, autoWakeUp });
      systems.forEach((system) => {
        if (system.requireAwake && notAwake) {
          if (inBattle) system.href = "/combat";
          if (inHospital) system.href = "/hospital";
          if (inBed) system.href = "/home";
        }
      });
    }

    return systems;
  }, [
    newInInbox,
    newInReports,
    newInSupport,
    newInProfile,
    newInTavern,
    status,
    autoWakeUp,
  ]);

  const { sectorVillage: sector } = useSectorVillage(userData);

  const ownSector = userData?.sector === userData?.village?.sector;
  const isAllied =
    !!sector &&
    findVillageUserRelationship(sector, userData?.villageId)?.status === "ALLY";
  // Position matters only when it changes the structure offered by the menu.
  const { data: arrival } = useUserDataSelector((user) => ({
    canVisit:
      !!sector &&
      (ownSector || isAllied || user.isOutlaw || sector.type === "SAFEZONE"),
    structureId:
      pathname === "/travel" && (ownSector || isAllied)
        ? sector?.structures?.find(
            (entry) =>
              entry.longitude === user.longitude && entry.latitude === user.latitude,
          )?.id
        : undefined,
  }));
  const canVisit = arrival?.canVisit;
  const structure = sector?.structures?.find(
    (entry) => entry.id === arrival?.structureId,
  );
  // Coordinates choose the model; unchanged village/structure content retains the menu subtree.
  const location = useMemo<NavBarDropdownLink | undefined>(() => {
    if (!canVisit || !sector) return undefined;
    const name = structure?.name || sector.mapName || sector.name;
    return {
      id: "tutorial-village",
      href: structure?.route || "/village",
      name: structure?.name || "Village",
      requireAwake: true,
      icon: (
        <div>
          <Image
            src={structure?.image || sector.villageGraphic}
            alt={name}
            width={200}
            height={200}
            priority={true}
          />
          <span className="font-bold">
            {name} {!structure && sector.type === "VILLAGE" ? "Village" : ""}
          </span>
        </div>
      ),
    };
  }, [canVisit, structure, sector]);

  return { systems, location };
};
