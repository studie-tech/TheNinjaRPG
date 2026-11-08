/**
 * Who a store receipt belongs to across staff renames and account deletion: alias
 * resolution, retirement tombstones and the rename migrations of the ledger's own rows.
 */

import { nanoid } from "nanoid";
import { STORE_PLATFORMS } from "@/drizzle/constants";
import {
  deleteStoreEntitlementRevocationForMigrateStoreEntitlementRevocations,
  deleteStoreEntitlementStateForMigrateStoreEntitlementStates,
  deleteStorePurchaseTransferForMigrateStorePurchaseTransfers,
  deleteStorePurchaseTransferForMigrateStorePurchaseTransfers2,
  findStoreEntitlementRevocationForMigrateStoreEntitlementRevocations,
  findStorePurchaseTransferForMigrateStorePurchaseTransfers,
  findStoreUserIdAlias,
  insertStoreUserIdAlias,
  listStoreEntitlementRevocationForMigrateStoreEntitlementRevocations,
  listStoreEntitlementStateForMigrateStoreEntitlementStates,
  listStorePurchaseTransferForMigrateStorePurchaseTransfers,
  updateStoreEntitlementRevocationForMigrateStoreEntitlementRevocations,
  updateStoreEntitlementRevocationForMigrateStoreEntitlementRevocations2,
  updateStoreEntitlementStateForMigrateStoreEntitlementStates,
  updateStoreEntitlementStateForMigrateStoreEntitlementStates2,
  updateStorePurchaseTransferForMigrateStorePurchaseTransfers,
  updateStorePurchaseTransferForMigrateStorePurchaseTransfers2,
  updateStorePurchaseTransferForMigrateStorePurchaseTransfers3,
} from "@/queries/purchases";
import type { DrizzleClient } from "@/server/db";

export const DELETED_STORE_USER_PREFIX = "__tnr_deleted_store_user__:";

/** Recognize identities replaced by a store-deletion tombstone. */
export const isDeletedStoreUserId = (userId: string): boolean =>
  userId.startsWith(DELETED_STORE_USER_PREFIX);

/** Whether deletion has retired this identity: a tombstone alias hangs off it. */
export const isRetiredStoreUserId = async (
  client: DrizzleClient,
  userId: string,
): Promise<boolean> => {
  const alias = await findStoreUserIdAlias(client, userId);
  return alias !== undefined && isDeletedStoreUserId(alias.newUserId);
};

/**
 * Follow staff-driven user-id renames so delayed webhooks cannot recreate the old id.
 *
 * A deletion tombstone is not followed. Deletion retires the character, not the ledger:
 * the receipts stay under the identity it retired, and so does everything the ledger
 * records while the character is gone, so that a returning identity finds its coverage.
 * Resolution therefore stops at that identity, and `isRetiredStoreUserId` answers the
 * separate question of whether there is a character to deliver to.
 */
export const canonicalStoreUserId = async (
  client: DrizzleClient,
  userId: string,
): Promise<string> => {
  const visited = new Set<string>();
  let current = userId;
  while (true) {
    if (visited.has(current))
      throw new Error(`Store user-id alias cycle from ${userId}`);
    visited.add(current);
    const alias = await findStoreUserIdAlias(client, current);
    if (
      !alias ||
      alias.newUserId === current ||
      isDeletedStoreUserId(alias.newUserId)
    ) {
      return current;
    }
    current = alias.newUserId;
  }
};

/** Resolve aliases for a RevenueCat id list, dropping blanks and repeats. */
export const canonicalStoreUserIds = async (
  client: DrizzleClient,
  userIds: string[],
) => {
  const canonical: string[] = [];
  for (const id of userIds.filter(Boolean)) {
    canonical.push(await canonicalStoreUserId(client, id));
  }
  return [...new Set(canonical)];
};

/**
 * Rename an application user id inside durable transfer aliases.
 *
 * Destination ids are non-unique and can be changed directly. A source can have many
 * ownership epochs, so each historical redirect follows the rename independently.
 */
export const migrateStorePurchaseTransfers = async (
  client: DrizzleClient,
  oldUserId: string,
  newUserId: string,
): Promise<void> => {
  await updateStorePurchaseTransferForMigrateStorePurchaseTransfers(
    client,
    newUserId,
    oldUserId,
  );

  const aliases = await listStorePurchaseTransferForMigrateStorePurchaseTransfers(
    client,
    oldUserId,
  );
  for (const alias of aliases) {
    if (alias.destinationUserId === newUserId) {
      await deleteStorePurchaseTransferForMigrateStorePurchaseTransfers(client, alias);
      continue;
    }
    const collision = await findStorePurchaseTransferForMigrateStorePurchaseTransfers(
      client,
      newUserId,
      alias,
    );
    if (collision) {
      await updateStorePurchaseTransferForMigrateStorePurchaseTransfers2(
        client,
        alias,
        collision,
      );
      await deleteStorePurchaseTransferForMigrateStorePurchaseTransfers(client, alias);
    } else {
      await updateStorePurchaseTransferForMigrateStorePurchaseTransfers3(
        client,
        newUserId,
        alias,
      );
    }
  }
  await deleteStorePurchaseTransferForMigrateStorePurchaseTransfers2(client, newUserId);
};

/** Merge per-store revocation watermarks before an account id is renamed. */
export const migrateStoreEntitlementStates = async (
  client: DrizzleClient,
  oldUserId: string,
  newUserId: string,
): Promise<void> => {
  // Each (store, environment) pair writes only its own rows, so one read serves every pair.
  const states = await listStoreEntitlementStateForMigrateStoreEntitlementStates(
    client,
    [oldUserId, newUserId],
  );
  const stateOf = (userId: string, store: string, isSandbox: boolean) =>
    states.find(
      (state) =>
        state.userId === userId &&
        state.store === store &&
        state.isSandbox === isSandbox,
    );
  for (const store of STORE_PLATFORMS) {
    for (const isSandbox of [false, true]) {
      const oldState = stateOf(oldUserId, store, isSandbox);
      const newState = stateOf(newUserId, store, isSandbox);
      if (!oldState) continue;
      if (newState) {
        await updateStoreEntitlementStateForMigrateStoreEntitlementStates(
          client,
          oldState,
          newState,
        );
        await deleteStoreEntitlementStateForMigrateStoreEntitlementStates(
          client,
          oldState,
        );
      } else {
        await updateStoreEntitlementStateForMigrateStoreEntitlementStates2(
          client,
          newUserId,
          oldState,
        );
      }
    }
  }
};

/** Move durable per-event expiry facts across a staff user-id rename. */
export const migrateStoreEntitlementRevocations = async (
  client: DrizzleClient,
  oldUserId: string,
  newUserId: string,
): Promise<void> => {
  const revocations =
    await listStoreEntitlementRevocationForMigrateStoreEntitlementRevocations(
      client,
      oldUserId,
    );
  for (const revocation of revocations) {
    const collision =
      await findStoreEntitlementRevocationForMigrateStoreEntitlementRevocations(
        client,
        revocation,
        newUserId,
      );
    if (collision) {
      await updateStoreEntitlementRevocationForMigrateStoreEntitlementRevocations(
        client,
        collision,
        revocation,
      );
      await deleteStoreEntitlementRevocationForMigrateStoreEntitlementRevocations(
        client,
        revocation,
      );
    } else {
      await updateStoreEntitlementRevocationForMigrateStoreEntitlementRevocations2(
        client,
        newUserId,
        revocation,
      );
    }
  }
};

/**
 * Tombstone a deleted store identity while retaining receipt idempotency history.
 *
 * One alias row. Rename aliases pointing at this identity are left in place: resolution
 * stops at the identity a tombstone retires, so they still land here, and registration
 * removes exactly this row when the identity returns.
 */
export const retireStoreUserId = async (
  client: DrizzleClient,
  userId: string,
  beforeRetire?: (client: DrizzleClient) => Promise<void>,
): Promise<void> => {
  if (isDeletedStoreUserId(userId)) return;
  const tombstone = `${DELETED_STORE_USER_PREFIX}${nanoid()}`;
  // Idempotent statements rather than a transaction. Deletion is where this codebase has
  // actually seen deadlocks -- deleteUser retries them with backoff -- and holding a lock
  // across these while the cleanup runs is what made that likely. Re-running either
  // converges on the same state, so a failure part-way is repaired by the retry
  // deleteUser already performs.
  // The tombstone goes down before the cleanup, not after. Identity-scoped writes check
  // for it before they write, so once it exists none begins; the cleanup below removes
  // whatever arrived before it, and a write already past its check when the tombstone
  // landed leaves at most a row the fan-out never reads. Ordered the other way round, a
  // registration slipping between the cleanup and the tombstone would outlive the account.
  //
  // Whoever wrote this row first keeps it. A retry therefore keeps its own marker, and --
  // the reason this matters without a lock -- a rename that has already pointed this id
  // somewhere real is not overwritten with a tombstone, which would strand every store
  // lookup for the old id on a deleted identity. The row is read back rather than assumed:
  // if a rename owns it, the identity is being moved, and this deletion stops here rather
  // than shred what the rename is relocating.
  await insertStoreUserIdAlias(client, userId, tombstone);
  const claim = await findStoreUserIdAlias(client, userId);
  if (claim && !isDeletedStoreUserId(claim.newUserId)) {
    throw new Error(`User ${userId} is being renamed and cannot be deleted`);
  }
  // Whatever landed before the tombstone. Store receipts are deliberately left alone --
  // they are an audit ledger and outlive the account by design -- so this reaches only the
  // identity-scoped rows that must not.
  await beforeRetire?.(client);
};
