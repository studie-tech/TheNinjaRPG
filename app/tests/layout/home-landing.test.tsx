import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs";
import { cleanup, render } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import HomeLanding from "@/layout/HomeLanding";
import * as Loader from "@/layout/Loader";
import * as Welcome from "@/layout/Welcome";
import type { UserWithRelations } from "@/routers/profile";
import type * as UserContext from "@/utils/UserContext";
import { mockUserContextValue } from "../setup/userContext";

const replace = vi.fn();
const referral = vi.fn();
let session: ReturnType<typeof UserContext.useUserData>;
const character = { userId: "player" } as NonNullable<UserWithRelations>;

beforeEach(() => {
  replace.mockReset();
  referral.mockReset();
  session = {
    isClerkLoaded: true,
    isSignedIn: false,
    userId: undefined,
    data: undefined,
    status: "success",
  } as typeof session;
  mockUserContextValue(() => session);
  vi.spyOn(clerk, "useClerk").mockReturnValue({ signOut: vi.fn() } as never);
  vi.spyOn(navigation, "useRouter").mockReturnValue({
    replace,
    prefetch: vi.fn(),
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    register: { setReferralSource: { useMutation: () => ({ mutate: referral }) } },
    useUtils: () => ({ profile: { getUser: { invalidate: vi.fn(async () => {}) } } }),
  });
  vi.spyOn(Welcome, "default").mockImplementation(() => <p>Public welcome</p>);
  vi.spyOn(Loader, "default").mockImplementation(({ explanation }) => (
    <p>{explanation}</p>
  ));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  delete window.Cookiebot;
});

describe("landing page session navigation", () => {
  it.each([undefined, character])(
    "leaves a signed-out visitor on the welcome page with cached character %j",
    (cached) => {
      session = { ...session, data: cached };
      const view = render(<HomeLanding />);
      expect(view.getByText("Public welcome")).toBeTruthy();
      expect(replace).not.toHaveBeenCalled();
      expect(referral).not.toHaveBeenCalled();
    },
  );

  it("stops forwarding immediately when the user signs out before cached data clears", () => {
    session = { ...session, isSignedIn: true, userId: "player", data: character };
    const view = render(<HomeLanding />);
    expect(replace).toHaveBeenCalledWith("/profile");
    replace.mockClear();
    session = { ...session, isSignedIn: false };
    view.rerender(<HomeLanding />);
    expect(view.getByText("Public welcome")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    expect(referral).not.toHaveBeenCalled();
  });

  it("waits for Clerk before using an initially signed-in character snapshot", () => {
    session = {
      ...session,
      isClerkLoaded: false,
      isSignedIn: true,
      userId: "player",
      data: character,
    };
    render(<HomeLanding />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("forwards a confirmed signed-in account without a character to registration", () => {
    session = { ...session, isSignedIn: true, userId: "player" };
    render(<HomeLanding />);
    expect(replace).toHaveBeenCalledWith("/register");
    expect(referral).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "captures the landing referral before registration with statistics consent %j",
    (statistics) => {
      session = { ...session, isSignedIn: true, userId: "player" };
      window.Cookiebot = { consent: { statistics }, hasResponse: true };
      window.localStorage.setItem("ref", "EarlierRecruiter");
      window.history.replaceState(null, "", "/?ref=Recruiter&utm_source=legacy");
      referral.mockImplementationOnce((input) => {
        expect(input).toEqual({ utmSource: statistics ? "legacy" : undefined });
        expect(window.localStorage.getItem("ref")).toBe("Recruiter");
      });
      replace.mockImplementationOnce((path) => {
        expect(path).toBe("/register");
        expect(window.localStorage.getItem("ref")).toBe("Recruiter");
        expect(window.localStorage.getItem("utm_source")).toBe(
          statistics ? "legacy" : null,
        );
      });
      render(<HomeLanding />);
      expect(referral).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps an earlier recruiter when the landing URL has no referral", () => {
    session = { ...session, isSignedIn: true, userId: "player" };
    window.localStorage.setItem("ref", "EarlierRecruiter");
    render(<HomeLanding />);
    expect(replace).toHaveBeenCalledWith("/register");
    expect(window.localStorage.getItem("ref")).toBe("EarlierRecruiter");
  });
});
