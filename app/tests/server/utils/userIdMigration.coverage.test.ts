// @vitest-environment node

import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@/drizzle/schema";
import { USER_ID_REFERENCE_COLUMNS } from "@/server/utils/userIdMigration";

const SPECIAL_USER_ID_FIELDS = new Set([
  "createdBy",
  "createdById",
  "authorId",
  "activeUserId",
  "attackedId",
  "defenderId",
  "winnerId",
  "userId1",
  "userId2",
  "founderId",
  "leaderId",
  "elderNomineeId",
  "coLeader1",
  "coLeader2",
  "coLeader3",
  "assassin1",
  "assassin2",
  "assassin3",
  "assassin4",
  "assassin5",
  "assassin6",
  "assassin7",
  "assassin8",
  "assassin9",
  "assassin10",
  "userOne",
  "userTwo",
  "recruiterId",
  "senseiId",
  "sellerId",
  "buyerId",
  "bidderId",
  "purchaserUserId",
  "allowedPurchaserId",
  "kageId",
  "killerId",
  "victimId",
  "senderId",
  "receiverId",
  "awardedById",
  "reviewedBy",
]);

/** Detect schema fields whose name means an application identity rather than a row/item id. */
const isUserIdField = (field: string) =>
  field === "userId" || field.endsWith("UserId") || SPECIAL_USER_ID_FIELDS.has(field);

it("keeps the user-id migration inventory in sync with every schema identity column", () => {
  const candidates = new Set<string>();
  for (const value of Object.values(schema)) {
    try {
      const table = value as Table;
      const tableName = getTableName(table);
      for (const [field, column] of Object.entries(getTableColumns(table))) {
        if (isUserIdField(field)) candidates.add(`${tableName}.${column.name}`);
      }
    } catch {
      // Types, relations, and constants are exported beside tables.
    }
  }

  // These are deliberately handled outside the ordinary reference loop.
  candidates.delete("MpvpBattleQueue.winnerId"); // Clan.id, despite its name.
  candidates.delete("UserData.userId"); // Primary identity row is updated last.
  candidates.delete("StoreUserIdAlias.oldUserId"); // Durable redirect is retained.
  candidates.delete("StoreEntitlementState.userId"); // Collision-aware store merge.
  candidates.delete("StoreEntitlementRevocation.userId"); // Collision-aware store merge.
  candidates.delete("StorePurchaseTransfer.sourceUserId"); // Collision-aware store merge.
  candidates.delete("StorePurchaseTransfer.destinationUserId"); // Store graph rewrite.

  const inventory = new Set(
    USER_ID_REFERENCE_COLUMNS.map(([table, column]) => `${table}.${column}`),
  );
  expect([...inventory].sort()).toEqual([...candidates].sort());
});
