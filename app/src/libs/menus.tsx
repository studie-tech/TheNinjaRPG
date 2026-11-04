import {
  AlertCircle,
  Atom,
  BookOpenText,
  Briefcase,
  Bug,
  CheckCircle,
  Clock,
  Database,
  Flag,
  Gavel,
  Globe2,
  Inbox,
  LifeBuoy,
  MessageSquare,
  MessagesSquare,
  Newspaper,
  Paintbrush,
  Receipt,
  ShieldHalf,
  User,
  XCircle,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";
import type { SupportTicketStatus } from "@/drizzle/constants";
import { useSectorVillage } from "@/hooks/useSectorVillage";
import Image from "@/layout/Image";
import { findVillageUserRelationship } from "@/utils/alliance";
import { usePublicPathname } from "@/utils/routing";
import { useUserDataSelector, useUserInfo } from "@/utils/UserContext";

export interface NavBarDropdownLink {
  id?: string;
  href: string;
  name: string;
  requireAwake?: boolean;
  color?: "default" | "red" | "green" | "blue" | "toast" | "hidden";
  icon?: ReactNode;
  group?: string;
  notificationCount?: number;
  /** If true, notification will be shown even when user is on the same page as href */
  alwaysShow?: boolean;
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
      href: "/guide",
      name: "Guide",
      icon: <BookOpenText className="h-6 w-6" />,
    },
    {
      id: "tutorial-forum",
      href: "/forum",
      name: "Forum",
      icon: <MessagesSquare className="h-6 w-6" />,
    },
    {
      id: "tutorial-data",
      href: "/manual",
      name: "Data",
      icon: <Database className="h-6 w-6" />,
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

/** Icon-only bugs entry for the header circles and compact menus. */
export const BUGS_NAV_LINK: NavBarDropdownLink = {
  id: "tutorial-bugs",
  href: "/help",
  name: "Bugs",
  icon: <Bug className="h-6 w-6" />,
};

/** Build game navigation from the current player state, public route and notifications. */
export const useGameMenu = () => {
  const { data: userData } = useUserDataSelector((user) => ({
    sector: user.sector,
    villageId: user.villageId,
    village: user.village,
    isOutlaw: user.isOutlaw,
    status: user.status,
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

  const status = userData?.status;
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
      const notAwake = inBattle || inHospital || inBed;
      systems.forEach((system) => {
        if (system.requireAwake && notAwake) {
          if (inBattle) system.href = "/combat";
          if (inHospital) system.href = "/hospital";
          if (inBed) system.href = "/home";
        }
      });
    }

    return systems;
  }, [newInInbox, newInReports, newInSupport, newInProfile, status]);

  const { sectorVillage: sector } = useSectorVillage(userData);

  const ownSector = userData?.sector === userData?.village?.sector;
  const isAllied =
    !!sector &&
    findVillageUserRelationship(sector, userData?.villageId ?? "syndicate")?.status ===
      "ALLY";
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
