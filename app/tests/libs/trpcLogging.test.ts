import { describe, expect, it } from "bun:test";
import { createTRPCUntypedClient, loggerLink, TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { shouldLogTrpcOperation } from "@/libs/trpcLogging";

const request = async (path: string, development: boolean, failure: boolean, data: unknown = { ticket: "synthetic-ticket" }) => {
  const logs: unknown[][] = [];
  const log = (...args: unknown[]) => { logs.push(args); };
  const client = createTRPCUntypedClient({ links: [
    loggerLink({
      enabled: (operation) => shouldLogTrpcOperation(operation, development),
      console: { log, error: log },
      colorMode: "none",
    }),
    () => () => observable((observer) => {
      if (failure) observer.error(new TRPCClientError("Synthetic network failure"));
      else {
        observer.next({ result: { data } });
        observer.complete();
      }
    }),
  ] });
  const pending = client.mutation(path, {
    flowId: "synthetic-flow", verifier: "synthetic-verifier", code: "synthetic-code",
  });
  if (failure) await expect(pending).rejects.toThrow("Synthetic network failure");
  else await pending;
  return logs;
};

describe("credential-safe client logging", () => {
  for (const path of ["nativeAuth.start", "nativeAuth.approve", "nativeAuth.exchange", "merch.checkout", "parentalControls.save"]) {
    it.each([true, false])(`never logs ${path} inputs or ticket responses (development: %s)`, async (development) => {
      expect(await request(path, development, false)).toEqual([]);
      expect(await request(path, development, true)).toEqual([]);
    });
  }
  it("omits routine movement logs while retaining rejections and transport failures", async () => {
    expect(await request("travel.moveInSector", true, false, { success: true })).toHaveLength(0);
    expect(await request("travel.moveInSector", true, false, { success: false, message: "Blocked tile" })).toHaveLength(1);
    expect(await request("travel.moveInSector", true, true)).toHaveLength(1);
  });
  it("retains ordinary development logs and production failures", async () => {
    expect(await request("profile.updatePreferences", true, false)).toHaveLength(2);
    expect(await request("profile.updatePreferences", false, false)).toHaveLength(0);
    expect(await request("profile.updatePreferences", false, true)).toHaveLength(1);
  });
});
