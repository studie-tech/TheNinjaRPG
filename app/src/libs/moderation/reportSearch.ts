import { and, exists, like, ne, notExists, sql } from "drizzle-orm";
import OpenAI from "openai";
import {
  OPENAI_REPORT_EMBEDDING_MODEL,
  REPORT_EMBEDDING_DIMENSIONS,
} from "@/drizzle/constants";
import { userReport, userReportEmbedding } from "@/drizzle/schema";
import {
  deleteUserReportEmbeddingForDeleteOrphanedReportEmbeddings,
  deleteUserReportEmbeddingForDeleteUserReportEmbeddings,
  insertUserReportEmbeddingForIndexReportEmbeddings,
  selectUserReportCommentForEligibleReports,
  selectUserReportEmbeddingForDeleteOrphanedReportEmbeddings,
  selectUserReportEmbeddingForSupportsReportVectorSearch,
  selectUserReportForDeleteOrphanedReportEmbeddings,
  selectUserReportForGetRelatedReports,
  selectUserReportForGetRelatedReports2,
  selectUserReportForGetRelatedReports3,
  selectUserReportForIndexReportEmbeddings,
} from "@/queries/reports";
import type { DrizzleClient } from "@/server/db";
import { chunkArray } from "@/utils/array";

const capabilityTtl = 5 * 60 * 1000;
const vectorCapabilities = new WeakMap<
  DrizzleClient,
  { expiresAt: number; supported: Promise<boolean> }
>();
const fulltextUnavailableUntil = new WeakMap<DrizzleClient, number>();

const eligibleReports = (client: DrizzleClient) =>
  and(
    ne(userReport.aiInterpretation, ""),
    sql`JSON_LENGTH(${userReport.additionalContext}) > 0`,
    ne(userReport.system, "user_profile"),
    ne(userReport.status, "UNVIEWED"),
    exists(selectUserReportCommentForEligibleReports(client)),
  );

/** Cache only explicit feature misses. Outages and permission failures must surface. */
const isFeatureUnavailable = (error: unknown, feature: "vector" | "fulltext") => {
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    // Drizzle's wrapper includes query parameters, which are user content and
    // must not be mistaken for the driver's feature diagnostic.
    if (current.cause instanceof Error) {
      current = current.cause;
      continue;
    }
    const sqlMessage = (current as { sqlMessage?: unknown }).sqlMessage;
    const message = typeof sqlMessage === "string" ? sqlMessage : current.message;
    if (feature === "fulltext") {
      if (
        /Can't find FULLTEXT index matching the column list|errno 1191|ER_FT_MATCHING_KEY_NOT_FOUND/i.test(
          message,
        )
      )
        return true;
    } else if (
      /FUNCTION\s+\S*\b(?:DISTANCE|TO_VECTOR)\b.*does not exist/i.test(message) ||
      /(?:unsupported|not supported|not enabled|disabled).*\b(?:vector|distance)\b|\b(?:vector|distance)\b.*(?:unsupported|not supported|not enabled|disabled)/i.test(
        message,
      )
    )
      return true;
    current = current.cause;
  }
  return false;
};

/** Cache vector capability probes per client while allowing transient failures to retry. */
export const supportsReportVectorSearch = async (client: DrizzleClient) => {
  const cached = vectorCapabilities.get(client);
  if (cached && cached.expiresAt > Date.now()) return cached.supported;
  const supported = (async () => {
    try {
      // Probe the vector functions before calling the embedding API.
      await selectUserReportEmbeddingForSupportsReportVectorSearch(client);
      return true;
    } catch (error) {
      if (isFeatureUnavailable(error, "vector")) return false;
      vectorCapabilities.delete(client);
      throw error;
    }
  })();
  vectorCapabilities.set(client, { expiresAt: Date.now() + capabilityTtl, supported });
  return supported;
};

export const generateReportEmbeddings = async (
  texts: string[],
): Promise<number[][]> => {
  const response = await new OpenAI({
    timeout: 10_000,
    maxRetries: 0,
  }).embeddings.create({
    model: OPENAI_REPORT_EMBEDDING_MODEL,
    dimensions: REPORT_EMBEDDING_DIMENSIONS,
    input: texts,
  });
  return texts.map((_, index) => {
    const embedding = response.data.find((row) => row.index === index)?.embedding;
    if (
      !embedding ||
      embedding.length !== REPORT_EMBEDDING_DIMENSIONS ||
      embedding.some((value) => !Number.isFinite(value))
    ) {
      throw new Error("Invalid moderation report embeddings");
    }
    return embedding;
  });
};

type EmbedReports = typeof generateReportEmbeddings;

/** Remove the stored summaries before their reports disappear during account cleanup. */
export const deleteUserReportEmbeddings = async (
  client: DrizzleClient,
  userId: string,
) => {
  await deleteUserReportEmbeddingForDeleteUserReportEmbeddings(client, userId);
};

/** Prefer semantic matches, then full-text ranking, then literal word matches. */
export const getRelatedReports = async (
  client: DrizzleClient,
  aiInterpretation: string,
  options: { excludeReportId?: string; embed?: EmbedReports } = {},
) => {
  const text = aiInterpretation.trim();
  if (!text) return [];
  const eligible = and(
    eligibleReports(client),
    options.excludeReportId ? ne(userReport.id, options.excludeReportId) : undefined,
  );
  const embed = options.embed ?? generateReportEmbeddings;
  if (await supportsReportVectorSearch(client)) {
    // An unavailable embedding provider must not take down report retrieval.
    let embedding: number[] | undefined;
    try {
      [embedding] = await embed([text]);
    } catch (error) {
      console.error(
        "Could not embed moderation report search; using text search",
        error,
      );
    }
    if (embedding) {
      const distance = sql<number>`DISTANCE(${userReportEmbedding.embedding}, TO_VECTOR(${JSON.stringify(embedding)}), 'cosine')`;
      try {
        const reports = await selectUserReportForGetRelatedReports(
          client,
          distance,
          eligible,
        );
        if (reports.length > 0) return reports;
      } catch (error) {
        if (!isFeatureUnavailable(error, "vector")) throw error;
        vectorCapabilities.set(client, {
          expiresAt: Date.now() + capabilityTtl,
          supported: Promise.resolve(false),
        });
      }
    }
  }

  if ((fulltextUnavailableUntil.get(client) ?? 0) <= Date.now()) {
    const score =
      sql<number>`MATCH(${userReport.aiInterpretation}) AGAINST(${text})`.mapWith(
        Number,
      );
    try {
      return await selectUserReportForGetRelatedReports2(client, score, eligible);
    } catch (error) {
      if (!isFeatureUnavailable(error, "fulltext")) throw error;
      fulltextUnavailableUntil.set(client, Date.now() + capabilityTtl);
    }
  }

  // Tokenizing strips SQL wildcard characters and avoids requiring an exact summary.
  const words = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((word) => word.length >= 3)
    .slice(0, 25);
  if (words.length === 0) return [];
  const matches = words.map((word) => like(userReport.aiInterpretation, `%${word}%`));
  const score = sql<number>`(${sql.join(
    matches.map((match) => sql`CASE WHEN ${match} THEN 1 ELSE 0 END`),
    sql` + `,
  )})`.mapWith(Number);
  return selectUserReportForGetRelatedReports3(client, score, eligible, matches);
};

/** Daily backstop for reports deleted while an embedding request was in flight. */
export const deleteOrphanedReportEmbeddings = async (client: DrizzleClient) => {
  if (!(await supportsReportVectorSearch(client))) return;
  const hasNoReport = notExists(
    selectUserReportForDeleteOrphanedReportEmbeddings(client),
  );
  // Scan only IDs in a plain read, then restrict the locking delete to those IDs.
  const orphans = await selectUserReportEmbeddingForDeleteOrphanedReportEmbeddings(
    client,
    hasNoReport,
  );
  if (orphans.length === 0) return;
  for (const batch of chunkArray(orphans, 500)) {
    await deleteUserReportEmbeddingForDeleteOrphanedReportEmbeddings(
      client,
      batch,
      hasNoReport,
    );
  }
};

/** Backfill only resolved precedents; local Community MySQL skips API calls. */
export const indexReportEmbeddings = async (
  client: DrizzleClient,
  embed: EmbedReports = generateReportEmbeddings,
) => {
  if (!(await supportsReportVectorSearch(client))) return;
  const reports = await selectUserReportForIndexReportEmbeddings(
    client,
    eligibleReports(client),
  );
  if (reports.length === 0) return;
  const embeddings = await embed(reports.map((report) => report.text));
  await Promise.all(
    reports.map((report, index) => {
      const embedding = sql`TO_VECTOR(${JSON.stringify(embeddings[index])})`;
      return insertUserReportEmbeddingForIndexReportEmbeddings(
        client,
        embedding,
        report,
      );
    }),
  );
};
