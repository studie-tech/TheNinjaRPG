import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import HomeLanding from "@/layout/HomeLanding";
import * as Loader from "@/layout/Loader";
import * as Welcome from "@/layout/Welcome";
import type { UserWithRelations } from "@/routers/profile";
import * as UserContext from "@/utils/UserContext";
import { ensureDom } from "../setup/dom.mjs";

const push = vi.fn();
const referral = vi.fn();
let session: ReturnType<typeof UserContext.useUserData>;
const character = { userId: "player" } as NonNullable<UserWithRelations>;

beforeEach(() => {
  ensureDom();
  push.mockClear();
  referral.mockClear();
  session = { isClerkLoaded: true, isSignedIn: false, userId: undefined, data: undefined, status: "success" } as typeof session;
  vi.spyOn(UserContext, "useUserData").mockImplementation(() => session);
  vi.spyOn(clerk, "useClerk").mockReturnValue({ signOut: vi.fn() } as never);
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    register: { setReferralSource: { useMutation: () => ({ mutate: referral }) } },
    useUtils: () => ({ profile: { getUser: { invalidate: vi.fn(async () => {}) } } }),
  });
  vi.spyOn(Welcome, "default").mockImplementation(() => <p>Public welcome</p>);
  vi.spyOn(Loader, "default").mockImplementation(({ explanation }) => <p>{explanation}</p>);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("landing page session navigation", () => {
  it.each([undefined, character])("leaves a signed-out visitor on the welcome page with cached character %j", (cached) => {
    session = { ...session, data: cached };
    const view = render(<HomeLanding />);
    expect(view.getByText("Public welcome")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect(referral).not.toHaveBeenCalled();
  });

  it("stops forwarding immediately when the user signs out before cached data clears", () => {
    session = { ...session, isSignedIn: true, userId: "player", data: character };
    const view = render(<HomeLanding />);
    expect(push).toHaveBeenCalledWith("/profile");
    push.mockClear();
    session = { ...session, isSignedIn: false };
    view.rerender(<HomeLanding />);
    expect(view.getByText("Public welcome")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect(referral).not.toHaveBeenCalled();
  });

  it("waits for Clerk before using an initially signed-in character snapshot", () => {
    session = { ...session, isClerkLoaded: false, isSignedIn: true, userId: "player", data: character };
    render(<HomeLanding />);
    expect(push).not.toHaveBeenCalled();
  });

  it("forwards a confirmed signed-in account without a character to registration", () => {
    session = { ...session, isSignedIn: true, userId: "player" };
    render(<HomeLanding />);
    expect(push).toHaveBeenCalledWith("/register");
    expect(referral).toHaveBeenCalledTimes(1);
  });
});
