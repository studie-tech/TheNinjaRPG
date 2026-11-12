import { afterEach, describe, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  type FederalStatus,
  FederalStatuses,
  type UserRole,
  UserRoles,
} from "@/drizzle/constants";
import * as Avatar from "@/layout/Avatar";
import Post, { getPostUserClasses, type PostProps } from "@/layout/Post";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const poster = (
  role: UserRole,
  federalStatus: FederalStatus = "NONE",
): NonNullable<PostProps["user"]> => ({
  userId: "poster",
  username: "Poster",
  avatar: null,
  level: 50,
  rank: "JONIN",
  isOutlaw: false,
  role,
  federalStatus,
});

const sky =
  "bg-linear-to-r from-sky-500 via-sky-300 to-sky-500 bg-clip-text text-transparent font-black";
const silver =
  "bg-linear-to-r from-gray-500 via-gray-400 to-gray-500 bg-clip-text text-transparent font-black";
const gold =
  "bg-linear-to-r from-amber-600 via-amber-400 to-amber-600 bg-clip-text text-transparent font-black";
const federalName: Record<FederalStatus, string> = {
  NONE: "text-popover-foreground",
  NORMAL: sky,
  SILVER: silver,
  GOLD: gold,
};
const gradient = (from: string, via: string) =>
  `bg-linear-to-r from-${from} via-${via} to-${from} bg-clip-text text-transparent`;
const roleStyles: Record<
  Exclude<UserRole, "USER">,
  { name: string; badge: string; darkText: boolean }
> = {
  OWNER: { name: gradient("red-500", "red-400"), badge: "bg-red-400", darkText: false },
  "CODING-ADMIN": {
    name: gradient("red-500", "red-400"),
    badge: "bg-red-400",
    darkText: false,
  },
  "CONTENT-ADMIN": {
    name: gradient("purple-500", "purple-400"),
    badge: "bg-purple-400",
    darkText: false,
  },
  "EVENT-ADMIN": {
    name: gradient("rose-500", "rose-300"),
    badge: "bg-rose-300",
    darkText: true,
  },
  "MODERATOR-ADMIN": {
    name: gradient("red-500", "red-400"),
    badge: "bg-red-400",
    darkText: false,
  },
  HEAD_MODERATOR: {
    name: gradient("emerald-700", "emerald-500"),
    badge: "bg-emerald-700",
    darkText: false,
  },
  MODERATOR: {
    name: gradient("green-800", "green-500"),
    badge: "bg-green-500",
    darkText: true,
  },
  JR_MODERATOR: {
    name: gradient("green-800", "green-500"),
    badge: "bg-green-500",
    darkText: true,
  },
  HEAD_CONTENT: {
    name: gradient("sky-600", "sky-500"),
    badge: "bg-sky-600",
    darkText: true,
  },
  HEAD_BALANCE: {
    name: gradient("sky-600", "sky-500"),
    badge: "bg-sky-600",
    darkText: true,
  },
  CONTENT: {
    name: gradient("purple-500", "purple-400"),
    badge: "bg-purple-400",
    darkText: false,
  },
  BALANCE: {
    name: gradient("purple-500", "purple-400"),
    badge: "bg-purple-400",
    darkText: false,
  },
  HEAD_EVENT: {
    name: gradient("pink-600", "pink-500"),
    badge: "bg-pink-600",
    darkText: true,
  },
  EVENT: {
    name: gradient("orange-600", "orange-500"),
    badge: "bg-orange-500",
    darkText: false,
  },
  CODER: {
    name: gradient("pink-500", "pink-300"),
    badge: "bg-pink-300",
    darkText: true,
  },
};

describe("post username and role styling", () => {
  it("gives every role a name and badge style that overrides the federal style", () => {
    for (const role of UserRoles) {
      for (const federalStatus of FederalStatuses) {
        const expected = role === "USER" ? undefined : roleStyles[role];
        expect(getPostUserClasses(poster(role, federalStatus))).toEqual(
          expect.objectContaining({
            userColor: expected?.name ?? federalName[federalStatus],
            userRole: expected?.badge ?? "bg-slate-300",
            titleColor: "bg-gray-500 text-white",
          }),
        );
      }
    }
  });

  it("uses the default classes without a poster", () => {
    expect(getPostUserClasses(undefined)).toEqual(
      expect.objectContaining({
        userColor: "text-popover-foreground",
        userRole: "bg-slate-300",
        titleColor: "bg-gray-500 text-white",
      }),
    );
  });

  it("renders the role badge with dark text on light role colours only", () => {
    vi.spyOn(Avatar, "default").mockImplementation(() => null);
    for (const role of UserRoles) {
      const view = render(<Post user={poster(role, "GOLD")}>Body</Post>);
      const badge = view.queryByText(role.charAt(0) + role.slice(1).toLowerCase());
      if (role === "USER") {
        expect(badge).toBeNull();
      } else {
        const style = roleStyles[role];
        expect(badge?.className).toBe(
          `${style.badge} rounded-md p-1 ${style.darkText ? "text-black" : ""}`,
        );
        expect(view.getByText("Poster").className).toBe(`${style.name} font-bold`);
      }
      cleanup();
    }
  });

  it("labels a village leader as Kage or Daimyo", () => {
    vi.spyOn(Avatar, "default").mockImplementation(() => null);
    const leader = { ...poster("USER"), villageKageId: "poster" };
    const kage = render(<Post user={leader}>Body</Post>);
    expect(kage.getByText("Kage").className).toBe(
      "rounded-md bg-slate-300 p-1 text-black",
    );
    expect(kage.queryByText("Daimyo")).toBeNull();
    cleanup();
    const daimyo = render(<Post user={{ ...leader, isOutlaw: true }}>Body</Post>);
    expect(daimyo.getByText("Daimyo").className).toBe(
      "rounded-md bg-slate-300 p-1 text-black",
    );
    expect(daimyo.queryByText("Kage")).toBeNull();
  });
});
