import React from "react";
import AvatarImage from "@/layout/Avatar";
import Link from "next/link";
import { showUserRank } from "@/libs/profile";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import type { UserRank, UserRole, FederalStatus } from "@/drizzle/constants";
import { cn } from "src/libs/shadui";

export interface PostProps {
  user?: {
    userId: string;
    username: string;
    avatar: string | null;
    level: number;
    rank: UserRank;
    isOutlaw: boolean;
    role: UserRole;
    customTitle?: string | null;
    villageKageId?: string | null;
    villageName?: string | null;
    villageHexColor?: string | null;
    nRecruited?: number | null;
    federalStatus: FederalStatus;
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
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const Post: React.FC<PostProps> = (props) => {
  let userColor = "text-popover-foreground";
  let userRole = "bg-slate-300";
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

  switch (props.user?.federalStatus) {
    case "NORMAL":
      userColor =
        "bg-linear-to-r from-sky-500 via-sky-300 to-sky-500 bg-clip-text text-transparent font-black";
      break;
    case "SILVER":
      userColor =
        "bg-linear-to-r from-gray-500 via-gray-400 to-gray-500 bg-clip-text text-transparent font-black";
      break;
    case "GOLD":
      userColor =
        "bg-linear-to-r from-amber-600 via-amber-400 to-amber-600 bg-clip-text text-transparent font-black";
      break;
  }

  switch (props.user?.role) {
    case "MODERATOR":
    case "JR_MODERATOR":
      userColor =
        "bg-linear-to-r from-green-800 via-green-500 to-green-800 bg-clip-text text-transparent";
      userRole = "bg-green-500";
      break;
    case "HEAD_MODERATOR":
      userColor =
        "bg-linear-to-r from-emerald-700 via-emerald-500 to-emerald-700 bg-clip-text text-transparent";
      userRole = "bg-emerald-700";
      break;
    case "EVENT":
      userColor =
        "bg-linear-to-r from-orange-600 via-orange-500 to-orange-600 bg-clip-text text-transparent";
      userRole = "bg-orange-500";
      break;
    case "CONTENT":
      userColor =
        "bg-linear-to-r from-purple-500 via-purple-400 to-purple-500 bg-clip-text text-transparent";
      userRole = "bg-purple-400";
      break;
    case "CODER":
      userColor =
        "bg-linear-to-r from-pink-500 via-pink-300 to-pink-500 bg-clip-text text-transparent";
      userRole = "bg-pink-300";
      break;
    case "CONTENT-ADMIN":
      userColor =
        "bg-linear-to-r from-purple-500 via-purple-400 to-purple-500 bg-clip-text text-transparent";
      userRole = "bg-purple-400";
      break;
    case "EVENT-ADMIN":
      userColor =
        "bg-linear-to-r from-rose-500 via-rose-300 to-rose-500 bg-clip-text text-transparent";
      userRole = "bg-rose-300";
      break;
    case "MODERATOR-ADMIN":
      userColor =
        "bg-linear-to-r from-red-500 via-red-400 to-red-500 bg-clip-text text-transparent";
      userRole = "bg-red-400";
      break;
    case "CODING-ADMIN":
      userColor =
        "bg-linear-to-r from-red-500 via-red-400 to-red-500 bg-clip-text text-transparent";
      userRole = "bg-red-400";
      break;
  }

  // Blocks
  const UsernameBlock = props.user && (
    <div className="basis-1/4">
      <div className={`${userColor} font-bold`}>{props.user.username}</div>
      <div className="text-xs pt-1 pb-4">
        <span className="bg-slate-300 p-1 m-1 rounded-md text-black">
          Lvl. {props.user.level}
        </span>
        <span className="bg-slate-300 p-1 m-1 rounded-md text-black">
          {showUserRank(props.user)}
        </span>
        {props.user.customTitle && (
          <span className="bg-gray-500 p-1 m-1 rounded-md text-white">
            {props.user.customTitle}
          </span>
        )}
        {props.user.villageKageId && props.user.villageKageId === props.user.userId && (
          <>
            {props.user?.isOutlaw ? (
              <span className="bg-slate-300 p-1 m-1 rounded-md text-black">Daimyo</span>
            ) : (
              <span className="bg-slate-300 p-1 m-1 rounded-md text-black">Kage</span>
            )}
          </>
        )}
        {props.user?.role !== "USER" && (
          <span
            className={`${userRole} p-1 m-1 rounded-md ${
              ["CODER", "MODERATOR", "JR_MODERATOR", "EVENT-ADMIN"].includes(props.user.role)
                ? "text-black"
                : ""
            }`}
          >
            {capitalizeFirstLetter(props.user?.role)}
          </span>
        )}
        {props.user.villageName && props.user.villageHexColor && (
          <span
            className={`p-1 m-1 rounded-md ${
              ["glacier", "shine", "shroud"].includes(
                props.user.villageName.toLowerCase(),
              )
                ? "text-black"
                : "text-white"
            }`}
            style={{ backgroundColor: props.user.villageHexColor }}
          >
            {props.user.villageName}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        `relative mb-3 flex flex-row rounded-lg border ${color} px-1 py-3 shadow`,
        props.align_middle ? "items-center" : "",
        props.hover_effect ? hover : "",
        props.className,
      )}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
    >
      {props.image}
      {props.user && (
        <div className="... mr-3 basis-2/12 truncate text-center sm:basis-3/12 sm:text-base">
          <Link href={`/username/${props.user.username}`}>
            <AvatarImage
              href={props.user.avatar}
              userId={props.user.userId}
              alt={props.user.username}
              size={100}
            />
          </Link>
          {props.user.nRecruited && props.user.nRecruited > 0 ? (
            <Link
              href={`/username/${props.user.username}`}
              className="font-bold hover:text-orange-500 text-xs"
            >
              Recruits: {props.user.nRecruited}
            </Link>
          ) : undefined}
        </div>
      )}
      <div className="grow basis-1/2">
        <div className="flex flex-col h-full justify-center">
          {props.title && (
            <h3 className="text-2xl font-bold tracking-tight basis-1/5">
              {props.title}
            </h3>
          )}
          {UsernameBlock}
          <div className="relative font-normal basis-3/4 ">{props.children}</div>
        </div>
      </div>
      {props.options && <div className="absolute right-3 top-3">{props.options}</div>}
    </div>
  );
};

export default Post;
