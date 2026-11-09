import { nanoid } from "nanoid";
import { forumBoard, forumSection } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import type { DrizzleClient } from "@/server/db";

// Match the migration's stable legacy-group IDs so repeated seeds do not duplicate sections.
const sections = {
  broadcast: {
    id: "section-32f9596501250c0c374c9d58850aeb0fc01e4e81b2834cdbe3b77c26d53dbcf4",
    name: "Main Broadcast",
    summary: "General boards for TNR",
    position: 0,
  },
  roleplay: {
    id: "section-7c478ab1fd7a0edca25c27f1d2c5b600fd7935bc09a1722e4e31eb1a1d3204ce",
    name: "Text-Based RPG",
    summary: "Village Boards",
    position: 1,
  },
  lounge: {
    id: "section-19f6bef2ec092b7bf4fd17c488d7e19a26fd1f3ec8ee0ee37c85ae024847d80a",
    name: "The Chat Lounge",
    summary: "Fun boards for TNR",
    position: 2,
  },
} as const;

const boards = [
  {
    name: "News",
    summary: "Keep an eye out for announcements, contests, and important updates here.",
    section: "broadcast" as const,
  },
  {
    name: "Questions & Answers",
    summary:
      "Check here if you have a question about the game or are in need of information. ",
    section: "broadcast" as const,
  },
  {
    name: "Shinobi University",
    summary:
      "Seichi's center for learning, it is the location of the Shinobi Academy for all villages, the Esakanki Medical Hospital and the Special Training Facility. Dubbed as 'TSU' by many, it the first step for any aspiring villager to become a Shinobi, and the first stage for any Shinobi to reach higher, more prestigious levels.",
    section: "roleplay" as const,
  },
  {
    name: "Fire Country",
    summary:
      "Covering the west of Seichi, open plains and dense forests span across this nation. The land is scarred with craters thanks to the recent disasters. While the country remains warm for most of the year, the north experiences constant snow and the south enjoys an equal amount of rain during winter. With little land for agriculture, the nation relies on trading and manufacturing for sustenance.",
    section: "roleplay" as const,
  },
  {
    name: "Wind Country",
    summary:
      "Except for the occasional cliffs that seem to jut out of nowhere, the land is almost flat with either tall grass or deeply carved canyons. The endless green plains are especially beautiful to watch during summer. Towards the west, the plains turn into hills with denser forests. The land is much cooler on the east where the country welcomes cool winds from its neighbor, the Snow country. The scent of smoke hangs in almost every region of the nation.",
    section: "roleplay" as const,
  },
  {
    name: "Frost Country",
    summary:
      "On the central north of Seichi, this country is covered by almost nothing but snow-capped mountains and jagged frozen wastelands. Home to the highest peak, Mount Tenken, the nation is generally at a higher elevation than the others. The otherwise barren valleys are filled with beautiful wildflowers during summer. The freezing temperatures makes traversing these steep mountains dangerous even to those who are skilled.",
    section: "roleplay" as const,
  },
  {
    name: "Water Country",
    summary:
      "The Water country is a group of connected islands present at the south-west corner of the continent. With bamboo jungles, waterfalls, and bays, this tropical rainforest is home to many natural hot springs and active volcanoes. The land is shrouded by a dense fog that is formed due to thick plumes of steam from the volcanic mountains spilling into the surrounding ocean under cooler temperatures. The islands receive regular rain and experience a long wet season.",
    section: "roleplay" as const,
  },
  {
    name: "Sun Country",
    summary:
      "Spanning over more than half the eastern side of Seichi, the Sun country is mostly a sandy desert with mountain ranges across the north and west. The country’s primary water resources are oases. White-sanded beaches with crystal clear water rim the eastern coast, where the land is fertile enough for cultivation. One large river runs towards the eastern coast from the center, cutting through the rocks to form a canyon of rushing rapids.",
    section: "roleplay" as const,
  },
  {
    name: "The Chat Threads",
    summary:
      "Chat threads are not for everyone, side effects may include ringing ears, a worn out keyboard and sleep deprivation, consult your doctor before use.",
    section: "lounge" as const,
  },
];

/** Add a missing built-in board without overwriting staff-managed configuration on existing boards. */
const insertMissingBoard = async (
  client: DrizzleClient,
  board: { name: string; summary: string; section: keyof typeof sections },
) => {
  const existing = await client.query.forumBoard.findFirst({
    where: eq(forumBoard.name, board.name),
  });
  if (existing) return;
  const section = sections[board.section];
  await client
    .insert(forumSection)
    .values({ ...section, policy: {} })
    .onDuplicateKeyUpdate({ set: { id: section.id } });
  await client.insert(forumBoard).values({
    id: nanoid(),
    name: board.name,
    summary: board.summary,
    sectionId: section.id,
    policy: board.name === "News" ? { create: "STAFF" } : {},
  });
};

/** Ensure built-in destinations exist while preserving their stable migrated hierarchy. */
export const seedForum = async (client: DrizzleClient) => {
  console.log("\nSyncing forum boards...\n");
  for (const board of boards) {
    await insertMissingBoard(client, board);
  }
  console.log("Done syncing boards!");
};
