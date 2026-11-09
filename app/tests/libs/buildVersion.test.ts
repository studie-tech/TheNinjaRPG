import { describe, expect, it } from "bun:test";
import {
  BUILD_RELOAD_STORAGE_KEY,
  claimBuildReload,
  isMissingProcedureError,
  isOutdatedBuild,
  getErrorServerBuild,
  shouldReloadForMissingProcedure,
} from "@/libs/buildVersion";

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  } as Storage;
};

describe("isOutdatedBuild", () => {
  it("flags a bundle whose build differs from the server's", () => {
    expect(isOutdatedBuild("aaa", "bbb")).toBe(true);
    expect(isOutdatedBuild("aaa", "aaa")).toBe(false);
  });

  it("ignores missing headers and builds without a commit", () => {
    expect(isOutdatedBuild("aaa", null)).toBe(false);
    expect(isOutdatedBuild("aaa", "")).toBe(false);
    expect(isOutdatedBuild("aaa", "unknown")).toBe(false);
    expect(isOutdatedBuild("unknown", "bbb")).toBe(false);
  });
});

describe("claimBuildReload", () => {
  it("allows one reload per server build and tab", () => {
    const storage = memoryStorage();
    expect(claimBuildReload(storage, "bbb")).toBe(true);
    expect(storage.getItem(BUILD_RELOAD_STORAGE_KEY)).toBe("bbb");
    // The reload came back with the old bundle: do not loop.
    expect(claimBuildReload(storage, "bbb")).toBe(false);
    // A later deploy gets its own attempt.
    expect(claimBuildReload(storage, "ccc")).toBe(true);
  });

  it("never reloads when storage is unavailable", () => {
    const storage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    } as unknown as Storage;
    expect(claimBuildReload(storage, "bbb")).toBe(false);
  });
});

const trpcError = (message: string, code?: string) =>
  Object.assign(new Error(message), code ? { data: { code } } : {});

const missingProcedure = () =>
  trpcError('No procedure found on path "jutsu.getUserJutsuOwnership"', "NOT_FOUND");

describe("isMissingProcedureError", () => {
  it("matches tRPC's NOT_FOUND error for an unknown path", () => {
    expect(isMissingProcedureError(missingProcedure())).toBe(true);
  });

  it("ignores other NOT_FOUND errors, other codes and non-errors", () => {
    expect(isMissingProcedureError(trpcError("User not found", "NOT_FOUND"))).toBe(
      false,
    );
    expect(
      isMissingProcedureError(
        trpcError('No procedure found on path "a.b"', "BAD_REQUEST"),
      ),
    ).toBe(false);
    expect(isMissingProcedureError(trpcError('No procedure found on path "a.b"'))).toBe(
      false,
    );
    expect(isMissingProcedureError({ message: "No procedure found on path" })).toBe(
      false,
    );
    expect(isMissingProcedureError(null)).toBe(false);
  });
});

describe("shouldReloadForMissingProcedure", () => {
  it("reloads once per newer server build when a procedure was removed", () => {
    const storage = memoryStorage();
    const decide = (serverBuild: string) =>
      shouldReloadForMissingProcedure({
        error: missingProcedure(),
        clientBuild: "aaa",
        serverBuild,
        storage,
      });
    expect(decide("bbb")).toBe(true);
    // Still missing after the reload (or genuinely missing on the newest build): no loop.
    expect(decide("bbb")).toBe(false);
    // A later deploy gets its own attempt.
    expect(decide("ccc")).toBe(true);
  });

  it("does not reload when the tab already runs the server's build", () => {
    const storage = memoryStorage();
    expect(
      shouldReloadForMissingProcedure({
        error: missingProcedure(),
        clientBuild: "aaa",
        serverBuild: "aaa",
        storage,
      }),
    ).toBe(false);
    expect(storage.getItem(BUILD_RELOAD_STORAGE_KEY)).toBeNull();
  });

  it("does not reload without a known server build", () => {
    for (const serverBuild of [null, undefined, "unknown"]) {
      expect(
        shouldReloadForMissingProcedure({
          error: missingProcedure(),
          clientBuild: "aaa",
          serverBuild,
          storage: memoryStorage(),
        }),
      ).toBe(false);
    }
  });

  it("does not reload for other errors, even on an outdated tab", () => {
    const storage = memoryStorage();
    expect(
      shouldReloadForMissingProcedure({
        error: trpcError("Something broke", "INTERNAL_SERVER_ERROR"),
        clientBuild: "aaa",
        serverBuild: "bbb",
        storage,
      }),
    ).toBe(false);
    expect(storage.getItem(BUILD_RELOAD_STORAGE_KEY)).toBeNull();
  });

  it("does not reload when a crash reload for that build already happened", () => {
    expect(
      shouldReloadForMissingProcedure({
        error: missingProcedure(),
        clientBuild: "aaa",
        serverBuild: "bbb",
        storage: memoryStorage({ [BUILD_RELOAD_STORAGE_KEY]: "bbb" }),
      }),
    ).toBe(false);
  });
});

describe("getErrorServerBuild", () => {
  it("reads the build header from the response attached to a tRPC error", () => {
    const error = Object.assign(new Error('No procedure found on path "x"'), {
      meta: { response: new Response(null, { headers: { "x-tnr-build": "abc123" } }) },
    });
    expect(getErrorServerBuild(error)).toBe("abc123");
  });

  it("returns null when no response is attached", () => {
    expect(getErrorServerBuild(new Error("boom"))).toBeNull();
    expect(getErrorServerBuild(null)).toBeNull();
    expect(getErrorServerBuild({ meta: { response: {} } })).toBeNull();
  });
});
