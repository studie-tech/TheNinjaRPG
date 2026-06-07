"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import type React from "react";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "@/components/ui/menubar";
import { getMainNavbarLinks } from "@/libs/menus";
import { cn } from "@/libs/shadui";
import { useUserData } from "@/utils/UserContext";

const PixelPublicMenuDropdown: React.FC<{ className?: string }> = ({ className }) => {
  const { notifications } = useUserData();
  const menuItems = getMainNavbarLinks(notifications);

  return (
    <Menubar
      className={cn(
        "tnr-ink-menu-root border-0 bg-transparent p-0 shadow-none",
        className,
      )}
    >
      <MenubarMenu>
        <MenubarTrigger aria-label="Open site menu" className="tnr-ink-menu-trigger">
          <Menu className="h-4 w-4" />
        </MenubarTrigger>
        <MenubarContent align="start" side="bottom" className="tnr-ink-menu-content">
          {menuItems.map((item) => {
            const count = item.notificationCount ?? 0;
            return (
              <Link key={item.href} href={item.href} prefetch={false} tabIndex={-1}>
                <MenubarItem
                  onClick={async () => {
                    if (item.onClick) await item.onClick();
                  }}
                  className="tnr-ink-menu-item"
                >
                  {item.icon}
                  <span>{item.name}</span>
                  {count > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center bg-red-800 px-1 text-amber-50 text-xs">
                      {count}
                    </span>
                  )}
                </MenubarItem>
              </Link>
            );
          })}
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
};

export default PixelPublicMenuDropdown;
