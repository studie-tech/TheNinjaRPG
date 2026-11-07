import { describe, expect, it } from "bun:test";
import { buildGroupedBarData } from "@/layout/GroupedBarHistogram";

describe("buildGroupedBarData", () => {
  it("zero-fills each group over the sorted distinct x values", () => {
    const { labels, datasets } = buildGroupedBarData([
      { group: "A", x: 5, y: 1 },
      { group: "B", x: 2, y: 2 },
      { group: "A", x: 2, y: 3 },
    ]);
    expect(labels).toEqual([2, 5]);
    expect(datasets.map(({ label, data }) => ({ label, data }))).toEqual([
      { label: "A", data: [3, 1] },
      { label: "B", data: [2, 0] },
    ]);
  });

  it("colors groups in order, with a translucent fill, wrapping past the palette", () => {
    const { datasets } = buildGroupedBarData(
      Array.from({ length: 11 }, (_, index) => ({ group: `${index}`, x: 1, y: 1 })),
    );
    expect(datasets[0]).toMatchObject({
      backgroundColor: "#3e95cd80",
      borderColor: "#3e95cd",
      borderWidth: 1,
    });
    expect(datasets[10]?.borderColor).toBe("#3e95cd");
  });

  it("keeps the first point of a duplicated x", () => {
    const { datasets } = buildGroupedBarData([
      { group: "A", x: 1, y: 4 },
      { group: "A", x: 1, y: 9 },
    ]);
    expect(datasets[0]?.data).toEqual([4]);
  });
});
