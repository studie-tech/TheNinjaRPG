import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import * as client from "@/app/_trpc/client";
import * as CombatActions from "@/layout/CombatActions";
import * as ContentBox from "@/layout/ContentBox";
import * as Image from "@/layout/Image";
import * as Modal from "@/layout/Modal";
import { BadgesTab } from "@/layout/publicUser/BadgesTab";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

const insert = vi.fn(async () => ({ success: true, message: "Added" }));
const remove = vi.fn(async () => ({ success: true, message: "Removed" }));
const invalidate = vi.fn(async () => undefined);
const createdAt = new Date("2026-01-01T00:00:00Z");
const currentBadges = [
  {
    userId: "target",
    badgeId: "old",
    createdAt,
    badge: { id: "old", name: "Old Badge", image: "/old.webp" },
  },
] as unknown as ComponentProps<typeof BadgesTab>["currentBadges"];

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ children, topRightContent }) => (
      <div>
        {topRightContent}
        {children}
      </div>
    ),
  );
  insert.mockClear();
  remove.mockClear();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      profile: { getPublicUser: { invalidate } },
      logs: { getContentChanges: { invalidate } },
    }),
    badge: {
      getAllNames: {
        useQuery: () => ({
          data: [{ id: "new", name: "New Badge", image: "/new.webp" }],
        }),
      },
    },
    staff: {
      insertUserBadge: { useMutation: () => ({ mutateAsync: insert }) },
      removeUserBadge: { useMutation: () => ({ mutateAsync: remove }) },
    },
  });
  vi.spyOn(UserContext, "useUserData").mockImplementation(
    () => ({ data: { role: "OWNER" } }) as never,
  );
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(Image, "default").mockImplementation((({ alt }: { alt: string }) => (
    <img alt={alt} />
  )) as never);
  vi.spyOn(CombatActions, "ActionSelector").mockImplementation((({
    items,
    onClick,
  }: {
    items: { id: string; name: string }[];
    onClick: (id: string) => void;
  }) => (
    <div>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => onClick(item.id)}>
          Pick {item.name}
        </button>
      ))}
    </div>
  )) as never);
  vi.spyOn(Modal, "default").mockImplementation(
    ({ isOpen, title, onAccept, setIsOpen }) =>
      isOpen ? (
        <div role="dialog" aria-label={title}>
          <button type="button" onClick={(event) => onAccept?.(event as never)}>
            Proceed
          </button>
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
  restoreBrowserGlobals();
});

const mount = () =>
  render(<BadgesTab userId="target" username="Target" currentBadges={currentBadges} />);

it.each([
  { role: "USER", canViewStatistics: false },
  { role: "guest", canViewStatistics: false },
  { role: "OWNER", canViewStatistics: true },
])(
  "shows badge statistics according to the viewer's role ($role)",
  ({ role, canViewStatistics }) => {
    vi.spyOn(UserContext, "useUserData").mockReturnValue({
      data: role === "guest" ? undefined : { role },
    } as never);
    const view = mount();
    expect(view.getByAltText("Old Badge")).toBeTruthy();
    expect(
      !!view.queryByRole("button", { name: "View statistics for Old Badge" }),
    ).toBe(canViewStatistics);
  },
);

it("opens and dismisses the badge assignment confirmation", async () => {
  const view = mount();
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: /New/ }));
  fireEvent.click(await view.findByRole("button", { name: "Pick New Badge" }));
  expect(view.getByRole("dialog", { name: "Add badge" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Close" }));
  expect(view.queryByRole("dialog")).toBeNull();
});

it("closes the assignment confirmation once the badge is added", async () => {
  const view = mount();
  fireEvent.click(view.getByRole("button", { name: /New/ }));
  fireEvent.click(await view.findByRole("button", { name: "Pick New Badge" }));
  fireEvent.click(view.getByRole("button", { name: "Proceed" }));
  await waitFor(() =>
    expect(insert).toHaveBeenCalledWith({ userId: "target", badgeId: "new" }),
  );
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(view.getByAltText("New Badge")).toBeTruthy();
});

it("opens, dismisses and completes the badge removal confirmation", async () => {
  const view = mount();
  fireEvent.click(view.getByRole("button", { name: "Remove Old Badge from Target" }));
  expect(view.getByRole("dialog", { name: "Remove badge" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Close" }));
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Remove Old Badge from Target" }));
  fireEvent.click(view.getByRole("button", { name: "Proceed" }));
  await waitFor(() =>
    expect(remove).toHaveBeenCalledWith({ userId: "target", badgeId: "old" }),
  );
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(view.queryByAltText("Old Badge")).toBeNull();
});
