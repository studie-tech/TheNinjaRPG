import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as ContentBox from "@/layout/ContentBox";
import * as PublicUser from "@/layout/PublicUser";
import { LazyPublicUser } from "@/layout/publicUser/LazyPublicUser";
import * as UserContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

const profileQuery = vi.fn(() => ({ data: undefined, isPending: true }));

beforeEach(() => {
  installBrowserGlobals();
  profileQuery.mockClear();
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: { getPublicUser: { useQuery: profileQuery } },
  });
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ isSignedIn: true } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ children, title, subtitle }) => (
      <section aria-label={String(title)}>
        <p>{subtitle}</p>
        {children}
      </section>
    ),
  );
  vi.spyOn(PublicUser, "default").mockImplementation((({
    title,
  }: {
    title: string;
  }) => <p>{title} profile</p>) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("starts the profile query and shows the skeleton until the profile chunk loads", async () => {
  render(<LazyPublicUser userId="sensei" title="Your Sensei" initialBreak />);
  expect(screen.getByRole("region", { name: "Your Sensei" })).toBeDefined();
  expect(screen.getByText("Loading profile")).toBeDefined();
  expect(profileQuery).toHaveBeenCalledWith({ userId: "sensei" }, { enabled: true });
  // React throttles Suspense reveals, so the loaded card can take a few hundred ms.
  expect(
    await screen.findByText("Your Sensei profile", {}, { timeout: 3000 }),
  ).toBeDefined();
});
