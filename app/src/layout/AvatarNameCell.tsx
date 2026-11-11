import type React from "react";
import AvatarImage from "@/layout/Avatar";
import Link from "@/layout/Link";
import { cn } from "@/libs/shadui";

/**
 * Fixed-width table cell with a small avatar over a name. Long names break inside the
 * cell and clamp to two lines, with the full name in a tooltip, so they never spill
 * into the next column.
 */
export const AvatarNameCell: React.FC<{
  name?: string | null;
  avatar?: string | null;
  /** Wraps avatar and name in a link when given. */
  href?: string;
  hoverEffect?: boolean;
  /** Extra classes for the avatar, e.g. a finished-battle grayscale border. */
  avatarClassName?: string;
  className?: string;
}> = ({ name, avatar, href, hoverEffect, avatarClassName, className }) => {
  const content = (
    <>
      <AvatarImage
        className={avatarClassName}
        href={avatar}
        alt={name ?? "Unknown"}
        size={100}
        hover_effect={hoverEffect}
      />
      {name && (
        <p className="line-clamp-2 break-words" title={name}>
          {name}
        </p>
      )}
    </>
  );
  return (
    <div className={cn("w-20 shrink-0 text-center", className)}>
      {href ? <Link href={href}>{content}</Link> : content}
    </div>
  );
};
