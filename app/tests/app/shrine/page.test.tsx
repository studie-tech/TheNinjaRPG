import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import Shrine from "@/app/[shell]/shrine/page";
import * as client from "@/app/_trpc/client";
import type { RouterOutputs } from "@/app/_trpc/client";
import { MAP_RESERVED_SECTORS, VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import * as contentBox from "@/layout/ContentBox";
import * as countdown from "@/layout/Countdown";
import * as ramen from "@/layout/RamenShop";
import * as warField from "@/layout/WarFieldActions";
import * as userContext from "@/utils/UserContext";
import { defaultWarRules } from "@/validators/war";

type SectorData = RouterOutputs["travel"]["getSectorData"];
type ShrineBattle = RouterOutputs["shrine"]["getShrineBattles"][number];
const challenge = vi.fn();
const join = vi.fn();
const attack = vi.fn();
let villageId: string | null;
let sideVillageId: string | null;
let sectorNumber: number;
let sectorData: SectorData;
let battles: ShrineBattle[];

beforeEach(() => {
  vi.clearAllMocks();
  villageId = "neutral";
  sideVillageId = "attacker";
  sectorNumber = 101;
  battles = [];
  sectorData = {
    sectorData: {
      villageId: "defender",
      shrineLevel: 1,
      village: { name: "Defender" },
    },
    village: null,
    warData: [
      {
        id: "war",
        type: "VILLAGE_WAR",
        status: "ACTIVE",
        attackerVillageId: "attacker",
        defenderVillageId: "defender",
        attackerVillage: { name: "Attacker", sector: 100, villageGraphic: "/a.png" },
        defenderVillage: { name: "Defender", sector: 200, villageGraphic: "/b.png" },
        attackerShrineHp: 500,
        attackerShrineMaxHp: 1000,
        defenderShrineHp: 500,
        defenderShrineMaxHp: 1000,
        rules: defaultWarRules,
        objectiveState: {
          attackerEspionage: 100,
          defenderEspionage: 100,
          objectives: [{ sector: 101, villageId: "defender", destroyed: false }],
        },
        warAllies: [],
        warMercenaries: [],
      },
    ],
  } as unknown as SectorData;
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(userContext, "useRequiredUserData").mockImplementation(
    () =>
      ({
        data: { userId: "viewer", villageId, sector: sectorNumber, status: "AWAKE" },
      }) as never,
  );
  vi.spyOn(contentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(ramen, "default").mockReturnValue(null);
  vi.spyOn(warField, "WarFieldActions").mockReturnValue(null);
  vi.spyOn(countdown, "default").mockReturnValue(null);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    travel: { getSectorData: { useQuery: () => ({ data: sectorData }) } },
    combat: { startShrineBattle: { useMutation: () => ({ mutate: attack }) } },
    raids: { getAvailableRaids: { useQuery: () => ({ data: { raids: [] } }) } },
    shrine: {
      getUserQueuedShrineBattle: { useQuery: () => ({ data: null }) },
      getShrineBattles: { useQuery: () => ({ data: battles }) },
      challengeShrine: { useMutation: () => ({ mutate: challenge }) },
      joinShrineBattle: { useMutation: () => ({ mutate: join }) },
      leaveShrineBattle: { useMutation: () => ({ mutate: vi.fn() }) },
      initiateShrineBattle: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mount = () => {
  const war = sectorData.warData![0]!;
  war.warMercenaries = sideVillageId
    ? [
        { userId: "viewer", sideVillageId } as NonNullable<
          typeof war.warMercenaries
        >[number],
      ]
    : [];
  return render(<Shrine />);
};

const queuedBattle = (viewerSide: "ATTACKER" | "DEFENDER") => {
  battles = [
    {
      id: "party",
      createdAt: new Date(),
      queue: [],
      viewerSide,
    } as unknown as ShrineBattle,
  ];
};

describe("shrine page war affiliation", () => {
  for (const affiliation of ["neutral", VILLAGE_SYNDICATE_ID, null]) {
    for (const side of ["attacker", "defender"] as const) {
      it(`lets a hired ${affiliation} player join the ${side} party`, () => {
        villageId = affiliation;
        sideVillageId = side;
        queuedBattle(side === "attacker" ? "ATTACKER" : "DEFENDER");
        const view = mount();
        expect(Boolean(view.queryByText("No village found"))).toBe(false);
        fireEvent.click(
          view.getByRole("button", {
            name: side === "attacker" ? "Join Attack" : "Defend",
          }),
        );
        expect(join).toHaveBeenCalledWith({
          shrineBattleId: "party",
          side: side === "attacker" ? "ATTACKER" : "DEFENDER",
        });
        expect(
          Boolean(view.queryByRole("button", { name: "Create Shrine Attack Party" })),
        ).toBe(side === "attacker");
      });
    }
  }

  it("lets a hired attacker create a shrine party", () => {
    const view = mount();
    fireEvent.click(view.getByRole("button", { name: "Create Shrine Attack Party" }));
    expect(challenge).toHaveBeenCalledWith({ sectorNumber: 101 });
  });

  describe("on a reserved sector", () => {
    const reserved = MAP_RESERVED_SECTORS[0]!;
    const objectiveOn = (sector: number) => {
      sectorNumber = reserved;
      const war = sectorData.warData![0]!;
      Object.assign(war, {
        attackerWarHealth: 100,
        defenderWarHealth: 100,
        combatStartedAt: new Date(Date.now() - 3600000),
      });
      war.objectiveState!.objectives = [
        { sector, villageId: "defender", destroyed: false },
      ] as NonNullable<typeof war.objectiveState>["objectives"];
    };

    it("opens an enemy objective to attackers", () => {
      objectiveOn(reserved);
      const view = mount();
      fireEvent.click(view.getByRole("button", { name: "Create Shrine Attack Party" }));
      expect(challenge).toHaveBeenCalledWith({ sectorNumber: reserved });
      expect(view.queryByText("This sector is reserved and cannot be attacked.")).toBe(
        null,
      );
    });

    it("stays protected outside an objective", () => {
      objectiveOn(101);
      const view = mount();
      expect(
        view.queryByRole("button", { name: "Create Shrine Attack Party" }),
      ).toBe(null);
      expect(
        view.queryAllByText("This sector is reserved and cannot be attacked.").length,
      ).toBeGreaterThan(0);
    });
  });

  it.each(["attacker", "defender"])("preserves native %s party controls", (side) => {
    villageId = side;
    sideVillageId = null;
    queuedBattle(side === "attacker" ? "ATTACKER" : "DEFENDER");
    const view = mount();
    fireEvent.click(
      view.getByRole("button", {
        name: side === "attacker" ? "Join Attack" : "Defend",
      }),
    );
    expect(join).toHaveBeenCalledWith({
      shrineBattleId: "party",
      side: side === "attacker" ? "ATTACKER" : "DEFENDER",
    });
  });

  it.each(["attacker", "defender"])("preserves an ally's %s party controls", (side) => {
    sideVillageId = null;
    sectorData.warData![0]!.warAllies = [
      { villageId: "neutral", supportVillageId: side } as NonNullable<
        NonNullable<SectorData["warData"]>[number]["warAllies"]
      >[number],
    ];
    queuedBattle(side === "attacker" ? "ATTACKER" : "DEFENDER");
    const view = mount();
    fireEvent.click(
      view.getByRole("button", {
        name: side === "attacker" ? "Join Attack" : "Defend",
      }),
    );
    expect(join).toHaveBeenCalledWith({
      shrineBattleId: "party",
      side: side === "attacker" ? "ATTACKER" : "DEFENDER",
    });
    expect(
      Boolean(view.queryByRole("button", { name: "Create Shrine Attack Party" })),
    ).toBe(side === "attacker");
  });

  it.each(["neutral", VILLAGE_SYNDICATE_ID, null])(
    "keeps unhired %s players out of war parties",
    (affiliation) => {
      villageId = affiliation;
      sideVillageId = null;
      queuedBattle("ATTACKER");
      const view = mount();
      expect(Boolean(view.queryByRole("tab", { name: "Team Battle" }))).toBe(false);
      expect(Boolean(view.queryByRole("button", { name: "Join Attack" }))).toBe(false);
    },
  );

  it.each(["attacker", "defender"])(
    "uses the hired %s side in village home shrine controls",
    (side) => {
      sideVillageId = side;
      villageId = null;
      sectorNumber = side === "attacker" ? 200 : 100;
      sectorData.village = {
        id: side === "attacker" ? "defender" : "attacker",
      } as NonNullable<SectorData["village"]>;
      sectorData.sectorData!.villageId = sectorData.village.id;
      queuedBattle("ATTACKER");
      const view = mount();
      fireEvent.click(view.getByRole("button", { name: "Attack shrine" }));
      expect(attack).toHaveBeenCalledWith({ sector: sectorNumber });
      fireEvent.mouseDown(view.getByRole("tab", { name: "Team Battle" }), {
        button: 0,
        ctrlKey: false,
      });
      expect(view.queryByRole("button", { name: "Attack shrine" })).toBeNull();
      expect(view.queryAllByText(/Form a team to attack this shrine together!/)).toHaveLength(
        side === "attacker" ? 1 : 0,
      );
      fireEvent.click(view.getByRole("button", { name: "Create Shrine Attack Party" }));
      expect(challenge).toHaveBeenCalledWith({ sectorNumber });
    },
  );
  it.each(["attacker", "defender"])(
    "lets a hired %s defend their damaged home shrine",
    (side) => {
      sideVillageId = side;
      villageId = null;
      sectorNumber = side === "attacker" ? 100 : 200;
      sectorData.village = { id: side } as NonNullable<SectorData["village"]>;
      sectorData.sectorData!.villageId = side;
      queuedBattle("DEFENDER");
      const view = mount();
      fireEvent.click(view.getByRole("button", { name: "Defend shrine" }));
      expect(attack).toHaveBeenCalledWith({ sector: sectorNumber });
      fireEvent.mouseDown(view.getByRole("tab", { name: "Team Battle" }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(view.getByRole("button", { name: "Defend" }));
      expect(join).toHaveBeenCalledWith({ shrineBattleId: "party", side: "DEFENDER" });
      expect(
        Boolean(view.queryByRole("button", { name: "Create Shrine Attack Party" })),
      ).toBe(false);
    },
  );
});
