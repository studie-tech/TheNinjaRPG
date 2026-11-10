import { expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";

// Exercise the scene's movement controller without WebGL, as in sector-movement-feedback.test.ts.
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
  if (start < 0 || end < 0) throw new Error(`Missing movement code: ${startMarker}`);
  return source.slice(start, end);
};
const evaluate = (code: string, scope: object) =>
  new Function("scope", `with (scope) { ${transpiler.transformSync(code)} }`)(scope);
type Destination = { sector: number; x: number; y: number };
type Position = {
  sector: number;
  longitude: number;
  latitude: number;
  location: string;
};
type Handler = (...args: unknown[]) => Promise<void>;

const setup = () => {
  const requested: Destination = { sector: 1, x: 25, y: 5 };
  const scope = {
    userData: { userId: "self" },
    userRef: { current: { status: "AWAKE", location: "" } },
    mountedRef: { current: true },
    movePendingRef: { current: true },
    moveTargetRef: { current: requested as Destination | null },
    walkAnimatingRef: { current: false },
    routeTargetRef: { current: requested as Destination | null },
    pendingCrossRef: { current: null as string | null },
    pendingWorldTargetRef: { current: null as Destination | null },
    sectorRef: { current: 1 },
    originRef: { current: { col: 25, row: 5 } },
    sectorWindowRef: {
      current: {
        sectors: [
          { sector: 1, dx: 0, dy: 0, map: {} },
          { sector: 2, dx: 1, dy: 0, map: {} },
          { sector: 3, dx: 1, dy: 1, map: {} },
        ],
      },
    },
    gridRef: {
      current: {
        getHex: ({ col, row }: { col: number; row: number }) => ({ col, row }),
      },
    },
    pathFinderRef: { current: { getShortestPath: vi.fn(() => []) } },
    windowNavRef: { current: null as object | null },
    sectorMap: {},
    canAttemptAwakeAction: () => true,
    isOnSectorMapEdge: () => true,
    snapMovementPosition: vi.fn((data: Position) => {
      scope.sectorRef.current = data.sector;
      scope.originRef.current = { col: data.longitude, row: data.latitude };
    }),
    setTarget: vi.fn((point: { x: number; y: number } | null) => {
      scope.routeTargetRef.current = point
        ? { sector: scope.sectorRef.current, ...point }
        : null;
    }),
    setPosition: vi.fn(),
    commitMovePosition: vi.fn(async () => {}),
    updateUsersList: vi.fn(),
    publishSurroundings: vi.fn(),
    runQuestTriggers: vi.fn(),
    routeTowardWorldTarget: vi.fn(),
    reAnchorToSector: vi.fn(() => true),
    animateWalk: vi.fn(async () => {}),
    animateWindowPath: vi.fn(async () => {}),
    peekPendingCrossDestination: vi.fn(() => ({ x: 3, y: 5 })),
    buildCrossingPayload: vi.fn(),
    moveStepAsync: vi.fn(async () => ({ success: true })),
    handleCrossing: vi.fn(async () => {}),
    showMutationToast: vi.fn(),
    showActionReadinessToast: vi.fn(),
    updateUser: vi.fn(),
    refreshMovementPosition: vi.fn(),
    continueMovement: vi.fn(),
    healTargetUser: null,
    buildStepPayload: vi.fn((from, dest, sector) => ({ from, dest, sector })),
    move: vi.fn(),
    moveAcrossBorder: vi.fn(),
  };
  const reconcileCrossing = evaluate(
    `${block("  const reconcileCrossing = async (", "  const clearAllHighlights")}\nreturn reconcileCrossing;`,
    scope,
  ) as Handler;
  const applyCrossing = evaluate(
    `${block("  const applyCrossing = async (", "\n\n  /**\n   * Resolve a border crossing")}\nreturn applyCrossing;`,
    scope,
  ) as Handler;
  const runJourneySegment = evaluate(
    `${block("  const runJourneySegment = async (", "\n\n  // Crossing steps")}\nreturn runJourneySegment;`,
    scope,
  ) as Handler;
  const handleCrossing = evaluate(
    `${block("  const handleCrossing = async (", "\n\n  /**\n   * Record a committed move")}\nreturn handleCrossing;`,
    { ...scope, reconcileCrossing, applyCrossing },
  ) as Handler;
  const continueMovement = evaluate(
    `${block("  function continueMovement()", "\n  // Parent commands")}\nreturn continueMovement;`,
    scope,
  ) as () => void;
  return {
    scope,
    requested,
    reconcileCrossing,
    applyCrossing,
    runJourneySegment,
    handleCrossing,
    continueMovement,
  };
};

const landed = { sector: 2, longitude: 3, latitude: 5, location: "Field" };

it("preserves the latest of several clicks while a crossing response is pending", async () => {
  const test = setup();
  test.scope.routeTargetRef.current = { sector: 2, x: 6, y: 6 };
  const latest = { sector: 1, x: 20, y: 7 };
  test.scope.routeTargetRef.current = latest;
  await test.reconcileCrossing({ success: true, data: landed }, {}, test.requested);
  expect(test.scope.routeTargetRef.current).toBe(latest);
  expect(test.scope.snapMovementPosition).toHaveBeenCalledWith(landed);
  expect(test.scope.commitMovePosition).toHaveBeenCalled();
  expect(test.scope.runQuestTriggers).toHaveBeenCalledWith(landed, true);
});

it("clears a completed crossing when there is no later destination", async () => {
  const test = setup();
  await test.reconcileCrossing({ success: true, data: landed }, {}, test.requested);
  expect(test.scope.routeTargetRef.current).toBeNull();
});

it("preserves a queued route through a server-driven crossing", async () => {
  const test = setup();
  const latest = { sector: 1, x: 20, y: 7 };
  test.scope.routeTargetRef.current = latest;
  test.scope.pendingWorldTargetRef.current = { sector: 3, x: 4, y: 8 };
  test.scope.pendingCrossRef.current = "north";
  await test.applyCrossing(landed, {}, test.requested);
  expect(test.scope.routeTargetRef.current).toBe(latest);
  expect(test.scope.pendingCrossRef.current).toBe("north");
  expect(test.scope.routeTowardWorldTarget).not.toHaveBeenCalled();
});

it.each(["before animation", "during animation"])(
  "preserves a click %s of an optimistic border crossing",
  async (timing) => {
    const test = setup();
    let finishWalk = () => {};
    const walk = new Promise<void>((resolve) => {
      finishWalk = resolve;
    });
    test.scope.animateWindowPath.mockImplementation(() => walk);
    test.scope.windowNavRef.current = {
      offsetOf: () => ({ dx: 0, dy: 0 }),
      toUnified: () => ({}),
      pathFinder: { getShortestPath: () => [{}, {}] },
    };
    const latest = { sector: 1, x: 20, y: 7 };
    if (timing === "before animation") test.scope.routeTargetRef.current = latest;
    const crossing = test.handleCrossing(
      Promise.resolve({ success: true, data: landed }),
      { sector: 2, x: 3, y: 5 },
      { x: 25, y: 5 },
      "Field",
      {},
      test.requested,
    );
    if (timing === "during animation") test.scope.routeTargetRef.current = latest;
    finishWalk();
    await crossing;
    expect(test.scope.routeTargetRef.current).toBe(latest);
  },
);

it("does not pre-fire a newly selected border route from the previous move's tile", async () => {
  const test = setup();
  test.scope.routeTargetRef.current = { sector: 1, x: 25, y: 9 };
  test.scope.pendingCrossRef.current = "east";
  test.scope.pendingWorldTargetRef.current = { sector: 2, x: 3, y: 9 };
  await test.runJourneySegment(
    { ...landed, sector: 1, longitude: 25 },
    Promise.resolve(),
    {},
    test.requested,
  );
  expect(test.scope.moveStepAsync).not.toHaveBeenCalled();
  expect(test.scope.pendingCrossRef.current).toBe("east");
});

it("waits for the active move and then routes a queued tile in its selected sector", () => {
  const test = setup();
  const latest = { sector: 2, x: 6, y: 8 };
  test.scope.routeTargetRef.current = latest;
  test.continueMovement();
  expect(test.scope.move).not.toHaveBeenCalled();
  expect(test.scope.routeTowardWorldTarget).not.toHaveBeenCalled();
  test.scope.movePendingRef.current = false;
  test.continueMovement();
  expect(test.scope.move).not.toHaveBeenCalled();
  expect(test.scope.routeTowardWorldTarget).toHaveBeenCalledWith(
    latest,
    { col: 25, row: 5 },
    {},
    1,
    0,
  );
});

it("uses the final world tile when a queued border leg belongs to the previous sector", () => {
  const test = setup();
  test.scope.sectorRef.current = 2;
  test.scope.originRef.current = { col: 3, row: 5 };
  test.scope.pendingWorldTargetRef.current = { sector: 3, x: 4, y: 8 };
  test.scope.movePendingRef.current = false;
  test.continueMovement();
  expect(test.scope.routeTowardWorldTarget).toHaveBeenCalledWith(
    test.scope.pendingWorldTargetRef.current,
    { col: 3, row: 5 },
    {},
    0,
    1,
  );
  expect(test.scope.move).not.toHaveBeenCalled();
});

it("sends the latest same-sector click after the pending request and walk finish", async () => {
  const test = setup();
  let finishWalk = () => {};
  const walk = new Promise<void>((resolve) => {
    finishWalk = resolve;
  });
  test.scope.animateWalk.mockImplementation(() => walk);
  test.scope.continueMovement.mockImplementation(test.continueMovement);
  const scope = {
    ...test.scope,
    useSceneMutation: (options: unknown) => options,
    getMutationKey: () => [],
    api: { travel: { moveInSector: {} } },
    prepareSectorUpdate: () => ({}),
    prepareUserUpdate: () => 1,
    publishMovementStatus: vi.fn(),
    autoAttackRef: { current: vi.fn() },
    updateSector: vi.fn(),
    runJourneySegment: test.runJourneySegment,
    reconcileCrossing: test.reconcileCrossing,
    applyCrossing: test.applyCrossing,
  };
  const controller = evaluate(
    `${block("  const executeMove = useSceneMutation({", "\n\n  const move =")}\nreturn executeMove;`,
    scope,
  ) as {
    onMutate: (input: object) => { walk: Promise<void>; target: Destination | null };
    onSuccess: (result: object, input: object, context: object) => Promise<void>;
    onSettled: () => Promise<void>;
  };
  const input = { sector: 1, longitude: 25, latitude: 5 };
  const context = controller.onMutate(input);
  expect(context.target).toBe(test.requested);
  const completion = controller.onSuccess(
    { success: true, data: { ...landed, ...input } },
    input,
    context,
  );
  test.scope.routeTargetRef.current = { sector: 1, x: 20, y: 6 };
  test.scope.routeTargetRef.current = { sector: 1, x: 19, y: 8 };
  test.continueMovement();
  expect(test.scope.move).not.toHaveBeenCalled();
  finishWalk();
  await completion;
  expect(test.scope.move).not.toHaveBeenCalled();
  await controller.onSettled();
  expect(test.scope.move).toHaveBeenCalledWith({
    from: { x: 25, y: 5 },
    dest: { x: 19, y: 8 },
    sector: 1,
  });
  expect(test.scope.move).toHaveBeenCalledTimes(1);
  expect(test.scope.runQuestTriggers).toHaveBeenCalledWith({ ...landed, ...input });
});

it("reserves a border move and its destination before asynchronous mutation guards run", () => {
  const test = setup();
  test.scope.movePendingRef.current = false;
  test.scope.moveTargetRef.current = null;
  const executeMove = vi.fn(async () => {});
  const move = evaluate(
    `${block("  const move = (input:", "\n\n  /** Step one tile")}\nreturn move;`,
    { ...test.scope, executeMove },
  ) as (input: object) => void;
  move({ longitude: 26, latitude: 5 });
  expect(test.scope.movePendingRef.current).toBe(true);
  expect<Destination | null>(test.scope.moveTargetRef.current).toBe(test.requested);
  test.scope.routeTargetRef.current = { sector: 1, x: 20, y: 7 };
  expect<Destination | null>(test.scope.moveTargetRef.current).toBe(test.requested);
});
