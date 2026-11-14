import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import Staff from "@/app/[shell]/manual/staff/page";
import * as Avatar from "@/layout/Avatar";
import * as Confirm from "@/layout/Confirm";
import * as ContentBox from "@/layout/ContentBox";
import { mockUserContextValue } from "../../setup/userContext";

const listQuery = vi.fn((_input: unknown, _options?: { enabled?: boolean }) => ({
  data: undefined,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(Avatar, "default").mockImplementation(() => null);
  vi.spyOn(Confirm, "default").mockImplementation(() => null);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ applications: { list: { invalidate: vi.fn() } } }),
    profile: {
      getPublicUsers: { useQuery: () => ({ data: { data: [] } }) },
    },
    applications: {
      list: { useQuery: listQuery },
      create: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("does not list applications for a session without a character", () => {
  mockUserContextValue({ data: undefined });
  render(<Staff />);
  expect(listQuery).toHaveBeenCalled();
  expect(listQuery.mock.calls.every(([, options]) => options?.enabled === false)).toBe(
    true,
  );
});

it("lists the player's own applications once the character is loaded", () => {
  mockUserContextValue({
    data: { userId: "player", role: "USER", isBanned: false, isSilenced: false },
  } as never);
  render(<Staff />);
  expect(listQuery).toHaveBeenCalledWith(
    { onlyMine: true },
    expect.objectContaining({ enabled: true }),
  );
});
