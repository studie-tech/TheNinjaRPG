import type React from "react";
import type { UserRank } from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import Link from "@/layout/Link";
import { showUserRank } from "@/libs/profile";

/**
 * Linked player tile: avatar, bold username and the level line. `children` lets an overlay
 * action sit inside the link; it must stop the link's navigation itself.
 */
export const UserAvatarTile: React.FC<{
  user: {
    username: string;
    avatar: string | null;
    level?: number;
    rank?: UserRank;
    isOutlaw?: boolean;
  };
  hideLevel?: boolean;
  className?: string;
  children?: React.ReactNode;
}> = ({ user, hideLevel, className, children }) => (
  <Link href={`/username/${user.username}`} className={className}>
    <AvatarImage
      href={user.avatar}
      alt={user.username}
      hover_effect={true}
      size={100}
    />
    {children}
    <div>
      <div className="font-bold">{user.username}</div>
      {!hideLevel && (
        <div>
          Lvl. {user.level} {showUserRank(user)}
        </div>
      )}
    </div>
  </Link>
);
