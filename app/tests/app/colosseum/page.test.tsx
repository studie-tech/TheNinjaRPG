import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import ColosseumPage from "@/app/[shell]/colosseum/page";
import * as Avatar from "@/layout/Avatar";
import * as ContentBox from "@/layout/ContentBox";

const push = vi.fn();

beforeEach(() => {
  push.mockClear();
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push } as never);
  vi.spyOn(Avatar, "default").mockImplementation(() => null);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  Object.assign(vi.spyOn(client, "api" as never), {
    combat: {
      listOngoingBattles: {
        useQuery: () => ({
          isLoading: false,
          data: [
            {
              id: "battle-1",
              battleType: "RANKED_PVP",
              createdAt: new Date(),
              users: [{ userId: "a", username: "Alpha", avatar: null }],
            },
          ],
        }),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens a spectated battle log with client-side navigation", () => {
  const view = render(<ColosseumPage />);
  expect(view.getByText("Alpha")).toBeDefined();
  fireEvent.click(view.getByRole("button", { name: "Spectate" }));
  expect(push).toHaveBeenCalledWith("/battlelog/battle-1");
});
