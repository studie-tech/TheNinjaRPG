import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as client from "@/app/_trpc/client";
import ManualBloodlineCompleteness from "@/app/[shell]/manual/bloodline/completeness/page";
import { MIN_CONTENT_DESCRIPTION_LENGTH } from "@/drizzle/constants";
import * as ContentDetails from "@/hooks/useContentDetails";
import * as Charts from "@/layout/ContentCompletenessCharts";
import * as Links from "@/layout/ContentLinksCell";
import * as UserContext from "@/utils/UserContext";

const description = "x".repeat(MIN_CONTENT_DESCRIPTION_LENGTH);
const bloodline = (name: string, overrides: object = {}) => ({
  id: name,
  name,
  rank: "D",
  statClassification: "Highest",
  effects: [{ type: "damage" }],
  description,
  ...overrides,
});

beforeEach(() => {
  Object.assign(vi.spyOn(client, "api" as never), {
    bloodline: {
      getAll: {
        useQuery: () => ({
          isPending: false,
          data: {
            data: [
              bloodline("Complete"),
              bloodline("Short", { description: "" }),
              bloodline("Bare", { description: "", effects: [] }),
            ],
          },
        }),
      },
    },
  });
  vi.spyOn(ContentDetails, "useContentDetails").mockReturnValue({} as never);
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: undefined } as never);
  vi.spyOn(Links, "ContentLinksCell").mockImplementation(() => null);
  vi.spyOn(Charts, "ContentCompletenessPanel").mockImplementation(({ incomplete }) => (
    <div>{incomplete}</div>
  ));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("bloodline completeness", () => {
  it("lists only incomplete bloodlines, worst first, with a Total column", () => {
    render(
      <AppRouterContext.Provider value={{} as never}>
        <ManualBloodlineCompleteness />
      </AppRouterContext.Provider>,
    );
    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers.at(-1)).toBe("Total");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual(
      ["Bare", "Short"],
    );
    expect(
      rows.map((row) => within(row).getAllByRole("cell").at(-1)?.textContent),
    ).toEqual(["2", "1"]);
  });
});
