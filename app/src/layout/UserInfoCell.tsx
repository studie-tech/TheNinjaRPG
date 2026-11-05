import { showUserRank } from "@/libs/profile";

/** User table cell with the name, level and rank, and village or Syndicate. */
export const UserInfoCell = ({ user }: { user: UserInfoCellUser }) => (
  <div>
    <p className="font-bold">{user.username}</p>
    <p>
      Lvl. {user.level} {showUserRank(user)}
    </p>
    <p>{user.village?.name || "Syndicate"}</p>
  </div>
);

type UserInfoCellUser = Parameters<typeof showUserRank>[0] & {
  username: string;
  level: number;
  village?: { name: string } | null;
};
