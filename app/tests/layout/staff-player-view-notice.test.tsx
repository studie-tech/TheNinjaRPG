import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { StaffPlayerViewNotice } from "@/layout/StaffPlayerViewNotice";
import * as routing from "@/utils/routing";
import { mockUserContextValue } from "../setup/userContext";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const notice = (
  user: { role: string; playsAsPlayer: boolean },
  path = "/manual/jutsu",
) => {
  vi.spyOn(routing, "usePublicPathname").mockReturnValue(path);
  mockUserContextValue({ data: user } as never);
  return render(<StaffPlayerViewNotice />).queryByRole("status")?.textContent ?? null;
};

it("tells staff playing as a regular player why manual pages hide unreleased content", () => {
  expect(notice({ role: "CONTENT", playsAsPlayer: true })).toBe(
    "You are playing as a regular player, so unreleased content is hidden here. Switch it off under Staff tools to see or edit it.",
  );
  expect(screen.getByRole("link", { name: "Staff tools" }).getAttribute("href")).toBe(
    "/manual#staff-tools",
  );
});

it("stays hidden for staff using their role, for players, and beside the switch itself", () => {
  expect(notice({ role: "CONTENT", playsAsPlayer: false })).toBeNull();
  expect(notice({ role: "USER", playsAsPlayer: true })).toBeNull();
  expect(notice({ role: "CONTENT", playsAsPlayer: true }, "/manual")).toBeNull();
});
