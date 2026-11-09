import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import ReportStatistics from "@/app/[shell]/reports/statistics/page";
import * as Avatar from "@/layout/Avatar";
import * as ContentBox from "@/layout/ContentBox";
import * as UserContext from "@/utils/UserContext";

let query: { data: unknown; isFetching: boolean };
const refetch = vi.fn(async () => undefined);
const useQuery = vi.fn((_input: unknown, _options: { enabled: boolean }) => ({
  ...query,
  refetch,
}));

beforeEach(() => {
  vi.clearAllMocks();
  query = { data: undefined, isFetching: false };
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(Avatar, "default").mockImplementation(() => null);
  vi.spyOn(ContentBox, "default").mockImplementation(
    ({ title, subtitle, children }) => (
      <section aria-label={`${title}: ${subtitle}`}>{children}</section>
    ),
  );
  Object.assign(vi.spyOn(client, "api" as never), {
    reports: { getReportStatistics: { useQuery } },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const signIn = (role: string) =>
  vi
    .spyOn(UserContext, "useRequiredUserData")
    .mockReturnValue({ data: { userId: "u", role } } as never);

it("tells players the statistics are staff-only instead of loading forever", () => {
  signIn("USER");
  const view = render(<ReportStatistics />);
  expect(useQuery.mock.calls[0]?.[1].enabled).toBe(false);
  expect(view.getByText("Only staff can view report statistics.")).toBeDefined();
  expect(view.queryByText("No access")).toBeNull();
});

it("offers a retry when the staff statistics could not be loaded", () => {
  signIn("MODERATOR");
  const view = render(<ReportStatistics />);
  expect(useQuery.mock.calls[0]?.[1].enabled).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  expect(refetch).toHaveBeenCalledTimes(1);
});

it("shows the staff overview once the statistics load", () => {
  signIn("MODERATOR");
  query = {
    isFetching: false,
    data: {
      staff: [{ userId: "mod", username: "Mod", avatar: null }],
      timesReported: [{ userId: "mod", count: 2 }],
      timesReporting: [],
      decisions: [{ userId: "mod", decision: "BAN_ACTIVATED", count: 1 }],
    },
  };
  const view = render(<ReportStatistics />);
  expect(view.getByRole("region", { name: "Reports: Overview" })).toBeDefined();
  expect(view.getByText("Mod")).toBeDefined();
});
