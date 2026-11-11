"use client";

import { Menu } from "lucide-react";
import type React from "react";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "@/components/ui/menubar";
import Link from "@/layout/Link";
import { BUGS_NAV_LINK, getMainNavbarLinks } from "@/libs/menus";
import { useUserData } from "@/utils/UserContext";

interface PixelPublicMenuDropdownProps {
  /** Landing section links listed above the site pages, for headers that hide them. */
  sectionLinks?: PixelPublicMenuSectionLink[];
  align?: "start" | "end";
}

const PixelPublicMenuDropdown: React.FC<PixelPublicMenuDropdownProps> = ({
  sectionLinks = [],
  align = "start",
}) => {
  const { notifications } = useUserData();
  const menuItems = [...getMainNavbarLinks(notifications), BUGS_NAV_LINK];

  return (
    <Menubar className="tnr-ink-menu-root border-0 bg-transparent p-0 shadow-none">
      <MenubarMenu>
        <MenubarTrigger aria-label="Open site menu" className="tnr-ink-menu-trigger">
          <Menu className="h-4 w-4" />
        </MenubarTrigger>
        <MenubarContent align={align} side="bottom" className="tnr-ink-menu-content">
          {sectionLinks.map((link) => (
            <MenubarItem key={link.href} asChild className="tnr-ink-menu-item">
              <PixelPublicNavLink href={link.href}>{link.name}</PixelPublicNavLink>
            </MenubarItem>
          ))}
          {sectionLinks.length > 0 && <MenubarSeparator />}
          {menuItems.map((item) => {
            const count = item.notificationCount ?? 0;
            return (
              <MenubarItem key={item.href} asChild className="tnr-ink-menu-item">
                <Link href={item.href}>
                  {item.icon}
                  <span>{item.name}</span>
                  {count > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center bg-red-800 px-1 text-amber-50 text-xs">
                      {count}
                    </span>
                  )}
                </Link>
              </MenubarItem>
            );
          })}
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
};

export default PixelPublicMenuDropdown;

/**
 * Link to a landing section or page. A bare hash ("#world") scrolls the current page, so
 * it stays a plain anchor; anything else navigates client-side.
 */
export const PixelPublicNavLink: React.FC<
  React.ComponentProps<"a"> & { href: string }
> = ({ href, ...props }) =>
  href.startsWith("#") ? <a href={href} {...props} /> : <Link href={href} {...props} />;

export interface PixelPublicMenuSectionLink {
  href: string;
  name: string;
}
