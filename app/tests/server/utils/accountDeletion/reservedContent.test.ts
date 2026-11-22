import { afterEach, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs/server";
import { RESERVED_CONTENT_IDS } from "@/libs/reservedContent";
import { removeAccountGameData } from "@/server/utils/accountDeletion/cleanup";
import { removeAccountIdentity } from "@/server/utils/accountDeletion/identity";
import { resetServerModuleStubs, stubDatabase } from "../../../setup/serverModules";

afterEach(() => {
  resetServerModuleStubs();
  vi.restoreAllMocks();
});

it("rejects reserved accounts before identity deletion or game-data cleanup begins", async () => {
  const access = vi.fn(() => {
    throw new Error("Reserved account deletion reached an external dependency");
  });
  stubDatabase({
    select: access,
    insert: access,
    update: access,
    delete: access,
    transaction: access,
  });
  vi.spyOn(clerk, "clerkClient").mockImplementation(access);
  for (const id of new Set([
    ...RESERVED_CONTENT_IDS.ai,
    ...RESERVED_CONTENT_IDS.user,
  ])) {
    for (const alias of [id, `${id.toUpperCase()} `]) {
      await expect(removeAccountIdentity(alias)).rejects.toThrow("reserved content");
      await expect(removeAccountGameData(alias)).rejects.toThrow("reserved content");
    }
  }
  expect(access).not.toHaveBeenCalled();
});
