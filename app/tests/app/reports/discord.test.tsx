import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import DiscordLinksStaffPage from "@/app/[shell]/reports/discord/page";
import * as ContentBox from "@/layout/ContentBox";
import { mockUserContextValue } from "../../setup/userContext";

const linkedAt = new Date("2026-03-04T12:00:00Z");
const unlinkedAt = new Date("2026-05-06T12:00:00Z");

beforeEach(() => {
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  mockUserContextValue({ data: { userId: "mod", role: "MODERATOR" } });
  Object.assign(vi.spyOn(client, "api" as never), {
    discord: {
      getStatus: { useQuery: () => ({ data: { enabled: true } }) },
      searchLinks: {
        useQuery: () => ({
          isFetching: false,
          data: {
            links: [],
            history: [
              {
                id: "history-1",
                userId: "user-1",
                username: "Ninja",
                discordId: "123456789",
                discordUsername: "ninja#1",
                linkedAt,
                unlinkedAt,
                reason: "Unlinked by staff",
                cooldownWaived: true,
              },
            ],
          },
        }),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("lists ended links with their character, Discord account, dates and reason", () => {
  const view = render(<DiscordLinksStaffPage />);
  expect(view.getByText("Link history (1)")).toBeDefined();
  const table = view.getByRole("table");
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent),
  ).toEqual(["Character", "Discord", "Linked", "Unlinked", "Reason"]);
  const cells = within(table)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
  expect(cells).toEqual([
    "Ninja",
    "ninja#1123456789",
    linkedAt.toLocaleDateString(),
    unlinkedAt.toLocaleDateString(),
    "Unlinked by staff (cooldown waived)",
  ]);
});
