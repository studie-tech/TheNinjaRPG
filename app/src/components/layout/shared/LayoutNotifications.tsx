"use client";

import { Bell, ChevronDown, Info, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLocalStorage } from "@/hooks/localstorage";
import type { NavBarDropdownLink } from "@/libs/menus";
import { cn } from "@/libs/shadui";
import { groupBy } from "@/utils/grouping";
import {
  type LayoutVariant,
  layoutVariantClasses,
  PIXEL_MOBILE_HEADER_BUTTON_STYLE,
  PIXEL_MOBILE_HEADER_ICON_STYLE,
} from "./layoutVariants";

const notificationColorMap = {
  default: "bg-slate-600",
  red: "bg-red-600",
  green: "bg-green-600",
  blue: "bg-blue-600",
  toast: "bg-orange-600",
  hidden: "bg-gray-600",
} as const;

interface NotificationListProps {
  notifications?: NavBarDropdownLink[];
  layout: "desktop" | "mobile";
  className?: string;
}

export const NotificationList: React.FC<NotificationListProps> = ({
  notifications,
  layout,
  className = "",
}) => {
  if (!notifications || notifications.length === 0) return null;

  const grouped = notifications.filter((n) => n.group);
  const ungrouped = notifications.filter((n) => !n.group);
  const groupedByCategory = groupBy(grouped, "group");

  const renderNotification = (
    notification: NavBarDropdownLink,
    key: string,
    isInPopover = false,
  ) => (
    <Link
      key={key}
      href={notification.href}
      id={notification.id}
      className={layout === "mobile" ? "block w-full" : undefined}
    >
      <div
        className={cn(
          "flex flex-row items-center rounded-lg border-2 border-slate-800 hover:opacity-70",
          layout === "mobile"
            ? "w-full shrink-0 whitespace-normal px-3 py-2 text-xs"
            : "py-[1px] pl-3 text-xs lg:text-base",
          notification.color
            ? notificationColorMap[notification.color]
            : "bg-slate-500",
          isInPopover && "border border-slate-600 px-3 py-2",
        )}
      >
        {notification.color === "red" && (
          <ShieldAlert
            className={cn("mr-1 text-white", isInPopover ? "mr-2 h-4 w-4" : "h-5 w-5")}
          />
        )}
        {notification.color === "blue" && (
          <Info
            className={cn("mr-1 text-white", isInPopover ? "mr-2 h-4 w-4" : "h-5 w-5")}
          />
        )}
        {notification.color === "green" && (
          <ShieldCheck
            className={cn("mr-1 text-white", isInPopover ? "mr-2 h-4 w-4" : "h-5 w-5")}
          />
        )}
        <span className="text-white">{notification.name}</span>
      </div>
    </Link>
  );

  const ungroupedElements = ungrouped.map((notification, i) =>
    renderNotification(notification, `ungrouped-${i}`),
  );

  const groupedElements = Array.from(groupedByCategory.entries())
    .map(([group, groupNotifications]) => {
      const firstNotification = groupNotifications[0];
      const count = groupNotifications.length;

      if (!firstNotification) return null;

      return (
        <Popover key={`group-${group}`}>
          <PopoverTrigger asChild>
            <div
              className={cn(
                "flex cursor-pointer flex-row items-center rounded-lg border-2 border-slate-800 text-xs hover:opacity-70 lg:text-base",
                layout === "mobile"
                  ? "w-full shrink-0 whitespace-normal px-3 py-2"
                  : "py-[1px] pl-3",
                firstNotification.color
                  ? notificationColorMap[firstNotification.color]
                  : "bg-slate-500",
              )}
            >
              {firstNotification.color === "red" && (
                <ShieldAlert className="mr-1 h-5 w-5" />
              )}
              {firstNotification.color === "blue" && <Info className="mr-1 h-5 w-5" />}
              {firstNotification.color === "green" && (
                <ShieldCheck className="mr-1 h-5 w-5" />
              )}
              {group} ({count})
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-96 p-0">
            <div className="p-4">
              <h4 className="mb-3 font-semibold text-sm">{group}</h4>
              <div className="flex flex-col gap-1">
                {groupNotifications.map((notification, i) =>
                  renderNotification(notification, `${group}-${i}`, true),
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      );
    })
    .filter(Boolean);

  const allElements = [...ungroupedElements, ...groupedElements];

  if (layout === "mobile") {
    return <>{allElements}</>;
  }

  return <ul className={cn("grid grid-cols-1 gap-[1px]", className)}>{allElements}</ul>;
};

interface CollapsibleNotificationsProps {
  notifications?: NavBarDropdownLink[];
  className?: string;
}

export const CollapsibleNotifications: React.FC<CollapsibleNotificationsProps> = ({
  notifications,
  className = "",
}) => {
  const [isCollapsed, setIsCollapsed] = useLocalStorage(
    "notificationsCollapsed",
    false,
  );

  const hasCritical = notifications?.some((n) => n.color === "red") ?? false;
  const count = notifications?.length ?? 0;

  if (!notifications || notifications.length === 0) return null;

  const badgeClass = hasCritical ? "bg-red-500 text-white" : "bg-slate-500 text-white";

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex w-full cursor-pointer items-center justify-between px-1 pt-2 font-bold text-orange-100 text-xl transition-colors duration-200 hover:text-orange-300"
        aria-label={isCollapsed ? `Show ${count} notifications` : "Hide notifications"}
        aria-expanded={!isCollapsed}
      >
        <span className="flex items-center gap-2">
          Notifications
          <span
            aria-hidden="true"
            className={cn(
              "flex h-[24px] min-w-[24px] items-center justify-center rounded-full px-2 font-bold text-sm transition-all duration-300",
              badgeClass,
              isCollapsed ? "scale-100 opacity-100" : "scale-75 opacity-0",
            )}
          >
            {count}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-5 w-5 transition-transform duration-300",
            isCollapsed ? "rotate-0" : "rotate-180",
          )}
        />
      </button>
      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{
          gridTemplateRows: isCollapsed ? "0fr" : "1fr",
        }}
      >
        <div className="overflow-hidden">
          <NotificationList
            notifications={notifications}
            layout="desktop"
            className={className}
          />
        </div>
      </div>
    </div>
  );
};

interface MobileNotificationsPopoverProps {
  notifications?: NavBarDropdownLink[];
  variant: LayoutVariant;
  count?: number;
}

export const MobileNotificationsPopover: React.FC<MobileNotificationsPopoverProps> = ({
  notifications,
  variant,
  count = notifications?.length ?? 0,
}) => {
  const isPixel = variant === "pixel";
  const hasNotifications = count > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("relative", isPixel && PIXEL_MOBILE_HEADER_BUTTON_STYLE)}
          aria-label={`Open notifications (${count})`}
        >
          <Bell
            className={
              isPixel
                ? PIXEL_MOBILE_HEADER_ICON_STYLE
                : cn(layoutVariantClasses[variant].yellowButton)
            }
          />
          {hasNotifications && (
            <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 font-bold text-[10px] text-white leading-none shadow-black/40 shadow-md">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={10}
        className={cn(
          "ml-2 w-[min(calc(100vw-1rem),22rem)] p-3 shadow-2xl",
          isPixel
            ? "border-2 border-sky-200/20 bg-slate-950/95 text-slate-50 shadow-black/50 backdrop-blur-md"
            : "border-2 border-border bg-background text-foreground shadow-black/30",
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <p
            className={cn(
              "font-bold text-sm",
              isPixel ? "text-amber-100" : "text-foreground",
            )}
          >
            Notifications
          </p>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-bold text-[11px]",
              isPixel
                ? "bg-slate-800 text-slate-200"
                : "bg-primary text-primary-foreground",
            )}
          >
            {count}
          </span>
        </div>
        {hasNotifications ? (
          <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
            <NotificationList notifications={notifications} layout="mobile" />
          </div>
        ) : (
          <p className={cn("py-2 text-sm", isPixel && "text-slate-300")}>
            No active notifications.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
};
