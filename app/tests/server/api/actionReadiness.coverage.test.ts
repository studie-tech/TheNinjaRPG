import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parse } from "@babel/parser";
import type { Node } from "@babel/types";
import { appRouter } from "@/server/api/root";

/**
 * Check application status guards through the registered resolver/helper call graph.
 * This models explicit guard syntax, not arbitrary program execution; input-dependent
 * branches and saved quest requirements also retain their behavioral regression tests.
 */
const sourceRoot = join(import.meta.dirname, "../../../src");
const functionTypes = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
]);
// Keep Bun's runtime resolver typed locally, as in the client-bundle architecture check.
const { resolveSync } = (
  globalThis as unknown as {
    Bun: { resolveSync: (specifier: string, from: string) => string };
  }
).Bun;

// These services settle previously authorized work; their internal status checks do
// not require the caller to wake. Explicit start_battle events are inspected below.
const settlementFunctions = new Set([
  "server/api/routers/profile.ts#fetchUpdatedUser",
  "server/api/routers/profile.ts#fetchUpdatedUserOnce",
  "server/utils/questConsequences.ts#handleQuestConsequences",
  "libs/quest.ts#getNewTrackers",
  "server/utils/kage.ts#syncLockedKageDefense",
]);

// Queue launchers validate participants; travel heartbeats observe already-awake intruders.
// Exempt only these helper guards: adding an actor guard to a launcher still fails.
const participantLaunchers = [
  "territoryWar.startBattle",
  "clan.initiateClanBattle",
  "tournament.manageEvent",
  "shrine.initiateShrineBattle",
  "pvpRank.checkRankedPvpMatches",
  "raids.startRaidBattle",
  "villageDuty.patrol",
];
const participantGuards = new Set([
  "server/api/routers/combat.ts#initiateBattle",
  "server/utils/villageDuty.ts#isVillageDutyIntruder",
  "libs/train.ts#trainingStartBlockMessage",
  "server/api/routers/tournamentEvents.ts#launchEventGame",
]);
const targetOnlyChecks = new Map([
  ["profile.updateUser", "target.status"],
  ["travel.robPlayer", "target.status"],
  ["kage.startDefense", "hall.village.kage.status"],
]);

/** Classify the precise non-actor checks, without exempting a whole mutation body. */
const isParticipantGuard = (path: string, guard: Guard) =>
  (participantLaunchers.includes(path) && participantGuards.has(guard.owner)) ||
  (guard.owner.endsWith(`#${path}`) && guard.status === targetOnlyChecks.get(path));

/** Expected awake-only actions, audited against actor guards in every registered mutation. */
const AWAKE_ACTIONS = new Set([
  "bloodline.roll",
  "clan.leaveClan",
  "clan.fightLeader",
  "clan.challengeClan",
  "clan.joinClanBattle",
  "combat.battleArenaHeal",
  "combat.startArenaBattle",
  "combat.attackUser",
  "combat.startShrineBattle",
  "coop.dungeon.create",
  "farming.plantSeed",
  "farming.waterPlot",
  "farming.applyFertilizer",
  "farming.harvestPlot",
  "farming.plantAllEmpty",
  "farming.waterAll",
  "farming.fertilizeAll",
  "farming.harvestAll",
  "farming.sellCrop",
  "farming.buyShopItem",
  "farming.extractSeeds",
  "hospital.userHeal",
  "hunting.accept",
  "hunting.start",
  "item.evolveItem",
  "item.consumeVariantToken",
  "item.mergeStacks",
  "item.mergeAllStacks",
  "item.consume",
  "item.repair",
  "item.repairAll",
  "item.useRepairItem",
  "item.useRepairAll",
  "jutsu.evolveJutsu",
  "jutsu.startTraining",
  "kage.checkInDefense",
  "kage.startDefense",
  "occupation.craftItem",
  "occupation.imbueItem",
  "overworldAi.interactWithOverworldAi",
  "pets.unlockSlot",
  "pets.activatePet",
  "pets.updateAbilities",
  "pets.feedPet",
  "pets.acquirePet",
  "pets.generateAppearance",
  "pets.releasePet",
  "pets.updatePet",
  "pets.updateAiConfig",
  "pets.assignExperience",
  "pets.rankUp",
  "coop.quest.create",
  "coop.quest.join",
  "coop.quest.startEncounter",
  "quests.startRandom",
  "quests.startPetTask",
  "quests.collectPetTask",
  "quests.checkRewards",
  "quests.retryBattle",
  "pvpRank.queueForRankedPvp",
  "raids.readyToQueue",
  "raids.joinRaidQueue",
  "sageMode.removeSageMode",
  "shrine.challengeShrine",
  "shrine.joinShrineBattle",
  "sparring.acceptChallenge",
  "stealth.activateStealth",
  "stealth.useSensory",
  "stealth.trainCovert",
  "territoryWar.createTeam",
  "territoryWar.joinTeam",
  "tournament.joinMatch",
  "tournament.participateEvent",
  "train.selectTrainedElement",
  "train.startTraining",
  "train.startMasteryTraining",
  "train.stopMasteryTraining",
  "travel.robPlayer",
  "travel.startGlobalMove",
  "travel.moveInSector",
  "village.buyFood",
  "village.leaveVillage",
  "village.joinVillage",
  "village.swapVillage",
  "war.startWarMission",
  "war.completeWarMission",
  "war.attackWarCamp",
]);

// These endpoints have awake-only branches, rather than an unconditional contract.
// Specific quest starts use the saved quest; endpoint SQL tests cover that case.
const conditionalActions = new Set([
  "train.updateEnergyTrainingQueue",
  "train.updateMasteryTrainingQueue",
  "coop.dungeon.act",
  "hunting.sessionAction",
  "profile.useUnusedExperiencePoints",
  "quests.startQuest",
]);

/** Walk parsed syntax, so comments, messages and assignments cannot invent a prerequisite. */
const walk = (value: unknown, inspect: (node: Node) => void) => {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child) => walk(child, inspect));
    return;
  }
  const node = value as Node;
  if (typeof node.type !== "string") return;
  inspect(node);
  for (const [key, child] of Object.entries(node))
    if (
      ![
        "loc",
        "start",
        "end",
        "extra",
        "comments",
        "leadingComments",
        "trailingComments",
        "innerComments",
      ].includes(key)
    )
      walk(child, inspect);
};

/** Reuse Bun's tsconfig/module resolution; external packages aren't application guards. */
const sourceFile = (specifier: string, from: string) => {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return;
  const file = resolveSync(specifier, dirname(from));
  return file.startsWith(`${sourceRoot}/`) && /\.[cm]?[jt]sx?$/.test(file)
    ? file
    : undefined;
};

/** Resolve named helpers through imports/aliases and cache each function's call edges. */
const inspectMutations = (overrides = new Map<string, string>()) => {
  const modules = new Map<string, Module>();
  const load = (file: string): Module => {
    const cached = modules.get(file);
    if (cached) return cached;
    const module: Module = { definitions: new Map(), imports: new Map() };
    modules.set(file, module);
    const ast = parse(overrides.get(file) ?? readFileSync(file, "utf8"), {
      sourceType: "module",
      sourceFilename: file,
      plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
    });
    for (const statement of ast.program.body) {
      if (statement.type === "ImportDeclaration") {
        const target = sourceFile(statement.source.value, file);
        if (target)
          for (const item of statement.specifiers)
            if (item.type === "ImportSpecifier")
              module.imports.set(item.local.name, {
                file: target,
                name:
                  item.imported.type === "Identifier"
                    ? item.imported.name
                    : item.imported.value,
              });
      }
      const declaration =
        statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
      if (declaration?.type === "FunctionDeclaration" && declaration.id)
        module.definitions.set(declaration.id.name, declaration);
      if (declaration?.type === "VariableDeclaration")
        for (const item of declaration.declarations)
          if (item.id.type === "Identifier" && item.init)
            module.definitions.set(item.id.name, item.init);
    }
    return module;
  };
  const lookup = (file: string, name: string): Definition | undefined => {
    const module = load(file);
    const node = module.definitions.get(name);
    if (node)
      return node.type === "Identifier"
        ? lookup(file, node.name)
        : { file, name, node };
    const imported = module.imports.get(name);
    return imported && lookup(imported.file, imported.name);
  };
  const mutations = new Map<string, Definition>();
  const router = (definition: Definition, path: string) => {
    const { file, node } = definition;
    if (node.type === "Identifier") {
      const target = lookup(file, node.name);
      if (target) router(target, path);
    } else if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      node.callee.property.type === "Identifier" &&
      node.callee.property.name === "mutation"
    ) {
      const handler = node.arguments[0];
      if (handler?.type === "Identifier") {
        const target = lookup(file, handler.name);
        if (target) mutations.set(path, target);
      } else if (handler && functionTypes.has(handler.type))
        mutations.set(path, { file, node: handler, name: path });
    } else if (
      node.type === "CallExpression" &&
      node.arguments[0]?.type === "ObjectExpression"
    ) {
      router({ ...definition, node: node.arguments[0] }, path);
    } else if (node.type === "ObjectExpression")
      for (const property of node.properties) {
        if (property.type === "ObjectProperty" && !property.computed) {
          const name =
            property.key.type === "Identifier"
              ? property.key.name
              : property.key.type === "StringLiteral"
                ? property.key.value
                : undefined;
          if (name)
            router(
              { file, node: property.value, name },
              [path, name].filter(Boolean).join("."),
            );
        } else if (property.type === "SpreadElement")
          router({ file, node: property.argument, name: path }, path);
      }
  };
  router(lookup(join(sourceRoot, "server/api/root.ts"), "appRouter")!, "");

  const graph = new Map<Node, { guards: Guard[]; calls: Node[] }>();
  const scan = (definition: Definition): Node => {
    const { file, node, name } = definition;
    if (graph.has(node)) return node;
    const owner = `${relative(sourceRoot, file)}#${name}`;
    const entry = { guards: [] as Guard[], calls: [] as Node[] };
    graph.set(node, entry);
    walk(node, (child) => {
      const status = awakeStatusCheck(child);
      if (status) entry.guards.push({ owner, status });
      if (child.type !== "CallExpression") return;
      const callee =
        child.callee.type === "Identifier"
          ? lookup(file, child.callee.name)
          : undefined;
      // The pure plan is the actor guard itself. Its implementation must not make
      // every helper that forwards an optional plan look like an awake-only action.
      if (callee?.name === "prepareActionReadiness") {
        entry.guards.push({ owner, status: "actor.status", kind: "prepare" });
        return;
      }
      // Pure projections cannot establish mutation-phase recovery composition.
      if (
        !["actionReadinessResponse", "farmingQuestStateAfterClaim"].includes(
          callee?.name ?? "",
        )
      ) {
        let composesRecovery = false;
        walk(child, (part) => {
          if (
            part.type === "ObjectProperty" &&
            part.key.type === "Identifier" &&
            ["readiness", "actionReadiness", "actionUserId"].includes(part.key.name)
          )
            composesRecovery = true;
          if (
            part.type === "Identifier" &&
            part.name === "readiness" &&
            child.arguments.includes(part)
          )
            composesRecovery = true;
          if (
            part.type === "MemberExpression" &&
            part.object.type === "Identifier" &&
            part.object.name === "readiness" &&
            part.property.type === "Identifier" &&
            ["set", "where"].includes(part.property.name)
          )
            composesRecovery = true;
        });
        if (composesRecovery) entry.guards.push({ owner, status: "", kind: "write" });
      }
      for (const reference of [child.callee, ...child.arguments]) {
        if (reference.type !== "Identifier") continue;
        const target = lookup(file, reference.name);
        if (
          !target ||
          !functionTypes.has(target.node.type) ||
          /\/(queries|deltas)\//.test(target.file)
        )
          continue;
        const targetOwner = `${relative(sourceRoot, target.file)}#${target.name}`;
        // Only explicit quest battle events require waking; ordinary tracker settlement doesn't.
        const explicitBattle =
          targetOwner === "libs/quest.ts#getNewTrackers" &&
          child.arguments.some((argument) => {
            let startsBattle = false;
            walk(argument, (part) => {
              if (
                part.type === "ObjectProperty" &&
                part.key.type === "Identifier" &&
                part.key.name === "task" &&
                part.value.type === "StringLiteral" &&
                part.value.value === "start_battle"
              )
                startsBattle = true;
            });
            return startsBattle;
          });
        if (
          target.name !== "prepareActionReadiness" &&
          (!settlementFunctions.has(targetOwner) || explicitBattle)
        )
          entry.calls.push(scan(target));
      }
    });
    return node;
  };
  const guards = (node: Node, seen = new Set<Node>()): Guard[] => {
    if (seen.has(node)) return [];
    seen.add(node);
    const entry = graph.get(node)!;
    return [...entry.guards, ...entry.calls.flatMap((call) => guards(call, seen))];
  };
  return new Map(
    [...mutations].map(([path, definition]) => [path, guards(scan(definition))]),
  );
};

/** Recognize status comparisons, singleton includes checks and atomic SQL awake predicates. */
const awakeStatusCheck = (node: Node): string | undefined => {
  const memberName = (value: Node): string | undefined => {
    if (value.type === "Identifier") return value.name;
    // Actor projections leave the other participant in the conditional's fallback.
    if (value.type === "ConditionalExpression") return memberName(value.alternate);
    if (
      (value.type === "MemberExpression" ||
        value.type === "OptionalMemberExpression") &&
      !value.computed &&
      value.property.type === "Identifier"
    ) {
      const parent = memberName(value.object);
      return parent && `${parent}.${value.property.name}`;
    }
  };
  const statusName = (value: Node): string | undefined => {
    const name = memberName(value);
    return name === "status" || name?.endsWith(".status") ? name : undefined;
  };
  const awake = (value: Node) =>
    value.type === "StringLiteral" && value.value === "AWAKE";
  const awakeArray = (value: Node) =>
    value.type === "ArrayExpression" &&
    value.elements.length > 0 &&
    value.elements.every(
      (entry) => entry?.type === "StringLiteral" && entry.value === "AWAKE",
    );
  if (
    node.type === "BinaryExpression" &&
    ["===", "!==", "==", "!="].includes(node.operator)
  )
    return awake(node.left)
      ? statusName(node.right)
      : awake(node.right)
        ? statusName(node.left)
        : undefined;
  if (node.type !== "CallExpression") return;
  const first = node.arguments[0];
  const second = node.arguments[1];
  if (
    first &&
    node.callee.type === "MemberExpression" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "includes" &&
    awakeArray(node.callee.object)
  )
    return statusName(first);
  if (
    first &&
    second &&
    node.callee.type === "Identifier" &&
    ((node.callee.name === "eq" && awake(second)) ||
      (node.callee.name === "inArray" && awakeArray(second)))
  )
    return statusName(first);
};

/** Compare source-derived actor prerequisites in both directions, not a second endpoint list. */
const policyDrift = (mutations: Map<string, Guard[]>, policy = AWAKE_ACTIONS) => {
  const required = new Set(
    [...mutations]
      .filter(
        ([path, guards]) =>
          guards.some(
            (guard) => guard.kind !== "write" && !isParticipantGuard(path, guard),
          ) && !conditionalActions.has(path),
      )
      .map(([path]) => path),
  );
  return {
    missing: [...required].filter((path) => !policy.has(path)).sort(),
    stale: [...policy].filter((path) => !required.has(path)).sort(),
  };
};

/** Every explicit recovery entry point must prepare locally and compose a plan into a write. */
const localReadinessDrift = (mutations: Map<string, Guard[]>) =>
  [...AWAKE_ACTIONS, ...conditionalActions]
    .filter((path) => {
      const guards = mutations.get(path) ?? [];
      return (
        !guards.some((guard) => guard.kind === "prepare") ||
        !guards.some(
          (guard) => guard.kind === "write" && guard.owner.endsWith(`#${path}`),
        )
      );
    })
    .sort();

describe("mutation awake prerequisites", () => {
  const mutations = inspectMutations();

  it("inspects every registered mutation, including nested and spread routers", () => {
    const procedures = appRouter._def.procedures as unknown as Record<
      string,
      { _def: { type: string } }
    >;
    const registered = Object.entries(procedures)
      .filter(([, procedure]) => procedure._def.type === "mutation")
      .map(([path]) => path)
      .sort();
    expect([...mutations.keys()].sort()).toEqual(registered);
  });

  it("keeps automatic recovery aligned with actual actor prerequisites in both directions", () => {
    expect(policyDrift(mutations)).toEqual({ missing: [], stale: [] });
  });

  it("keeps conditional and participant-only exceptions tied to live awake checks", () => {
    for (const path of conditionalActions) {
      expect(
        mutations
          .get(path)
          ?.some((guard) => guard.kind !== "write" && !isParticipantGuard(path, guard)),
        path,
      ).toBe(true);
      expect(AWAKE_ACTIONS.has(path), path).toBe(false);
    }
    for (const path of [...participantLaunchers, ...targetOnlyChecks.keys()])
      expect(
        mutations.get(path)?.some((guard) => isParticipantGuard(path, guard)),
        path,
      ).toBe(true);
  });

  it("detects removing a required registration and adding an unrelated one", () => {
    const changed = new Set(AWAKE_ACTIONS);
    changed.delete("farming.waterPlot");
    changed.add("bank.deposit");
    expect(policyDrift(mutations, changed)).toEqual({
      missing: ["farming.waterPlot"],
      stale: ["bank.deposit"],
    });
  });

  it("requires an explicit local plan and write composition for each actor action", () => {
    expect(localReadinessDrift(mutations)).toEqual([]);
  });

  it("detects removing endpoint preparation or its mutation-phase composition", () => {
    const file = join(sourceRoot, "server/api/routers/farming.ts");
    const source = readFileSync(file, "utf8");
    const start = source.indexOf("  waterPlot: protectedProcedure");
    const end = source.indexOf("  applyFertilizer: protectedProcedure", start);
    const endpoint = source.slice(start, end);
    const withoutPlan =
      source.slice(0, start) +
      endpoint.replace("prepareActionReadiness(", "unchangedUser(") +
      source.slice(end);
    expect(
      localReadinessDrift(inspectMutations(new Map([[file, withoutPlan]]))),
    ).toContain("farming.waterPlot");
    const withoutWrite =
      source.slice(0, start) +
      endpoint.replace(/\n\s*readiness,\n/, "\n        undefined,\n") +
      source.slice(end);
    expect(
      localReadinessDrift(inspectMutations(new Map([[file, withoutWrite]]))),
    ).toContain("farming.waterPlot");
  });

  it("keeps recovery out of tRPC and the global mutation provider", () => {
    for (const file of ["server/api/trpc.ts", "app/_trpc/Provider.tsx"]) {
      const source = readFileSync(join(sourceRoot, file), "utf8");
      expect(source).not.toMatch(
        /fetchActionReadiness|prepareCharacterForAction|prepareActionReadiness|prepareActionFeedback|finishActionFeedback/,
      );
    }
  });

  it("detects an awake requirement introduced by a new mutation", () => {
    const file = join(sourceRoot, "server/api/routers/bank.ts");
    const source = readFileSync(file, "utf8").replace(
      "createTRPCRouter({",
      `createTRPCRouter({
      policyDriftProbe: protectedProcedure.mutation(async ({ctx}) => {
        const {user} = await fetchUpdatedUser({client:ctx.drizzle, userId:ctx.userId});
        if (user && user.status !== "AWAKE") return errorResponse("Must be awake");
        return {success:true, message:"OK"};
      }),`,
    );
    expect(policyDrift(inspectMutations(new Map([[file, source]]))).missing).toEqual([
      "bank.policyDriftProbe",
    ]);
  });

  it("does not exempt a new actor guard merely because the endpoint checks another player", () => {
    const file = join(sourceRoot, "server/api/routers/profile.ts");
    const source = readFileSync(file, "utf8").replace(
      'if (target.status !== "AWAKE")',
      'if (user.status !== "AWAKE")',
    );
    expect(policyDrift(inspectMutations(new Map([[file, source]]))).missing).toEqual([
      "profile.updateUser",
    ]);
  });
});

type Definition = { file: string; name: string; node: Node };
type Guard = { owner: string; status: string; kind?: "prepare" | "write" };
type Module = {
  definitions: Map<string, Node>;
  imports: Map<string, { file: string; name: string }>;
};
