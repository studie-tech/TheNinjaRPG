import type React from "react";
import type { FederalStatus, TavernColorPreset, UserRole } from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import Link from "@/layout/Link";
import { showUserRank } from "@/libs/profile";
import { cn } from "@/libs/shadui";
import { resolveTavernColorClasses } from "@/libs/tavernColors";
import type { UserCard } from "@/queries/userColumns";
import { contrastingTextColor } from "@/utils/color";
import { capitalizeFirstLetter } from "@/utils/string";

export interface PostProps {
  user?: UserCard & {
    displayTitle?: string | null;
    villageKageId?: string | null;
    villageName?: string | null;
    villageHexColor?: string | null;
    nRecruited?: number | null;
    tavernUsernameColor?: TavernColorPreset;
    tavernTitleColor?: TavernColorPreset;
    tavernMessages?: number | null;
  };
  className?: string;
  image?: React.ReactNode;
  title?: string;
  color?: "default" | "green" | "red" | "blue" | "orange" | "poppopover";
  children: any;
  options?: React.ReactNode;
  align_middle?: boolean;
  hover_effect?: boolean;
  href?: string;
  tavernStyling?: boolean;
}

const Post: React.FC<PostProps> = (props) => {
  let color = "bg-popover text-popover-foreground";
  let hover = "hover:bg-poppopover";

  switch (props.color) {
    case "green":
      color = "bg-green-200 text-black";
      hover = "hover:bg-green-300";
      break;
    case "red":
      color = "bg-red-300 text-black";
      hover = "hover:bg-red-400";
      break;
    case "blue":
      color = "bg-blue-200 text-black";
      hover = "hover:bg-blue-300";
      break;
    case "orange":
      color = "bg-orange-200 text-black";
      hover = "hover:bg-orange-300";
      break;
    case "poppopover":
      color = "bg-poppopover text-popover-foreground";
      hover = "hover:bg-poppopover";
      break;
  }

  const { userColor, userRole, roleTextColor, titleColor } = getPostUserClasses(
    props.user,
    props.tavernStyling,
  );

  // Blocks
  const UsernameBlock = props.user && (
    <div className="basis-1/4">
      <div className={`${userColor} font-bold`}>{props.user.username}</div>
      <div className="pt-1 pb-4 text-xs">
        <span className="m-1 rounded-md bg-slate-300 p-1 text-black">
          Lvl. {props.user.level}
        </span>
        <span className="m-1 rounded-md bg-slate-300 p-1 text-black">
          {showUserRank(props.user)}
        </span>
        {props.user.displayTitle && (
          <span className={`${titleColor} m-1 rounded-md p-1`}>
            {props.user.displayTitle}
          </span>
        )}
        {props.user.villageKageId && props.user.villageKageId === props.user.userId && (
          <span className="m-1 rounded-md bg-slate-300 p-1 text-black">
            {props.user?.isOutlaw ? "Daimyo" : "Kage"}
          </span>
        )}
        {props.user?.role !== "USER" && (
          <span className={`${userRole} m-1 rounded-md p-1 ${roleTextColor}`}>
            {capitalizeFirstLetter(props.user?.role)}
          </span>
        )}
        {props.user.villageName && props.user.villageHexColor && (
          <span
            className="m-1 rounded-md p-1"
            style={{
              backgroundColor: props.user.villageHexColor,
              color: contrastingTextColor(props.user.villageHexColor),
            }}
          >
            {props.user.villageName}
          </span>
        )}
      </div>
    </div>
  );

  const content = (
    <>
      <div className="grow basis-1/2">
        <div className="flex h-full flex-col justify-center">
          {props.title && (
            <h3 className="basis-1/5 font-bold text-2xl tracking-tight">
              {props.title}
            </h3>
          )}
          {UsernameBlock}
          <div className="relative basis-3/4 font-normal">{props.children}</div>
        </div>
      </div>
      {props.options && <div className="absolute top-3 right-3">{props.options}</div>}
    </>
  );

  return (
    <div
      className={cn(
        `relative mb-3 flex flex-row rounded-lg border ${color} px-1 py-3 shadow`,
        props.align_middle ? "items-center" : "",
        props.hover_effect ? hover : "",
        props.className,
      )}
    >
      {props.image}
      {props.user && (
        <div className="mr-3 basis-2/12 truncate text-center sm:basis-3/12 sm:text-base">
          <Link href={`/username/${props.user.username}`}>
            <AvatarImage
              href={props.user.avatar}
              alt={props.user.username}
              size={100}
            />
          </Link>
          {props.user.nRecruited && props.user.nRecruited > 0 ? (
            <Link
              href={`/username/${props.user.username}`}
              className="font-bold text-xs hover:text-orange-500"
            >
              Recruits: {props.user.nRecruited}
            </Link>
          ) : undefined}
        </div>
      )}
      {props.href ? (
        <Link className="w-full hover:cursor-pointer" href={props.href}>
          {content}
        </Link>
      ) : (
        content
      )}
    </div>
  );
};

export default Post;

/** Username, title and role badge classes from a poster's support status, role and tavern colors. */
export const getPostUserClasses = (
  user: PostProps["user"],
  tavernStyling?: boolean,
) => {
  const roleStyle = user && user.role !== "USER" ? ROLE_STYLES[user.role] : undefined;
  let userColor =
    roleStyle?.name ??
    (user && FEDERAL_NAME_STYLES[user.federalStatus]) ??
    "text-popover-foreground";
  const userRole = roleStyle?.badge ?? "bg-slate-300";
  const roleTextColor = roleStyle?.badgeText ?? "";
  let titleColor = "bg-gray-500 text-white";

  if (user) {
    const tavernColors = resolveTavernColorClasses({
      tavernStyling: tavernStyling ?? false,
      role: user.role,
      usernamePreset: user.tavernUsernameColor ?? "DEFAULT",
      titlePreset: user.tavernTitleColor ?? "DEFAULT",
      baseUsernameClass: userColor,
      baseTitleClass: titleColor,
    });
    userColor = tavernColors.usernameClass;
    titleColor = tavernColors.titleClass;
  }
  return { userColor, userRole, roleTextColor, titleColor };
};

/** Supporter username gradients; staff role styles take precedence. */
const FEDERAL_NAME_STYLES: Partial<Record<FederalStatus, string>> = {
  NORMAL:
    "bg-linear-to-r from-sky-500 via-sky-300 to-sky-500 bg-clip-text text-transparent font-black",
  SILVER:
    "bg-linear-to-r from-gray-500 via-gray-400 to-gray-500 bg-clip-text text-transparent font-black",
  GOLD: "bg-linear-to-r from-amber-600 via-amber-400 to-amber-600 bg-clip-text text-transparent font-black",
};

/** Username gradient, badge background and badge text colour per staff role. */
const ROLE_STYLES: Record<
  Exclude<UserRole, "USER">,
  { name: string; badge: string; badgeText: "text-black" | "" }
> = {
  MODERATOR: {
    name: "bg-linear-to-r from-green-800 via-green-500 to-green-800 bg-clip-text text-transparent",
    badge: "bg-green-500",
    badgeText: "text-black",
  },
  JR_MODERATOR: {
    name: "bg-linear-to-r from-green-800 via-green-500 to-green-800 bg-clip-text text-transparent",
    badge: "bg-green-500",
    badgeText: "text-black",
  },
  HEAD_MODERATOR: {
    name: "bg-linear-to-r from-emerald-700 via-emerald-500 to-emerald-700 bg-clip-text text-transparent",
    badge: "bg-emerald-700",
    badgeText: "",
  },
  HEAD_EVENT: {
    name: "bg-linear-to-r from-pink-600 via-pink-500 to-pink-600 bg-clip-text text-transparent",
    badge: "bg-pink-600",
    badgeText: "text-black",
  },
  EVENT: {
    name: "bg-linear-to-r from-orange-600 via-orange-500 to-orange-600 bg-clip-text text-transparent",
    badge: "bg-orange-500",
    badgeText: "",
  },
  HEAD_CONTENT: {
    name: "bg-linear-to-r from-sky-600 via-sky-500 to-sky-600 bg-clip-text text-transparent",
    badge: "bg-sky-600",
    badgeText: "text-black",
  },
  HEAD_BALANCE: {
    name: "bg-linear-to-r from-sky-600 via-sky-500 to-sky-600 bg-clip-text text-transparent",
    badge: "bg-sky-600",
    badgeText: "text-black",
  },
  CONTENT: {
    name: "bg-linear-to-r from-purple-500 via-purple-400 to-purple-500 bg-clip-text text-transparent",
    badge: "bg-purple-400",
    badgeText: "",
  },
  BALANCE: {
    name: "bg-linear-to-r from-purple-500 via-purple-400 to-purple-500 bg-clip-text text-transparent",
    badge: "bg-purple-400",
    badgeText: "",
  },
  CODER: {
    name: "bg-linear-to-r from-pink-500 via-pink-300 to-pink-500 bg-clip-text text-transparent",
    badge: "bg-pink-300",
    badgeText: "text-black",
  },
  "CONTENT-ADMIN": {
    name: "bg-linear-to-r from-purple-500 via-purple-400 to-purple-500 bg-clip-text text-transparent",
    badge: "bg-purple-400",
    badgeText: "",
  },
  "EVENT-ADMIN": {
    name: "bg-linear-to-r from-rose-500 via-rose-300 to-rose-500 bg-clip-text text-transparent",
    badge: "bg-rose-300",
    badgeText: "text-black",
  },
  "MODERATOR-ADMIN": {
    name: "bg-linear-to-r from-red-500 via-red-400 to-red-500 bg-clip-text text-transparent",
    badge: "bg-red-400",
    badgeText: "",
  },
  "CODING-ADMIN": {
    name: "bg-linear-to-r from-red-500 via-red-400 to-red-500 bg-clip-text text-transparent",
    badge: "bg-red-400",
    badgeText: "",
  },
  OWNER: {
    name: "bg-linear-to-r from-red-500 via-red-400 to-red-500 bg-clip-text text-transparent",
    badge: "bg-red-400",
    badgeText: "",
  },
};
