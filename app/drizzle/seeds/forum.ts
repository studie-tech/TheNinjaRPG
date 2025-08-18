import { nanoid } from "nanoid";
import { forumBoard } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import type { DrizzleClient } from "@/server/db";

const boards = [
  {
    name: "News",
    summary: "Keep an eye out for announcements, contests, and important updates here.",
    group: "Main Broadcast:General boards for TNR",
  },
  {
    name: "Questions & Answers",
    summary:
      "Check here if you have a question about the game or are in need of information. ",
    group: "Main Broadcast:General boards for TNR",
  },
];

// Bookkeeping
let counter = 0;
const total = boards.length;

const upsertBoard = async (
  client: DrizzleClient,
  board: { name: string; summary: string; group: string },
) => {
  // Database call
  const obj = await client.query.forumBoard.findFirst({
    where: eq(forumBoard.name, board.name),
  });
  if (obj) {
    await client.update(forumBoard).set(board).where(eq(forumBoard.name, board.name));
  } else {
    await client.insert(forumBoard).values({
      id: nanoid(),
      ...board,
    });
  }
  // Progress
  counter++;
  process.stdout.moveCursor(0, -1);
  process.stdout.clearLine(1);
  console.log(`Syncing board ${counter}/${total}`);
};

export const seedForum = async (client: DrizzleClient) => {
  console.log("\nSyncing forum boards...\n");
  const promises: Promise<void>[] = [];
  for (const board of boards) {
    promises.push(upsertBoard(client, board));
  }
  await Promise.all(promises).then(() => {
    console.log("Done syncing boards!");
  });
};
