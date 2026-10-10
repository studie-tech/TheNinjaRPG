import { Client } from "@planetscale/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { staffRouter } from "@/server/api/routers/staff";
import { resetServerModuleStubs, stubProfile } from "../setup/serverModules";
import { callerForDatabase } from "../setup/testDatabase";

const originalDevUrl = process.env.DEV_DATABASE_URL;

const backup = (type: "ai" | "jutsu" = "ai") => ({
  id: "backup",
  type,
  sqlText: `INSERT INTO \`${type === "ai" ? "UserData" : "Jutsu"}\` (\`${type === "ai" ? "userId" : "id"}\`) VALUES ('entry');`,
});

const caller = (savedBackup = backup()) =>
  callerForDatabase(staffRouter, "staff", {
    query: { contentBackup: { findFirst: vi.fn().mockResolvedValue(savedBackup) } },
  } as never);

describe("development backup import", () => {
  beforeEach(() => {
    process.env.DEV_DATABASE_URL = "mysql://user:password@localhost/development";
    stubProfile("fetchUser", (async () => ({ role: "CODING-ADMIN" })) as never);
  });
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
    if (originalDevUrl === undefined) delete process.env.DEV_DATABASE_URL;
    else process.env.DEV_DATABASE_URL = originalDevUrl;
  });

  it.each(["ai", "jutsu"] as const)("preflights a %s backup before replacing content without a transaction", async type => {
    const saved = backup(type);
    const execute = vi.spyOn(Client.prototype, "execute").mockResolvedValue({} as never);
    const transaction = vi.spyOn(Client.prototype, "transaction").mockRejectedValue(new Error("Transactions are forbidden"));
    const result = await caller(saved).pushBackupToDev({id: saved.id});
    expect(result.success).toBe(true);
    expect(execute.mock.calls.map(([query]) => query)).toEqual([
      `EXPLAIN ${saved.sqlText}`,
      type === "ai" ? "DELETE FROM `UserData` WHERE isAi = 1" : "DELETE FROM `Jutsu`",
      saved.sqlText,
    ]);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("leaves content untouched when the backup is incompatible with the destination schema", async () => {
    const saved = backup();
    const execute = vi.spyOn(Client.prototype, "execute").mockRejectedValue(new Error("Unknown column 'ninjutsuOffence'"));
    const result = await caller(saved).pushBackupToDev({id: saved.id});
    expect(result.success).toBe(false);
    expect(result.message).toContain("No content was changed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(`EXPLAIN ${saved.sqlText}`);
  });
});
