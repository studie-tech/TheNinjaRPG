import { describe, expect, it, mock, spyOn } from "bun:test";
import { drizzle } from "drizzle-orm/mysql-proxy";
import {
  deleteOrphanedReportEmbeddings,
  getRelatedReports,
  indexReportEmbeddings,
  supportsReportVectorSearch,
} from "@/libs/moderation/reportSearch";
import type { DrizzleClient } from "@/server/db";

const unavailableVector = () => new Error("FUNCTION tnr.DISTANCE does not exist");
const unavailableFulltext = () =>
  new Error("Can't find FULLTEXT index matching the column list");
const precedent = (id: string) => [
  id,
  "2026-01-01 00:00:00.000",
  "Threatening harassment",
  "reason",
  "{}",
  "OFFICIAL_WARNING",
  "comment",
  "OFFICIAL_WARNING",
  "Staff decision",
  0.9,
];

const database = (
  run: (query: string, params: unknown[]) => unknown[][] | Promise<unknown[][]>,
) => {
  const queries: string[] = [];
  const client = drizzle(async (query, params) => {
    queries.push(query);
    return { rows: await run(query, params) };
  }) as unknown as DrizzleClient;
  return { client, queries };
};

describe("moderation report search capabilities", () => {
  it("uses vector results before full-text and sends vectors as parameters", async () => {
    const { client, queries } = database((query, params) => {
      if (query.includes("from `UserReportEmbedding`")) return [];
      expect(query).toContain("DISTANCE");
      expect(query).toContain("`sourceText` = `UserReport`.`aiInterpretation`");
      expect(params).toContain("[1,0]");
      return [precedent("semantic-match")];
    });
    const embed = mock(async () => [[1, 0]]);
    const reports = await getRelatedReports(client, "Threats", { embed });
    expect(reports.map((report) => report.id)).toEqual(["semantic-match"]);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(queries.some((query) => query.includes("MATCH("))).toBe(false);
  });

  it("falls back during embedding backfill and caches unsupported full-text", async () => {
    const { client, queries } = database((query) => {
      if (query.includes("DISTANCE")) return [];
      if (query.includes("MATCH(")) throw unavailableFulltext();
      return [precedent("literal-match")];
    });
    const embed = mock(async () => [[1, 0]]);
    expect((await getRelatedReports(client, "Threats", { embed }))[0]?.id).toBe(
      "literal-match",
    );
    await getRelatedReports(client, "Threats", { embed });
    expect(queries.filter((query) => query.includes("MATCH("))).toHaveLength(1);
  });

  it("does not call the embedding API for an unsupported database", async () => {
    const { client, queries } = database((query) => {
      if (query.includes("DISTANCE"))
        throw new Error("Drizzle failed query", { cause: unavailableVector() });
      return [precedent("fulltext-match")];
    });
    const embed = mock(async () => [[1, 0]]);
    expect((await getRelatedReports(client, "Threats", { embed }))[0]?.id).toBe(
      "fulltext-match",
    );
    await indexReportEmbeddings(client, embed);
    expect(embed).not.toHaveBeenCalled();
    expect(queries.filter((query) => query.includes("DISTANCE"))).toHaveLength(1);
  });

  it("rechecks missing capabilities after the cache expires", async () => {
    let now = 1000;
    let supported = false;
    const time = spyOn(Date, "now").mockImplementation(() => now);
    try {
      const { client, queries } = database(() => {
        if (!supported) throw unavailableVector();
        return [];
      });
      expect(await supportsReportVectorSearch(client)).toBe(false);
      supported = true;
      expect(await supportsReportVectorSearch(client)).toBe(false);
      now += 5 * 60 * 1000;
      expect(await supportsReportVectorSearch(client)).toBe(true);
      expect(queries).toHaveLength(2);
    } finally {
      time.mockRestore();
    }
  });

  it("uses text search when the embedding provider fails", async () => {
    const { client } = database((query) =>
      query.includes("DISTANCE") ? [] : [precedent("fulltext-match")],
    );
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const reports = await getRelatedReports(client, "Threats", {
        embed: async () => {
          throw new Error("provider timeout");
        },
      });
      expect(reports[0]?.id).toBe("fulltext-match");
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it("surfaces database outages and does not cache them as unsupported", async () => {
    const { client, queries } = database(() => {
      throw new Error("connection timeout");
    });
    await expect(getRelatedReports(client, "Threats")).rejects.toMatchObject({
      cause: { message: "connection timeout" },
    });
    await expect(getRelatedReports(client, "Threats")).rejects.toMatchObject({
      cause: { message: "connection timeout" },
    });
    expect(queries).toHaveLength(2);
  });

  it("does not treat a full-text permission failure as a missing index", async () => {
    const { client } = database((query) => {
      if (query.includes("DISTANCE")) throw unavailableVector();
      throw new Error("SELECT command denied");
    });
    await expect(getRelatedReports(client, "Threats")).rejects.toMatchObject({
      cause: { message: "SELECT command denied" },
    });
  });

  it("avoids database and provider calls for empty summaries", async () => {
    const { client, queries } = database(() => []);
    const embed = mock(async () => [[1, 0]]);
    expect(await getRelatedReports(client, "  ", { embed })).toEqual([]);
    expect(queries).toHaveLength(0);
    expect(embed).not.toHaveBeenCalled();
  });

  it("falls back when the vector functions are unavailable", async () => {
    const { client } = database((query) => {
      if (query.includes("DISTANCE"))
        throw new Error("FUNCTION tnr.DISTANCE does not exist");
      return [precedent("fulltext-match")];
    });
    const embed = mock(async () => [[1, 0]]);
    expect((await getRelatedReports(client, "Threats", { embed }))[0]?.id).toBe(
      "fulltext-match",
    );
    expect(embed).not.toHaveBeenCalled();
  });

  it("does not mistake user text in a failed query for a capability error", async () => {
    const { client } = database(() => {
      throw new Error("Failed query: params: vector not supported, errno 1191", {
        cause: new Error("connection timeout"),
      });
    });
    await expect(getRelatedReports(client, "Threats")).rejects.toMatchObject({
      cause: { cause: { message: "connection timeout" } },
    });
  });

  it("backfills summaries in one embedding batch and upserts their source and model", async () => {
    const { client, queries } = database((query, params) => {
      if (query.includes("DISTANCE")) return [];
      if (query.startsWith("select")) {
        expect(query).toContain("left join `UserReportEmbedding`");
        expect(query).toContain("`sourceText` <> `UserReport`.`aiInterpretation`");
        return [
          ["first", "Harassment"],
          ["second", "Threats"],
        ];
      }
      expect(query).toContain("TO_VECTOR(?)");
      expect(query).toContain("on duplicate key update");
      expect(query).toContain("from `UserReport` where");
      expect(params).toContain("text-embedding-3-small");
      expect(params.some((param) => param === "[1,0]" || param === "[0,1]")).toBe(true);
      return [[{ insertId: 0, affectedRows: 1 }]];
    });
    const embed = mock(async () => [
      [1, 0],
      [0, 1],
    ]);
    await indexReportEmbeddings(client, embed);
    expect(embed).toHaveBeenCalledWith(["Harassment", "Threats"]);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(queries.filter((query) => query.startsWith("insert"))).toHaveLength(2);
    expect(queries.some((query) => query.startsWith("delete"))).toBe(false);
  });

  it("skips orphan deletion when the plain ID scan finds nothing", async () => {
    const { client, queries } = database(() => []);
    await deleteOrphanedReportEmbeddings(client);
    expect(queries).toHaveLength(2);
    expect(queries[1]).toContain("select `reportId` from `UserReportEmbedding`");
    expect(queries[1]).toContain("not exists");
    expect(queries.some((query) => /delete|for update/i.test(query))).toBe(false);
  });

  it("restricts orphan deletion to scanned IDs and rechecks parent existence", async () => {
    const { client, queries } = database((query, params) => {
      if (query.includes("DISTANCE")) return [];
      if (query.startsWith("select")) return [["orphan-a"], ["orphan-b"]];
      expect(query).toContain("`UserReportEmbedding`.`reportId` in (?, ?)");
      expect(query).toContain("not exists (select `id` from `UserReport`");
      expect(query).toContain("`UserReport`.`id` = `UserReportEmbedding`.`reportId`");
      expect(params).toEqual(["orphan-a", "orphan-b"]);
      return [[{ affectedRows: 1 }]];
    });
    await deleteOrphanedReportEmbeddings(client);
    expect(queries).toHaveLength(3);
  });

  it("skips orphan cleanup when vectors or their table are unavailable", async () => {
    const { client, queries } = database(() => {
      throw unavailableVector();
    });
    await deleteOrphanedReportEmbeddings(client);
    expect(queries).toHaveLength(1);
  });
});
