import { beforeEach, expect, it, mock } from "bun:test";
import { and, asc, eq, ne, type SQL, sql } from "drizzle-orm";
import {
  OPENAI_REPORT_EMBEDDING_MODEL,
  REPORT_EMBEDDING_DIMENSIONS,
} from "@/drizzle/constants";
import { userReport, userReportComment, userReportEmbedding } from "@/drizzle/schema";
import {
  deleteOrphanedReportEmbeddings,
  getRelatedReports,
  indexReportEmbeddings,
} from "@/libs/moderation/reportSearch";
import {
  describeWithDatabase,
  getTestDatabase,
  indexColumns,
  resetTables,
  runRawSql,
} from "../../setup/testDatabase";

const reportRow = (
  id: string,
  patch: Partial<typeof userReport.$inferInsert> = {},
) => ({
  id,
  system: "comment",
  infraction: {},
  reason: "Report reason",
  aiInterpretation: "Targeted harassment and threats",
  status: "OFFICIAL_WARNING" as const,
  additionalContext: [
    {
      userId: "user",
      username: "Player",
      avatar: "",
      content: "message",
      level: 1,
      rank: "GENIN" as const,
      federalStatus: "NONE" as const,
      isOutlaw: false,
      role: "USER" as const,
      createdAt: new Date("2026-01-01"),
    },
  ],
  ...patch,
});

// Tests that wrap the cached test client in an empty Proxy give it a new identity, so
// reportSearch's per-client capability caches (WeakMaps keyed by client) start empty.
describeWithDatabase("moderation retrieval against Community MySQL", () => {
  beforeEach(async () => {
    await resetTables(userReportEmbedding, userReportComment, userReport);
  });

  it("indexes exactly the summary predicate and tracks every source-field update", async () => {
    const client = await getTestDatabase();
    const context = reportRow("context").additionalContext;
    await client.insert(userReport).values([
      reportRow("eligible-old", {
        aiInterpretation: "",
        createdAt: new Date("2026-01-01"),
      }),
      reportRow("eligible-new", {
        aiInterpretation: "",
        createdAt: new Date("2026-02-01"),
        status: "UNVIEWED",
      }),
      reportRow("summarized"),
      reportRow("empty-context", { aiInterpretation: "", additionalContext: [] }),
      reportRow("profile", { aiInterpretation: "", system: "user_profile" }),
    ]);
    const indexed = () =>
      client
        .select({ id: userReport.id })
        .from(userReport)
        .where(eq(userReport.needsAiSummary, true))
        .orderBy(asc(userReport.createdAt));
    const original = () =>
      client
        .select({ id: userReport.id })
        .from(userReport)
        .where(
          and(
            eq(userReport.aiInterpretation, ""),
            sql`JSON_LENGTH(${userReport.additionalContext}) > 0`,
            ne(userReport.system, "user_profile"),
          ),
        )
        .orderBy(asc(userReport.createdAt));
    expect(await indexed()).toEqual(await original());
    expect((await indexed()).map(({ id }) => id)).toEqual([
      "eligible-old",
      "eligible-new",
    ]);

    await client
      .update(userReport)
      .set({ aiInterpretation: "Summary" })
      .where(eq(userReport.id, "eligible-old"));
    await client
      .update(userReport)
      .set({ additionalContext: context })
      .where(eq(userReport.id, "empty-context"));
    await client
      .update(userReport)
      .set({ system: "comment" })
      .where(eq(userReport.id, "profile"));
    await client
      .update(userReport)
      .set({ aiInterpretation: "" })
      .where(eq(userReport.id, "summarized"));
    await client
      .update(userReport)
      .set({ additionalContext: [] })
      .where(eq(userReport.id, "eligible-new"));
    expect(await indexed()).toEqual(await original());
    expect((await indexed()).map(({ id }) => id).sort()).toEqual([
      "empty-context",
      "profile",
      "summarized",
    ]);
    expect(
      (await indexColumns("UserReport", "UserReport_needsAiSummary_createdAt_idx"))
        .columns,
    ).toEqual(["needsAiSummary", "createdAt"]);
  });

  it("deletes only orphans and preserves a parent restored between scan and delete", async () => {
    const client = await getTestDatabase();
    const embedding = sql`TO_VECTOR(${JSON.stringify(Array(REPORT_EMBEDDING_DIMENSIONS).fill(0))})`;
    await client.insert(userReport).values(reportRow("live"));
    await client.insert(userReportEmbedding).values(
      ["live", "orphan", "restored"].map((reportId) => ({
        reportId,
        sourceText: "Summary",
        model: OPENAI_REPORT_EMBEDDING_MODEL,
        embedding,
      })),
    );
    const realSelect = client.select.bind(client);
    const cleanupClient = new Proxy(client, {
      get(target, key, receiver) {
        // Community MySQL has the vector type but not PlanetScale's DISTANCE.
        if (key === "select")
          return (fields: Record<string, unknown>) =>
            "distance" in fields
              ? { from: () => ({ limit: async () => [] }) }
              : realSelect(fields as never);
        if (key === "delete")
          return () => ({
            where: async (condition: SQL) => {
              await client.insert(userReport).values(reportRow("restored"));
              return client.delete(userReportEmbedding).where(condition);
            },
          });
        return Reflect.get(target, key, receiver);
      },
    });
    await deleteOrphanedReportEmbeddings(cleanupClient);
    const remaining = await client
      .select({ reportId: userReportEmbedding.reportId })
      .from(userReportEmbedding);
    expect(remaining.map(({ reportId }) => reportId).sort()).toEqual([
      "live",
      "restored",
    ]);
  });

  it("ranks literal matches, filters ineligible reports and returns one latest comment", async () => {
    const client = new Proxy(await getTestDatabase(), {});
    await client
      .insert(userReport)
      .values([
        reportRow("closest"),
        reportRow("partial", { aiInterpretation: "Playful threats" }),
        reportRow("unviewed", { status: "UNVIEWED" }),
        reportRow("profile", { system: "user_profile" }),
        reportRow("no-context", { additionalContext: [] }),
        reportRow("no-comment"),
        reportRow("unrelated", { aiInterpretation: "Trade agreement" }),
      ]);
    await client.insert(userReportComment).values([
      ...["closest", "partial", "unviewed", "profile", "no-context", "unrelated"].map(
        (id) => ({
          id: `${id}-comment`,
          reportId: id,
          userId: "staff",
          content: "Decision",
          decision: "OFFICIAL_WARNING" as const,
          createdAt: new Date("2026-01-01"),
        }),
      ),
      {
        id: "latest",
        reportId: "closest",
        userId: "staff",
        content: "Latest staff decision",
        decision: "OFFICIAL_WARNING" as const,
        createdAt: new Date("2026-02-01"),
      },
    ]);
    await client.insert(userReportComment).values({
      id: "player-reply",
      reportId: "closest",
      userId: "player",
      content: "Player reply",
      createdAt: new Date("2026-03-01"),
    });
    const embed = mock(async () => [[1, 0]]);
    const reports = await getRelatedReports(client, "harassment threats", { embed });
    expect(reports.map((report) => report.id)).toEqual(["closest", "partial"]);
    expect(reports[0]?.comment).toBe("Latest staff decision");
    expect(reports[0]?.score).toBe(2);
    expect(
      (
        await getRelatedReports(client, "harassment threats", {
          excludeReportId: "closest",
          embed,
        })
      ).map((report) => report.id),
    ).toEqual(["partial"]);
    expect(embed).not.toHaveBeenCalled();
    await indexReportEmbeddings(client, embed);
    expect(embed).not.toHaveBeenCalled();
    expect(await client.select().from(userReportEmbedding)).toEqual([]);
  });

  it("uses full-text search when that index is available", async () => {
    await runRawSql(
      "ALTER TABLE UserReport ADD FULLTEXT INDEX report_search_test (aiInterpretation)",
    );
    try {
      const client = new Proxy(await getTestDatabase(), {});
      await client
        .insert(userReport)
        .values([
          reportRow("fulltext"),
          reportRow("other", { aiInterpretation: "Trade agreement" }),
        ]);
      await client.insert(userReportComment).values({
        id: "comment",
        reportId: "fulltext",
        userId: "staff",
        content: "Decision",
        decision: "OFFICIAL_WARNING",
      });
      const reports = await getRelatedReports(client, "harassment");
      expect(reports.map((report) => report.id)).toEqual(["fulltext"]);
      expect(reports[0]?.score).toBeGreaterThan(0);
    } finally {
      await runRawSql("ALTER TABLE UserReport DROP INDEX report_search_test");
    }
  });

  it("does not turn punctuation or SQL wildcards into a match-all search", async () => {
    const client = new Proxy(await getTestDatabase(), {});
    await client.insert(userReport).values(reportRow("report"));
    await client.insert(userReportComment).values({
      id: "comment",
      reportId: "report",
      userId: "staff",
      content: "Decision",
      decision: "OFFICIAL_WARNING",
    });
    expect(await getRelatedReports(client, "% _ '")).toEqual([]);
  });

  it("stores and reads a native vector with the expected dimension and byte length", async () => {
    const client = await getTestDatabase();
    const values = Array.from({ length: REPORT_EMBEDDING_DIMENSIONS }, (_, index) =>
      index === 0 ? 1 : 0,
    );
    await client.insert(userReportEmbedding).values({
      reportId: "vector",
      sourceText: "Threats",
      model: OPENAI_REPORT_EMBEDDING_MODEL,
      embedding: sql`TO_VECTOR(${JSON.stringify(values)})`,
    });
    const [row] = await client
      .select({
        dimensions: sql<number>`VECTOR_DIM(${userReportEmbedding.embedding})`,
        embedding: userReportEmbedding.embedding,
      })
      .from(userReportEmbedding);
    expect(row?.dimensions).toBe(REPORT_EMBEDDING_DIMENSIONS);
    expect(row?.embedding.byteLength).toBe(REPORT_EMBEDDING_DIMENSIONS * 4);
    expect(new Float32Array(row?.embedding ?? new ArrayBuffer(0))[0]).toBe(1);
  });
});
