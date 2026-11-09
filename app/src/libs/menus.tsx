import {
  BookOpenText,
  Bug,
  Database,
  MessagesSquare,
  Newspaper,
  Paintbrush,
} from "lucide-react";
import type { ReactNode } from "react";

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
