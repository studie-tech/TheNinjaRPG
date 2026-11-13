import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { clearNewsNotifications } from "@/deltas/forum";
import { useMarkNewsRead } from "@/hooks/useMarkNewsRead";
import type { NavBarDropdownLink } from "@/libs/menus";
import * as UserContext from "@/utils/UserContext";
import { mockUserContextValue } from "../setup/userContext";

const news: NavBarDropdownLink = {
  href: "/news",
  name: "3 news",
  notificationCount: 3,
};
const inbox: NavBarDropdownLink = {
  href: "/inbox",
  name: "Inbox",
  notificationCount: 1,
};

const setup = (notifications: NavBarDropdownLink[]) => {
  const updateNotifications = vi.fn(async (_update: unknown) => undefined);
  const mutate = vi.fn(
    (
      _input: undefined,
      options: { onSuccess: (result: { success: boolean }) => void },
    ) => options.onSuccess({ success: true }),
  );
  mockUserContextValue({
    data: { userId: "player" },
    notifications,
    updateNotifications,
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    forum: { readNews: { useMutation: () => ({ mutate }) } },
  });
  return { mutate, updateNotifications };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("marks unread news read once and drops only the News badge", () => {
  const { mutate, updateNotifications } = setup([news, inbox]);
  const view = renderHook(() => useMarkNewsRead());
  view.rerender();
  expect(mutate).toHaveBeenCalledTimes(1);
  const update = updateNotifications.mock.calls[0]?.[0] as (
    current: (typeof news)[],
  ) => (typeof news)[];
  expect(update([news, inbox])).toEqual([inbox]);
});

it("sends nothing when there is no unread news", () => {
  const { mutate } = setup([inbox]);
  renderHook(() => useMarkNewsRead());
  expect(mutate).not.toHaveBeenCalled();
});

it("leaves an absent notification list untouched", () => {
  expect(clearNewsNotifications(undefined)).toBeUndefined();
});
