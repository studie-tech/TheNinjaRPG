import { expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";

// Exercise the ANBU auto-attack without mounting its WebGL scene, as in sector-movement-feedback.test.ts.
const source = readFileSync(
  new URL("../../src/layout/Sector.tsx", import.meta.url),
  "utf8",
);
const transpiler = new (require("bun").Transpiler)({ loader: "ts" }) as {
  transformSync(source: string): string;
};
const block = (startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Missing auto-attack code: ${startMarker}`);
  return source.slice(start, end);
};
const evaluate = (code: string, scope: object) =>
  new Function("scope", `with (scope) { ${transpiler.transformSync(code)} }`)(scope);

const enemy = { userId: "enemy", longitude: 4, latitude: 6 };
const setup = (origin: { col: number; row: number }) => {
  const attack = vi.fn();
  const scope = {
    api: {
      combat: {
        attackUser: { useMutation: () => ({ mutate: attack, isPending: false }) },
      },
    },
    prepareUserUpdate: vi.fn(),
    isActiveRef: { current: true },
    autoAttackMode: true,
    sector: 3,
    userRef: { current: { anbuId: "anbu", status: "AWAKE", village: { sector: 3 } } },
    originRef: { current: { ...origin, battleBiome: "forest" } },
    movePendingRef: { current: false },
    walkAnimatingRef: { current: false },
    lastAutoAttackTimeRef: { current: 0 },
    readAutoAttackSetting: () => 0,
    AUTO_ATTACK_SETTINGS: { delay: "delay", minLevel: "minLevel" },
    usersRef: { current: [enemy] },
    isAutoAttackTarget: () => true,
    warData: [],
    setTarget: vi.fn(),
    pusher: { connection: { socket_id: "socket-1" } },
    sectorRef: { current: 3 },
  };
  const maybeAutoAttack = evaluate(
    `${block("  const { mutate: attack, isPending: isAttacking } =", "  const { mutate: interactNpc")}
${block("  const maybeAutoAttack = () => {", "  autoAttackRef.current = maybeAutoAttack;")}
return maybeAutoAttack;`,
    scope,
  ) as () => void;
  return { attack, scope, maybeAutoAttack };
};

it("attacks an enemy on the player's tile with the tile's biome and socket", () => {
  const test = setup({ col: 4, row: 6 });
  test.maybeAutoAttack();
  expect(test.attack.mock.calls).toEqual([
    [
      {
        originSocketId: "socket-1",
        userId: "enemy",
        longitude: 4,
        latitude: 6,
        sector: 3,
        asset: "forest",
      },
    ],
  ]);
  expect(test.scope.setTarget).not.toHaveBeenCalled();
  expect(test.scope.lastAutoAttackTimeRef.current).toBeGreaterThan(0);
});

it("walks toward an enemy on another tile instead of attacking", () => {
  const test = setup({ col: 1, row: 1 });
  test.maybeAutoAttack();
  expect(test.attack).not.toHaveBeenCalled();
  expect(test.scope.setTarget).toHaveBeenCalledWith({ x: 4, y: 6 });
});

it.each([
  { col: 4, row: 6 },
  { col: 1, row: 1 },
])("does not attack or pursue enemies while the sector is hidden (%j)", (origin) => {
  const test = setup(origin);
  test.scope.isActiveRef.current = false;
  test.maybeAutoAttack();
  expect(test.attack).not.toHaveBeenCalled();
  expect(test.scope.setTarget).not.toHaveBeenCalled();
});

it("ignores sector movement keys while hidden and accepts them when visible again", () => {
  const scope = {
    isActiveRef: { current: false },
    isTravelKeyBlocked: () => false,
    originRef: { current: { col: 5, row: 5 } },
    pathFinderRef: { current: {} },
    setTarget: vi.fn(),
  };
  const onKeyDown = evaluate(
    `${block("  const onDocumentKeyDown =", "  const { mutate: checkQuest")}\nreturn onDocumentKeyDown;`,
    scope,
  ) as (event: { key: string }) => void;
  for (const key of ["w", "s", "q", "e", "a", "d"]) onKeyDown({ key });
  expect(scope.setTarget).not.toHaveBeenCalled();
  scope.isActiveRef.current = true;
  onKeyDown({ key: "w" });
  expect(scope.setTarget).toHaveBeenCalledWith({ x: 5, y: 6 });
});

it("defers an arrival prompt until the retained sector is visible", () => {
  const npc = { userId: "npc" };
  const scope = {
    isActiveRef: { current: false },
    userRef: { current: { longitude: 5, latitude: 5 } },
    liveNpcs: () => [npc],
    locationGroups: [],
    arrivedLocationsRef: { current: [] },
    arrivalNpc: null,
    npcDialog: null,
    isInteracting: false,
    canAttemptAwakeAction: () => true,
    isBlockingPopupOpen: false,
    arrivalPromptDecision: vi.fn(() => ({
      prompt: npc,
      lastPromptedPlacementId: "npc",
    })),
    lastPromptedPlacementIdRef: { current: null },
    setArrivalNpc: vi.fn(),
  };
  const updatePositionActions = evaluate(
    `${block("  const updatePositionActions =", "  positionChangedRef.current =")}\nreturn updatePositionActions;`,
    scope,
  ) as () => void;
  updatePositionActions();
  expect(scope.arrivalPromptDecision).not.toHaveBeenCalled();
  expect(scope.setArrivalNpc).not.toHaveBeenCalled();
  scope.isActiveRef.current = true;
  updatePositionActions();
  expect(scope.setArrivalNpc).toHaveBeenCalledWith(npc);
});
