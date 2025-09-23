import { type ReactNode } from "react";
import Image from "next/image";
import { Atom, Bug, User, Globe2, BookOpenText } from "lucide-react";
import { Paintbrush, MessagesSquare, Newspaper, Scale, Receipt } from "lucide-react";
import { Inbox, Flag, ShieldHalf, Briefcase, LifeBuoy, Gavel } from "lucide-react";
import { Clock, AlertCircle, CheckCircle, XCircle, MessageSquare } from "lucide-react";
import { calcIsInVillage } from "./travel/controls";
import { api } from "@/app/_trpc/client";
import { findVillageUserRelationship } from "@/utils/alliance";
import type { UserWithRelations } from "@/routers/profile";
import { usePathname } from "next/navigation";
import { useUserData } from "@/utils/UserContext";
import type { SupportTicketStatus } from "@/drizzle/constants";

export interface NavBarDropdownLink {
  id?: string;
  href: string;
  name: string;
  requireAwake?: boolean;
  className?: string;
  color?: "default" | "red" | "green" | "blue" | "toast" | "hidden";
  icon?: ReactNode;
  onClick?: () => Promise<void>;
  group?: string;
  notificationCount?: number;
}

/**
 * Get main navbar links
 */
export const getMainNavbarLinks = (notifications?: NavBarDropdownLink[]) => {
  // Get unread news
  const unreadNews =
    notifications?.find((n) => n.href === "/news")?.notificationCount || 0;

  const links: NavBarDropdownLink[] = [
    {
      id: "tutorial-news",
      href: "/news",
      name: "News",
      icon: <Newspaper className="h-6 w-6" />,
      notificationCount: unreadNews,
    },
    {
      id: "tutorial-manual",
      href: "/manual",
      name: "Info",
      icon: <Scale className="h-6 w-6" />,
    },
    {
      id: "tutorial-forum",
      href: "/forum",
      name: "Forum",
      icon: <MessagesSquare className="h-6 w-6" />,
    },
    {
      id: "tutorial-bugs",
      href: "/help",
      name: "Bugs",
      icon: <Bug className="h-6 w-6" />,
    },
    {
      id: "tutorial-art",
      href: "/conceptart",
      name: "Art",
      icon: <Paintbrush className="h-6 w-6" />,
    },
  ];
  return links;
};

export const useGameMenu = (userData: UserWithRelations) => {
  const pathname = usePathname();
  const { notifications } = useUserData();

  // Extract inbox notifications
  const newInInbox =
    notifications?.find((n) => n.href === "/inbox")?.notificationCount || 0;
  const newInReports =
    notifications?.find((n) => n.href === "/reports")?.notificationCount || 0;
  const newInSupport =
    notifications?.find((n) => n.href === "/support")?.notificationCount || 0;
  const newInProfile =
    notifications?.find((n) => n.href.includes("/profile"))?.notificationCount || 0;

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

  // Get information from the sector the user is currently in. No stale time
  const { data: sector } = api.travel.getVillageInSector.useQuery(
    { sector: userData?.sector ?? -1, isOutlaw: userData?.isOutlaw ?? false },
    { enabled: !!userData },
  );

  // Based on user status, update href of systems
  if (userData) {
    // For entries that require awake, check if user is awake
    const inBattle = userData.status === "BATTLE";
    const inHospital = userData.status === "HOSPITALIZED";
    const inBed = userData.status === "ASLEEP";
    const notAwake = inBattle || inHospital || inBed;
    systems.forEach((system) => {
      if (system.requireAwake && notAwake) {
        if (inBattle) system.href = "/combat";
        if (inHospital) system.href = "/hospital";
        if (inBed) system.href = "/home";
      }
    });
  }

  // Pre-defined location as undefined
  let location: NavBarDropdownLink | undefined = undefined;
  if (userData && sector) {
    // Check if user is in own village, or in
    const userVillage = userData.villageId ?? "syndicate";
    const ownSector = userData.sector === userData.village?.sector;
    const inVillage = calcIsInVillage({ x: userData.longitude, y: userData.latitude });
    const relationship = findVillageUserRelationship(sector, userVillage);
    const isAllied = relationship?.status === "ALLY";
    const isSafezone = sector.type === "SAFEZONE";
    // Is in village
    if ((inVillage && (ownSector || isAllied)) || userData.isOutlaw || isSafezone) {
      // Check if user is standing on a village structure
      const showStructure = ownSector || isAllied || (userData.isOutlaw && ownSector);
      const structure =
        pathname === "/travel" && showStructure
          ? sector.structures?.find(
              (s) =>
                s.longitude === userData.longitude && s.latitude === userData.latitude,
            )
          : undefined;
      const name = structure?.name || sector.mapName || sector.name;
      // Set the location
      location = {
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
    }
  }

  return { systems, location };
};

/** Status icons for tickets */
export const getStatusIcon = (status: SupportTicketStatus) => {
  switch (status) {
    case "OPEN":
      return <AlertCircle className="h-4 w-4" />;
    case "IN_PROGRESS":
      return <Clock className="h-4 w-4" />;
    case "WAITING_FOR_USER":
      return <MessageSquare className="h-4 w-4" />;
    case "WAITING_FOR_STAFF":
      return <MessageSquare className="h-4 w-4" />;
    case "RESOLVED":
      return <CheckCircle className="h-4 w-4" />;
    case "CLOSED":
      return <XCircle className="h-4 w-4" />;
    default:
      return <AlertCircle className="h-4 w-4" />;
  }
};
