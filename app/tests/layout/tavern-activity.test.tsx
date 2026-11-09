import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as tavernActivity from "@/hooks/useTavernActivity";
import { TavernActivity } from "@/layout/TavernActivity";
import * as context from "@/utils/UserContext";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("follows the taverns of the signed-in player on the live connection", () => {
  const pusher = { id: "connection" };
  const userData = { userId: "me" };
  vi.spyOn(context, "useUserData").mockReturnValue({ data: userData, pusher } as never);
  const follow = vi
    .spyOn(tavernActivity, "useTavernActivity")
    .mockImplementation(() => {});
  render(<TavernActivity />);
  expect(follow).toHaveBeenCalledWith(pusher, userData);
});
