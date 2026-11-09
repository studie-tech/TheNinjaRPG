import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import * as ContentBox from "@/layout/ContentBox";
import { ClanMembers } from "@/layout/clan/ClanMembers";
import * as Modal from "@/layout/Modal";
import * as Table from "@/layout/Table";
import * as UserContext from "@/utils/UserContext";

const member = (userId: string, username: string) => ({
  userId,
  username,
  rank: "JONIN",
  level: 50,
  avatar: null,
  pvpExperience: 0,
  isOutlaw: false,
  anbuId: null,
  federalStatus: "NONE",
});

beforeEach(() => {
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ children, topRightContent }) => (
      <div>
        {topRightContent}
        {children}
      </div>
    ),
  );
  const mutation = { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) };
  const clanData = {
    id: "clan",
    leaderId: "leader",
    coLeader1: null,
    coLeader2: null,
    coLeader3: null,
    assassin1: "assassin",
    assassin2: null,
    assassin3: null,
    members: [
      member("leader", "Leader"),
      member("assassin", "Shade"),
      member("plain", "Plain"),
    ],
  };
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    clan: {
      get: { useQuery: () => ({ data: clanData, dataUpdatedAt: 1 }) },
      kickMember: mutation,
      promoteMember: mutation,
      demoteMember: mutation,
    },
  });
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(
    () =>
      ({
        data: { userId: "leader", role: "USER", isOutlaw: false },
        updateUser: vi.fn(),
        prepareUserUpdate: vi.fn(),
      }) as never,
  );
  vi.spyOn(Table, "default").mockImplementation((({
    data,
  }: {
    data: { userId: string; actions: ReactNode }[];
  }) => (
    <div>
      {data.map((row) => (
        <div key={row.userId}>{row.actions}</div>
      ))}
    </div>
  )) as never);
  vi.spyOn(Modal, "default").mockImplementation(({ isOpen, title, setIsOpen }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button type="button" onClick={() => setIsOpen(false)}>
          Close
        </button>
      </div>
    ) : null,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([
  ["Kick Plain", "Kick Plain?"],
  ["Promote Plain", "Promote Plain?"],
  ["Demote Shade", "Demote Shade?"],
])("closing the %s confirmation clears its target", (trigger, title) => {
  const view = render(<ClanMembers userId="leader" clanId="clan" />);
  fireEvent.click(view.getByRole("button", { name: trigger }));
  expect(view.getByRole("dialog", { name: title })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Close" }));
  expect(view.queryByRole("dialog")).toBeNull();
});
