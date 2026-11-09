import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { Chart } from "chart.js";
import * as chartLibrary from "chart.js/auto";
import * as client from "@/app/_trpc/client";
import * as ContentBox from "@/layout/ContentBox";
import * as RankedRankDistributionFiltering from "@/layout/RankedRankDistributionFiltering";
import { RankedRankDistributionHistogram } from "@/layout/RankedRankDistributionHistogram";

type Bars = { labels: string[]; datasets: { borderColor: string[] }[] };
let configs: { data: Bars }[];
let distribution: { rank: string; count: number }[];

beforeEach(() => {
  configs = [];
  const chartConstructor = vi.spyOn(chartLibrary, "Chart").mockImplementation(((
    _ctx: unknown,
    config: { data: Bars },
  ) => {
    configs.push(config);
    return { destroy: vi.fn() } as unknown as Chart;
  }) as never);
  Object.assign(chartConstructor, { defaults: { ...chartLibrary.Chart.defaults } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({}) as never,
  );
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(RankedRankDistributionFiltering, "default").mockImplementation(() => null);
  vi.spyOn(RankedRankDistributionFiltering, "useFiltering").mockReturnValue(
    {} as never,
  );
  vi.spyOn(RankedRankDistributionFiltering, "getFilter").mockReturnValue({} as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    data: {
      getRankedRankDistributionStatistics: {
        useQuery: () => ({ data: distribution }),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const colorsByRank = async () => {
  render(<RankedRankDistributionHistogram />);
  await waitFor(() => expect(configs).toHaveLength(1));
  const { labels, datasets } = configs[0]!.data;
  cleanup();
  configs = [];
  return Object.fromEntries(
    labels.map((rank, i) => [rank, datasets[0]!.borderColor[i]]),
  );
};

it("keeps each rank's bar color when another rank has no players", async () => {
  distribution = ["Wood", "Adept", "Master", "Legend", "Sannin"].map((rank) => ({
    rank,
    count: 2,
  }));
  const full = await colorsByRank();
  distribution = [
    { rank: "Adept", count: 3 },
    { rank: "Legend", count: 1 },
  ];
  const partial = await colorsByRank();
  expect(new Set(Object.values(full)).size).toBe(5);
  expect(partial).toEqual({ Adept: full.Adept, Legend: full.Legend });
});
