import { describe, expect, it, vi } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import reactCompiler, { type LoggerEvent } from "babel-plugin-react-compiler";
import * as React from "react";
import {
  STEALTH_SENSORY_CAP,
  STEALTH_TRAIN_GAIN_PER_MINUTE,
} from "@/drizzle/constants";
import { useLiveCountdown } from "@/hooks/useLiveCountdown";
import {
  calcStealthDuration,
  getRemainingSensoryCooldown,
  getStealthStatus,
} from "@/libs/stealth";
import { selectUserWithoutPosition } from "@/utils/UserContext";

const require = createRequire(import.meta.url);
const { c } = require("react/compiler-runtime") as { c: (size: number) => unknown[] };

const targets = [
  ["layout/MenuBoxProfile.tsx", ["MenuBoxProfile", "useSecondsUntil"]],
  ["layout/Countdown.tsx", ["Countdown"]],
  ["layout/LowerRightHelpBtn.tsx", ["LowerRightHelpBtn"]],
  [
    "layout/GameSettings.tsx",
    ["GameSettingsContent", "GameSettingsPanel", "GameSettingsPopover"],
  ],
  ["layout/TutorialSettings.tsx", ["TutorialSettings"]],
  ["components/layout/shared/LayoutNotifications.tsx", ["MobileNotificationsPopover"]],
  ["hooks/tutorial.tsx", ["useTutorialStep"]],
  ["layout/TutorialAssistant.tsx", ["PlayerTutorialAssistant"]],
  ["app/[shell]/items/page.tsx", ["MyItems"]],
  ["layout/items/ItemsWorkspace.tsx", ["ItemsWorkspace"]],
  ["layout/items/EquipmentFigure.tsx", ["EquipmentFigure"]],
  ["layout/items/BackpackList.tsx", ["BackpackList"]],
  ["layout/items/ItemInspector.tsx", ["ItemInspector"]],
  ["layout/items/SlotPicker.tsx", ["SlotPicker"]],
  ["layout/items/ItemsToolbar.tsx", ["ItemsToolbar"]],
  ["app/[shell]/travel/page.tsx", ["StealthControls"]],
  ["app/[shell]/profile/experience/page.tsx", ["AssignExperience"]],
  ["app/[shell]/village/page.tsx", ["VillageOverview"]],
  ["app/[shell]/battlearena/page.tsx", ["Arena"]],
  ["layout/battlearena/ArenaOverview.tsx", ["ArenaOverview", "ModeCard"]],
  ["layout/battlearena/ArenaModeShell.tsx", ["ArenaModeShell"]],
  [
    "layout/battlearena/BattleSetupPanel.tsx",
    ["BattleSetupPanel", "BattleSetupControls"],
  ],
  ["layout/battlearena/ArenaMode.tsx", ["ArenaMode", "OpponentDetails"]],
  ["layout/battlearena/SparringMode.tsx", ["SparringMode", "OptionCheckbox"]],
  ["layout/battlearena/OpponentFinder.tsx", ["OpponentFinder", "FilterChip"]],
  ["layout/battlearena/TrainingMode.tsx", ["TrainingMode"]],
  ["layout/battlearena/RankedMode.tsx", ["RankedMode"]],
  ["layout/battlearena/PyramidMode.tsx", ["PyramidMode", "TowerHeading"]],
] as const;

// Functions the compiler still skips, as "path#function". Fix one and remove it here.
const compilerExceptions = [
  "app/[shell]/battlelog/[battleid]/page.tsx#BattleLog",
  "app/[shell]/error.tsx#ErrorBoundary",
  "app/[shell]/forum/[boardid]/[threadid]/thread.tsx#ForumPost",
  "app/[shell]/forum/[boardid]/[threadid]/thread.tsx#Thread",
  "app/[shell]/forum/manage/page.tsx#ForumRestrictions",
  "app/[shell]/forum/manage/page.tsx#ForumStaff",
  "app/[shell]/forum/manage/page.tsx#RemoveStructure",
  "app/[shell]/manual/damage_calcs/[[...damageSimulationId]]/page.tsx#Simulator",
  "app/[shell]/manual/item/edit/[itemid]/page.tsx#ItemVariantsEditor",
  "app/[shell]/manual/staff/page.tsx#Staff",
  "app/[shell]/manual/world/sector-maps/page.tsx#SectorMapEditorContent",
  "app/[shell]/manual/world/tilesets/edit/[assetid]/page.tsx#SingleEditMapAsset",
  "app/[shell]/manual/world/tilesets/terrain/edit/[terrainid]/page.tsx#SingleEditMapTerrain",
  "app/[shell]/support/page.tsx#SupportPage",
  "app/[shell]/travel/page.tsx#Travel",
  "components/merch/MerchProvider.tsx#MerchProvider",
  "components/native/DeviceSettings.tsx#DeviceSettings",
  "components/native/NativeAccountDeletion.tsx#NativeAccountDeletion",
  "components/native/NativeBridge.tsx#NativeBridge",
  "components/native/NativeStore.tsx#NativeStore",
  "components/pwa/PWAManager.tsx#PWAManager",
  "components/ui/number-input.tsx#NumberInput",
  "hooks/combat.ts#useBattleMaps",
  "hooks/combat.ts#useCombatUpdates",
  "hooks/combatTabs.ts#useCombatTabs",
  "hooks/contentSubmit.ts#useContentSubmit",
  "hooks/farm-controller.ts#useFarmController",
  "hooks/game-scene.ts#useGameScene",
  "hooks/useActionPreferenceCacheUpdate.ts#useActionPreferenceCacheUpdate",
  "hooks/useBattleCacheUpdate.ts#useBattleCacheUpdate",
  "hooks/useDungeonAvailability.ts#useDungeonAvailability",
  "hooks/useLazyChart.ts#useLazyChart",
  "hooks/useLiveActivity.ts#useLiveActivity",
  "hooks/useNativeAuth.ts#useNativeAuth",
  "hooks/useNativePush.ts#useNativePush",
  "hooks/usePendingIds.ts#usePendingIds",
  "hooks/usePublicQuestLocations.ts#usePublicQuestLocations",
  "hooks/useSceneMutation.ts#useSceneMutation",
  "hooks/useSingleFlight.ts#useSingleFlight",
  "hooks/useTowerDefense.ts#useTowerDefense",
  "layout/BloodlineStatistics.tsx#BloodlineRollChart",
  "layout/CharacterPreview.tsx#CharacterPreview",
  "layout/ChatConversation.tsx#ChatConversation",
  "layout/Combat.tsx#Combat",
  "layout/CombatActions.tsx#ActionSelector",
  "layout/CombatResultScreen.tsx#CombatResultScreen",
  "layout/CombatTargetPreview.tsx#TargetingBattlefield",
  "layout/ConceptImage.tsx#ConceptImage",
  "layout/ContentImageSelector.tsx#ContentImageSelector",
  "layout/CoordinateTargetingEditor.tsx#CoordinateTargetingEditor",
  "layout/EmbeddedConceptArt.tsx#EmbeddedConceptArt",
  "layout/FarmCanvas.tsx#FarmCanvasInner",
  "layout/Forum.tsx#ForumComposer",
  "layout/ForumModeration.tsx#ForumRestructureTools",
  "layout/ForumModeration.tsx#ForumTopicTools",
  "layout/ForumPoll.tsx#ForumTopicExtras",
  "layout/GraphUsersGeneric.tsx#GraphUsersGeneric",
  "layout/HistoricalAiAvatar.tsx#HistoricalAiAvatar",
  "layout/HomeLanding.tsx#HomeLanding",
  "layout/HomeSharing.tsx#HomeSharing",
  "layout/JutsuLoadoutSharing.tsx#JutsuLoadoutSharingDialog",
  "layout/LpcAssetEditor.tsx#LpcAssetEditor",
  "layout/MassEffectEditor.tsx#MassEffectEditor",
  "layout/MissionHall.tsx#MissionHall",
  "layout/ModerationSummary.tsx#ModerationSummary",
  "layout/NewConversationPrompt.tsx#NewConversationPrompt",
  "layout/OccupationCrafting.tsx#OccupationCrafting",
  "layout/PetAcquisition.tsx#PetAcquisition",
  "layout/PetProfile.tsx#PetProfile",
  "layout/ProfileSharing.tsx#ReviewPromotionAction",
  "layout/PublicUser.tsx#PublicUserComponent",
  "layout/PublicUserEdit.tsx#DeleteUserQuestControl",
  "layout/PublicUserEdit.tsx#EditUserComponent",
  "layout/PvpRank.tsx#RankedLoadoutSelector",
  "layout/Report.tsx#ReportUser",
  "layout/RichInput.tsx#RichInput",
  "layout/SearchSelect.tsx#SearchSelect",
  "layout/SeasonForm.tsx#SeasonForm",
  "layout/SeasonManager.tsx#SeasonManager",
  "layout/Sector.tsx#SectorScene",
  "layout/SectorPreview.tsx#SectorPreview",
  "layout/ShrineBattleLobby.tsx#ShrineBattleLobby",
  "layout/ShrineHall.tsx#BoostTemplateGrid",
  "layout/StrengthWeaknesses.tsx#GraphsTab",
  "layout/TowerDefense.tsx#TowerDefenseInner",
  "layout/UsageStatistics.tsx#QuestFunnelBar",
  "layout/clan/ClanBattles.tsx#ClanBattles",
  "layout/clan/ClanMembers.tsx#ClanMembers",
  "layout/profileEdit/AttributeChange.tsx#AttributeChange",
  "layout/profileEdit/Marriage.tsx#Marriage",
  "layout/publicUser/BadgesTab.tsx#BadgesTab",
  "utils/UserContext.tsx#UserContextProvider",
  "utils/UserContext.tsx#useUserDataRef",
];

describe("React Compiler coverage", () => {
  for (const [path, names] of targets) {
    it(`memoizes ${names.join(", ")}`, () => {
      const source = readFileSync(
        new URL(`../../src/${path}`, import.meta.url),
        "utf8",
      );
      const { compiled } = compile(source, path);
      for (const name of names) expect(compiled).toContain(name);
    });
  }
});

describe("React Compiler repository gate", () => {
  it(
    "compiles every client component and hook outside the known exceptions",
    () => {
      const failures = new Set<string>();
      for (const path of clientModules()) {
        const source = readFileSync(
          new URL(`../../src/${path}`, import.meta.url),
          "utf8",
        );
        for (const name of compile(source, path).failed)
          failures.add(`${path}#${name}`);
      }
      const allowed = new Set<string>(compilerExceptions);
      expect([...failures].filter((entry) => !allowed.has(entry)).sort()).toEqual([]);
      // A fixed function must leave the list so it cannot silently regress.
      expect([...allowed].filter((entry) => !failures.has(entry)).sort()).toEqual([]);
    },
    { timeout: 180_000 },
  );
});

describe("React Compiler runtime", () => {
  it.each(["const Component = () => null;", "const ="])(
    "preserves stack capture after compiling %s",
    (source) => {
      const { prepareStackTrace, stackTraceLimit } = Error;
      if (source === "const =")
        expect(() => compile(source, "component.tsx")).toThrow();
      else compile(source, "component.tsx");
      expect(Error.prepareStackTrace).toBe(prepareStackTrace);
      expect(Error.stackTraceLimit).toBe(stackTraceLimit);
      // mysql2 captures its caller into a plain object before any database operation.
      expect(() => Error.captureStackTrace({})).not.toThrow();
    },
  );

  it("updates compiled stealth visibility and activation after natural expiry", () => {
    const source = readFileSync(
      new URL("../../src/app/[shell]/travel/page.tsx", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("const StealthControls:");
    const end = source.indexOf("\n/**\n * Revealed Player Card", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const { code, compiled } = compile(source.slice(start, end), "travel.tsx");
    expect(compiled).toContain("StealthControls");
    const transpiler = new (require("bun").Transpiler)({
      loader: "tsx",
      tsconfig: { compilerOptions: { jsx: "react" } },
    }) as { transformSync(source: string): string };
    const executable = transpiler
      .transformSync(code)
      .replace(/^import .* from "react\/compiler-runtime";\n/m, "");
    const activate = vi.fn();
    const deactivate = vi.fn();
    const mutation = (mutate = vi.fn()) => ({
      useMutation: () => ({ mutate, isPending: false }),
    });
    const passthrough = ({ children }: { children: React.ReactNode }) => children;
    const base = Date.UTC(2026, 9, 26, 12);
    let now = base;
    const user = {
      sector: 1,
      stealth: 1000,
      sensory: 1000,
      stealthActive: true,
      stealthActivatedAt: new Date(base - (calcStealthDuration(1000) - 2) * 1000),
      stealthCooldownAt: null,
      lastSensoryAt: null,
      covertTrainingType: null,
      covertTrainingStartedAt: null,
      covertTrainingMinutes: null,
    };
    const utils = {};
    const scope = {
      React,
      _c: c,
      useRef: React.useRef,
      useState: React.useState,
      useRequiredUserDataSelector: (select: (user: never) => unknown) => ({
        data: select(user as never),
        timeDiff: 0,
        updateUser: vi.fn(),
      }),
      selectUserWithoutPosition,
      api: {
        useUtils: () => utils,
        stealth: {
          activateStealth: mutation(activate),
          deactivateStealth: mutation(deactivate),
        },
      },
      activateSensory: mutation(),
      useLiveCountdown,
      getStealthStatus,
      getRemainingSensoryCooldown,
      STEALTH_SENSORY_CAP,
      STEALTH_TRAIN_GAIN_PER_MINUTE,
      showMutationToast: vi.fn(),
      TooltipProvider: passthrough,
      Tooltip: passthrough,
      TooltipContent: "span",
      TooltipTrigger: ({
        asChild,
        children,
        ...props
      }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) =>
        asChild ? children : React.createElement("button", props, children),
      Ghost: "svg",
      Radar: "svg",
      Loader2: "svg",
    };
    const StealthControls = new Function(
      "scope",
      `with (scope) { ${executable}; return StealthControls; }`,
    )(scope) as React.FC<{ onRevealed: () => void }>;
    vi.useFakeTimers();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const view = render(
        React.createElement(StealthControls, { onRevealed: vi.fn() }),
      );
      expect(view.getByRole("button", { name: "Deactivate stealth" })).toBeTruthy();
      expect(view.getByText("Stealth Active (2s remaining)")).toBeTruthy();
      now += 2000;
      act(() => vi.advanceTimersByTime(2000));
      expect(view.queryByText(/Stealth Active/)).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Activate stealth" }));
      expect(activate).toHaveBeenCalledTimes(1);
      expect(deactivate).not.toHaveBeenCalled();
    } finally {
      cleanup();
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});

function compile(source: string, path: string) {
  const { prepareStackTrace, stackTraceLimit } = Error;
  try {
    // Next's lazy Babel initialization replaces process-wide stack formatting in Bun.
    const { transformSync, parseSync } = require("next/dist/compiled/babel/core") as {
      transformSync: (source: string, options: unknown) => { code: string };
      parseSync: (source: string, options: unknown) => unknown;
    };
    const events: LoggerEvent[] = [];
    const parserOptions = {
      filename: path,
      configFile: false,
      babelrc: false,
      parserOpts: { plugins: ["typescript", "jsx"] },
    };
    const functionNames = collectFunctionNames(parseSync(source, parserOptions));
    // Next uses the compiler defaults; a skipped function still produces valid JS.
    // Assert successes by name so unrelated functions and line shifts do not hide regressions.
    const { code } = transformSync(source, {
      ...parserOptions,
      plugins: [
        [
          reactCompiler,
          {
            logger: {
              logEvent: (_filename: string | null, event: LoggerEvent) =>
                events.push(event),
            },
          },
        ],
      ],
    });
    const nameOf = (event: LoggerEvent) => {
      const loc = "fnLoc" in event ? event.fnLoc : undefined;
      return (
        ("fnName" in event ? event.fnName : undefined) ??
        functionNames.get(`${loc?.start.line}:${loc?.start.column}`) ??
        "<anonymous>"
      );
    };
    const compiled = events.flatMap((event) =>
      event.kind === "CompileSuccess" ? [nameOf(event)] : [],
    );
    const failed = [
      ...new Set(
        events.flatMap((event) =>
          event.kind === "CompileError" ? [nameOf(event)] : [],
        ),
      ),
    ];
    return { code, compiled, failed };
  } finally {
    // Assignment preserves Bun's native plain-object capture; redefining descriptors does not.
    Error.prepareStackTrace = prepareStackTrace;
    Error.stackTraceLimit = stackTraceLimit;
  }
}

/** Source modules that can hold components or hooks; server code never renders. */
function clientModules() {
  const root = fileURLToPath(new URL("../../src/", import.meta.url));
  return globSync("**/*.{ts,tsx}", { cwd: root })
    .filter((path) => !path.startsWith("server/") && !path.includes("/api/"))
    .filter((path) => /\buse[A-Z]\w*\(|<[A-Z]/.test(readFileSync(root + path, "utf8")))
    .sort();
}

/** Compiler events omit the binding name for arrow functions. Match their original AST locations. */
function collectFunctionNames(ast: unknown) {
  const names = new Map<string, string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const node = value as {
      type?: string;
      id?: { name?: string };
      loc?: { start: { line: number; column: number } };
      init?: { loc?: { start: { line: number; column: number } } };
    };
    if (node.type === "VariableDeclarator" && node.id?.name && node.init?.loc) {
      const { line, column } = node.init.loc.start;
      names.set(`${line}:${column}`, node.id.name);
    }
    if (
      (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") &&
      node.id?.name &&
      node.loc
    ) {
      const { line, column } = node.loc.start;
      names.set(`${line}:${column}`, node.id.name);
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(ast);
  return names;
}
