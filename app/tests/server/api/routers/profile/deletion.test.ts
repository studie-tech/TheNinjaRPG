import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { CHARACTER_DELETION_CONFIRMATION, type UserRole } from "@/drizzle/constants";
import { profileRouter } from "@/server/api/routers/profile";
import * as staff from "@/server/api/routers/staff";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import { callerForDatabase } from "../../../../setup/testDatabase";

let deletionAt: Date | null;
let role: UserRole;
const writeTimer = vi.fn();

beforeEach(() => {
  deletionAt = null;
  role = "USER";
  writeTimer.mockReset();
  writeTimer.mockResolvedValue({ rowsAffected: 1 });
  stubProfile("fetchUser", async (_client: unknown, userId: string) => ({ userId, role, deletionAt, anbuId: null, clanId: null }));
  stubProfile("updateUserDataForToggleDeletionTimer", writeTimer);
  vi.spyOn(staff, "deleteUser").mockResolvedValue(undefined);
});

afterEach(() => {
  resetServerModuleStubs();
  vi.restoreAllMocks();
});

const caller = () => callerForDatabase(profileRouter, "player", {} as never);

it.each([undefined, "", "delete my character", "Delete my character "])("rejects starting a self-deletion timer without the exact phrase (%s)", async (confirmation) => {
  expect(await caller().toggleDeletionTimer({ userId: "player", confirmation })).toMatchObject({ success: false, message: expect.stringContaining(CHARACTER_DELETION_CONFIRMATION) });
  expect(writeTimer).not.toHaveBeenCalled();
});

it("starts a confirmed request and allows cancellation without typing", async () => {
  expect(await caller().toggleDeletionTimer({ userId: "player", confirmation: CHARACTER_DELETION_CONFIRMATION })).toMatchObject({ success: true });
  deletionAt = new Date(Date.now() + 60_000);
  expect(await caller().toggleDeletionTimer({ userId: "player" })).toMatchObject({ success: true });
  expect(writeTimer).toHaveBeenCalledTimes(2);
});

it("does not restart a timer when a cancellation arrives after the request was cancelled", async () => {
  expect(await caller().toggleDeletionTimer({ userId: "player" })).toMatchObject({ success: false });
  expect(writeTimer).not.toHaveBeenCalled();
});

it("requires the phrase again before permanent self-deletion", async () => {
  deletionAt = new Date(Date.now() - 1000);
  expect(await caller().confirmDeletion({ userId: "player" })).toMatchObject({ success: false });
  expect(staff.deleteUser).not.toHaveBeenCalled();
  expect(await caller().confirmDeletion({ userId: "player", confirmation: CHARACTER_DELETION_CONFIRMATION })).toMatchObject({ success: true });
  expect(staff.deleteUser).toHaveBeenCalledTimes(1);
});

it("keeps the waiting period enforced even with the correct phrase", async () => {
  deletionAt = new Date(Date.now() + 60_000);
  expect(await caller().confirmDeletion({ userId: "player", confirmation: CHARACTER_DELETION_CONFIRMATION })).toMatchObject({ success: false, message: "Deletion timer not passed yet" });
  expect(staff.deleteUser).not.toHaveBeenCalled();
});

it("preserves staff management permissions for another character", async () => {
  role = "HEAD_MODERATOR";
  expect(await caller().toggleDeletionTimer({ userId: "other-player" })).toMatchObject({ success: true });
  deletionAt = new Date(Date.now() - 1000);
  expect(await caller().confirmDeletion({ userId: "other-player" })).toMatchObject({ success: true });
});

it("rejects deletion management of another character by a player", async () => {
  expect(await caller().toggleDeletionTimer({ userId: "other-player", confirmation: CHARACTER_DELETION_CONFIRMATION })).toMatchObject({ success: false });
  deletionAt = new Date(Date.now() - 1000);
  expect(await caller().confirmDeletion({ userId: "other-player", confirmation: CHARACTER_DELETION_CONFIRMATION })).toMatchObject({ success: false });
  expect(writeTimer).not.toHaveBeenCalled();
  expect(staff.deleteUser).not.toHaveBeenCalled();
});
