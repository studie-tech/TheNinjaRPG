import { expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/mysql-proxy";
import * as schema from "@/drizzle/schema";
import { commentsRouter } from "@/routers/comments";
import type { DrizzleClient } from "@/server/db";
import { overrideQuery } from "../../../setup/statements";
import { callerForDatabase } from "../../../setup/testDatabase";

it.each([
  ["%", "%\\%%"],
  ["_", "%\\_%"],
  ["\\", "%\\\\%"],
  ["50%_\\Path", "%50\\%\\_\\\\Path%"],
  [" Gate ", "% Gate %"],
])(
  "searches message content and usernames literally for %j",
  async (searchQuery, pattern) => {
    const query = await searchStatement(searchQuery);
    expect(query.sql).toContain(
      "(`ConversationComment`.`content` like ? or `UserData`.`username` like ?)",
    );
    expect(query.params.slice(-4)).toEqual([pattern, pattern, 10, 20]);
    expect(query.sql).toContain("order by `ConversationComment`.`createdAt` desc");
  },
);

it.each([undefined, "", "  "])(
  "does not filter blank search %j",
  async (searchQuery) => {
    const query = await searchStatement(searchQuery);
    expect(query.sql).not.toContain(" like ");
    expect(query.params.slice(-2)).toEqual([10, 20]);
  },
);

/** Capture the endpoint's real search statement while supplying authorized reader fixtures. */
const searchStatement = async (searchQuery: string | undefined) => {
  const queries: { sql: string; params: unknown[] }[] = [];
  const db = drizzle(
    async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
    { schema },
  ) as unknown as DrizzleClient;
  const client = overrideQuery(
    overrideQuery(db, "userData", {
      findFirst: async () => ({ userId: "reader", role: "USER" }),
    }),
    "conversation",
    {
      findFirst: async () => ({ id: "chat", isPublic: true, users: [] }),
    },
  );
  await callerForDatabase(commentsRouter, "reader", client).getConversationComments({
    convo_id: "chat",
    searchQuery,
    cursor: 2,
    limit: 10,
  });
  const query = queries.find(({ sql }) => sql.includes("from `ConversationComment`"));
  expect(query).toBeDefined();
  return query!;
};
