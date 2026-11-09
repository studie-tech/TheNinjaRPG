import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import mysql from "mysql2/promise";
import { describeWithDatabase } from "../setup/testDatabase";

it("loads the complete forum upgrade through the migration journal", () => {
  const migration = readFileSync(
    new URL("../../drizzle/migrations/0124_flashy_mac_gargan.sql", import.meta.url),
    "utf8",
  );
  const migrations = readMigrationFiles({
    migrationsFolder: fileURLToPath(
      new URL("../../drizzle/migrations", import.meta.url),
    ),
  });
  expect(
    migrations.filter(({ sql }) => sql.join("\n").includes(migration)),
  ).toHaveLength(1);
});

/** Exercise the deployed SQL, including its data backfill, rather than only a schema push. */
describeWithDatabase("forum structure migration", () => {
  it("preserves grouped and multilingual boards, counts, activity and news policy", async () => {
    const connection = await mysql.createConnection({
      uri: process.env.TEST_MYSQL_URL,
      multipleStatements: true,
    });
    const tables = [
      "UserData",
      "ForumBoard",
      "ForumThread",
      "ForumPost",
      "ForumAlert",
      "ForumAudit",
      "ForumGrant",
      "ForumReaction",
      "ForumRead",
      "ForumRestriction",
      "ForumRevision",
      "ForumSection",
      "ForumWatch",
    ];
    const prefix = `ForumMigration_${randomBytes(4).toString("hex")}_`;
    const rename = (sql: string) =>
      sql.replace(
        new RegExp(`\\b(${tables.join("|")})\\b`, "g"),
        (table) => `${prefix}${table}`,
      );
    try {
      await connection.query(
        rename(`
        CREATE TABLE UserData(userId varchar(191) PRIMARY KEY, avatar3d varchar(191));
        CREATE TABLE ForumBoard(id varchar(191) PRIMARY KEY, name varchar(191) NOT NULL, summary text NOT NULL, \`group\` varchar(191) NOT NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), nPosts int NOT NULL DEFAULT 0, nThreads int NOT NULL DEFAULT 0, UNIQUE INDEX ForumBoard_name_key(name));
        CREATE TABLE ForumThread(id varchar(191) PRIMARY KEY, title varchar(191) NOT NULL, image varchar(512), createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), boardId varchar(191) NOT NULL, userId varchar(191) NOT NULL, nPosts int NOT NULL DEFAULT 0, isPinned boolean NOT NULL DEFAULT false, isLocked boolean NOT NULL DEFAULT false, INDEX ForumThread_boardId_idx(boardId), INDEX ForumThread_userId_idx(userId));
        CREATE TABLE ForumPost(id varchar(191) PRIMARY KEY, content text NOT NULL, createdAt datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), userId varchar(191) NOT NULL, threadId varchar(191) NOT NULL, authorId varchar(191) NOT NULL, isReported boolean NOT NULL DEFAULT false, INDEX ForumPost_threadId_idx(threadId), INDEX ForumPost_userId_idx(userId));
        INSERT INTO ForumBoard(id,name,summary,\`group\`) VALUES ('news','News','Updates','Main Broadcast:General boards for TNR'),('questions','Questions & Answers','Help','Main Broadcast:General boards for TNR'),('jp','日本語','Stories','忍者:物語');
        INSERT INTO ForumThread(id,title,boardId,userId) VALUES('topic','Question topic','questions','author');
        INSERT INTO ForumPost(id,content,userId,authorId,threadId,createdAt) VALUES('opening','Opening','author','author','topic','2026-01-01 00:00:00.000'),('answer','Answer','author','author','topic','2026-01-02 00:00:00.000');
      `),
      );
      for (const name of ["0122_woozy_valkyrie.sql", "0124_flashy_mac_gargan.sql"])
        await connection.query(
          rename(
            readFileSync(
              new URL(`../../drizzle/migrations/${name}`, import.meta.url),
              "utf8",
            ),
          ),
        );
      const [userColumns] = await connection.query<mysql.RowDataPacket[]>(
        rename("SHOW COLUMNS FROM UserData"),
      );
      expect(userColumns.map((c) => c.Field)).toEqual(["userId"]);
      const [sections] = await connection.query<mysql.RowDataPacket[]>(
        rename("SELECT * FROM ForumSection"),
      );
      expect(sections.map((s) => s.name).sort()).toEqual(["Main Broadcast", "忍者"]);
      expect(sections.find((s) => s.name === "忍者")?.summary).toBe("物語");
      const [boards] = await connection.query<mysql.RowDataPacket[]>(
        rename("SELECT * FROM ForumBoard"),
      );
      expect(boards.find((b) => b.id === "news")?.sectionId).toBe(
        boards.find((b) => b.id === "questions")?.sectionId,
      );
      const newsPolicy = boards.find((b) => b.id === "news")?.policy;
      expect(
        typeof newsPolicy === "string" ? JSON.parse(newsPolicy) : newsPolicy,
      ).toEqual({ create: "STAFF" });
      expect(boards.find((b) => b.id === "questions")).toMatchObject({
        nPosts: 2,
        nThreads: 1,
      });
      const [topics] = await connection.query<mysql.RowDataPacket[]>(
        rename("SELECT * FROM ForumThread"),
      );
      expect(topics[0]).toMatchObject({
        nPosts: 2,
        kind: "QUESTION",
        lastPostId: "answer",
        pollId: null,
        summary: null,
        summaryUpdatedAt: null,
      });
      const [posts] = await connection.query<mysql.RowDataPacket[]>(
        rename("SELECT publicationIntent FROM ForumPost"),
      );
      expect(posts.map((p) => p.publicationIntent)).toEqual([null, null]);
      const [alertIndexes] = await connection.query<mysql.RowDataPacket[]>(
        rename("SHOW INDEX FROM ForumAlert"),
      );
      expect(alertIndexes.map((i) => [i.Key_name, i.Column_name])).toEqual(
        expect.arrayContaining([
          ["ForumAlert_postId_idx", "postId"],
          ["ForumAlert_threadId_idx", "threadId"],
        ]),
      );
      const [readIndex] = await connection.query<mysql.RowDataPacket[]>(
        rename(
          "SHOW INDEX FROM ForumRead WHERE Key_name = 'ForumRead_thread_read_idx'",
        ),
      );
      expect(
        readIndex
          .sort((a, b) => a.Seq_in_index - b.Seq_in_index)
          .map((i) => i.Column_name),
      ).toEqual(["threadId", "readAt"]);
    } finally {
      await connection.query(
        `DROP TABLE IF EXISTS ${tables.map((table) => `\`${prefix}${table}\``).join(", ")}`,
      );
      await connection.end();
    }
  });
});
