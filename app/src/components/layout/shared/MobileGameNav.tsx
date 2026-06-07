"use client";

import { Compass, House } from "lucide-react";
import Link from "next/link";
import type { NavBarDropdownLink } from "@/libs/menus";
import type { MobileNavConfig } from "@/libs/mobileNavConfig";
import { getMobileNavIcon, getNavOptionById } from "@/libs/mobileNavConfig";
import { cn } from "@/libs/shadui";

interface MobileGameNavProps {
  mobileNavConfig: MobileNavConfig;
  location?: NavBarDropdownLink;
  yellowButtonClassName: string;
  mobileNavbarButtonClassName: string;
  className?: string;
}

const MobileGameNavButton: React.FC<{
  optionId: string;
  location?: NavBarDropdownLink;
  mobileNavbarButtonClassName: string;
}> = ({ optionId, location, mobileNavbarButtonClassName }) => {
  if (optionId === "travel" && !location) return null;

  const option = getNavOptionById(optionId);
  if (!option) return null;

  const Icon = getMobileNavIcon(optionId);
  return (
    <Link
      href={option.href}
      className="relative -top-2 flex justify-center"
      prefetch={true}
    >
      <Icon className={mobileNavbarButtonClassName} />
    </Link>
  );
};

export const MobileGameNav: React.FC<MobileGameNavProps> = ({
  mobileNavConfig,
  location,
  yellowButtonClassName,
  mobileNavbarButtonClassName,
  className,
}) => {
  return (
    <div className={cn("grid grid-cols-7 items-center justify-center", className)}>
      <div></div>
      {mobileNavConfig.left.map((optionId) => (
        <div key={optionId}>
          <MobileGameNavButton
            optionId={optionId}
            location={location}
            mobileNavbarButtonClassName={mobileNavbarButtonClassName}
          />
        </div>
      ))}
      {location ? (
        <Link
          href="/village"
          className="relative -top-8 flex justify-center"
          prefetch={true}
        >
          <div className="rounded-full bg-linear-to-b from-black/5 to-black/50 p-4">
            <House className={cn(yellowButtonClassName)} />
          </div>
        </Link>
      ) : (
        <Link
          href="/travel"
          className="relative -top-8 flex justify-center"
          prefetch={true}
        >
          <div className="rounded-full bg-linear-to-b from-black/5 to-black/50 p-4">
            <Compass className={mobileNavbarButtonClassName} />
          </div>
        </Link>
      )}
      {mobileNavConfig.right.map((optionId) => (
        <div key={optionId}>
          <MobileGameNavButton
            optionId={optionId}
            location={location}
            mobileNavbarButtonClassName={mobileNavbarButtonClassName}
          />
        </div>
      ))}
    </div>
  );
};
