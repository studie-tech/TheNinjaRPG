import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createTRPCClient } from "@trpc/client";
import { createTRPCQueryUtils } from "@trpc/react-query";
import { waitFor } from "@testing-library/react";
import { expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { shouldInvalidateEndedBattleCaches } from "@/libs/combat/battleMaps";
import { maskBattle } from "@/libs/combat/util";
import type { AppRouter } from "@/server/api/root";
import { makeCompleteBattle } from "../libs/combat/helpers/battleScenario";
import { guardianVictory } from "../setup/territoryWar";

// Execute the real completion effect without mounting its unrelated WebGL scene,
// following combat-render-lifecycle.test.ts. Keep masking and query utilities real.
const source = readFileSync(new URL("../../src/layout/Combat.tsx", import.meta.url), "utf8");
const start = source.indexOf("  useEffect(() => {\n    const endedBattleId");
const end = source.indexOf("\n\n  // Lobby for non-arena battles", start);
if (start < 0 || end < 0) throw new Error("Combat completion effect is missing");
const transpiler = new (require("bun").Transpiler)({ loader: "ts" }) as {
  transformSync(source: string): string;
};
const complete = new Function("scope", `with (scope) { ${transpiler.transformSync(source.slice(start, end))} }`) as (scope: object) => void;

it.each([
  { type: "TERRITORY_WAR", snapshot: true, hasResult: true, invalidates: true },
  { type: "COMBAT", snapshot: true, hasResult: true, invalidates: true },
  { type: "COMBAT", snapshot: false, hasResult: true, invalidates: true },
  { type: "ARENA", snapshot: false, hasResult: true, invalidates: false },
  { type: "TERRITORY_WAR", snapshot: true, hasResult: false, invalidates: false },
] as const)("reconciles public $type completion caches (snapshot: $snapshot, result: $hasResult)", async ({ type, snapshot, hasResult, invalidates }) => {
  const authoritative = snapshot ? guardianVictory() : makeCompleteBattle();
  authoritative.battleType = type;
  const battle = maskBattle(authoritative, "player-0");
  expect(battle.extraState).not.toHaveProperty("territoryWar");
  expect(authoritative.extraState.territoryWar !== undefined).toBe(snapshot);

  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const utils = createTRPCQueryUtils({ client: createTRPCClient<AppRouter>({ links: [] }), queryClient: client });
  const keys = ["territoryWar", "village", "clan"].map((router) => [[router, router === "territoryWar" ? "getCurrent" : "get"], { type: "query" }]);
  for (const key of keys) client.setQueryData(key, { version: "before" });
  const noticeKey = [["territoryWar", "getNotice"], { type: "query" }];
  client.setQueryData(noticeKey, { version: "before" });
  const readNotice = vi.fn(async () => ({ version: "after" }));
  const observer = new QueryObserver(client, { queryKey: noticeKey, queryFn: readNotice });
  const close = observer.subscribe(() => {});
  try {
    const scope = {
      props: { battleState: { battle, result: hasResult ? { outcome: "Won" } : null } },
      endedBattleInvalidationRef: { current: null },
      completionRevisionRef: { current: null },
      shouldInvalidateEndedBattleCaches,
      prepareUserUpdate: () => 1,
      updateUser: vi.fn(async () => {}),
      utils,
      useEffect: (callback: () => void) => callback(),
    };
    complete(scope);
    for (const key of keys) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(invalidates);
      // Inactive treasuries stay cached until their pages are opened.
      expect(client.getQueryData(key)).toEqual({ version: "before" });
      expect(client.getQueryState(key)?.fetchStatus).toBe("idle");
    }
    if (invalidates) {
      await waitFor(() => expect(client.getQueryData(noticeKey)).toEqual({ version: "after" }));
    }
    expect(readNotice).toHaveBeenCalledTimes(invalidates ? 1 : 0);
    complete(scope);
    expect(readNotice).toHaveBeenCalledTimes(invalidates ? 1 : 0);
    expect(scope.updateUser).toHaveBeenCalledTimes(hasResult ? 1 : 0);
  } finally {
    close();
    client.clear();
  }
});
