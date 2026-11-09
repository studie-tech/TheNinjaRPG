import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import type { VillageAlliance } from "@/drizzle/schema";
import * as Image from "@/layout/Image";
import * as modal from "@/layout/Modal";
import { SorroundingUsers } from "@/layout/SorroundingUsers";
import type { TerrainHex } from "@/libs/hexgrid";
import { travelActionAvailability } from "@/libs/rendering/scenes/travelActors";
import type { SectorUser } from "@/libs/sector-map/world-types";
import type { UserWithRelations } from "@/routers/profile";

beforeEach(() => {
  vi.spyOn(Image, "default").mockImplementation(({ alt, src, ...props }) => (
    // biome-ignore lint/performance/noImgElement: isolated scouting image fixture
    <img {...props} alt={alt} src={typeof src === "string" ? src : undefined} />
  ));
  Object.assign(vi.spyOn(client, "api" as never), {
    village: { getAll: { useQuery: () => ({ data: [] }) } },
  });
  vi.spyOn(modal, "default").mockImplementation(({ children }) => <>{children}</>);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("sector attack controls", () => {
  for (const control of ["scouting", "hover"])
    it.each([
      ["ENEMY", "home", false, true, false],
      ["ENEMY", "permanent-ally", true, true, false],
      ["ALLY", "other", false, false, false],
      ["NEUTRAL", "home", false, false, false],
      ["NEUTRAL", "permanent-ally", true, false, false],
      ["NEUTRAL", "other", false, true, false],
      ["ENEMY", "other", false, true, true],
    ] as const)(
      `${control} preserves allegiance and profile masking (%s, village %s)`,
      (allianceStatus, villageId, permanentAlly, canAttack, isMasked) => {
        const userData = {
          userId: "viewer",
          villageId: "home",
          rank: "JONIN",
          status: "AWAKE",
          village: {
            id: "home",
            relationshipA: permanentAlly
              ? [
                  {
                    villageIdA: "home",
                    villageIdB: villageId,
                    status: "ALLY",
                  } as VillageAlliance,
                ]
              : [],
            relationshipB: [],
          },
        } as unknown as NonNullable<UserWithRelations>;
        const target = {
          userId: "target",
          username: "Mercenary",
          isMasked,
          villageId,
          allianceStatus,
          latitude: 5,
          longitude: 5,
          status: "AWAKE",
          rank: "JONIN",
          curHealth: 100,
          maxHealth: 100,
        } as SectorUser;
        if (control === "scouting") {
          const attackUser = vi.fn();
          const view = render(
            <SorroundingUsers
              userData={userData}
              users={[target]}
              hex={{ col: 5, row: 5 } as TerrainHex}
              allyAttack={false}
              wars={null}
              storedBracket={-1}
              setIsOpen={vi.fn()}
              setAllyAttack={vi.fn()}
              setStoredBracket={vi.fn()}
              attackUser={attackUser}
              robUser={vi.fn()}
              move={vi.fn()}
            />,
          );
          const attack = view.queryByAltText("Attack-target");
          expect(Boolean(attack)).toBe(canAttack);
          expect(Boolean(view.queryByAltText("Info-target"))).toBe(!isMasked);
          if (attack) {
            fireEvent.click(attack);
            expect(attackUser).toHaveBeenCalledWith("target");
          }
        } else {
          const actions = travelActionAvailability(userData, target, false, null);
          expect(actions.attack).toBe(canAttack);
          expect(actions.info).toBe(!isMasked);
        }
      },
    );

  const viewer = {
    userId: "viewer",
    villageId: "home",
    rank: "JONIN",
    status: "AWAKE",
    village: { id: "home", relationshipA: [], relationshipB: [] },
  } as unknown as NonNullable<UserWithRelations>;
  const wars = [
    {
      id: "war",
      attackerVillageId: "home",
      defenderVillageId: "foe",
      warAllies: [{ villageId: "support", supportVillageId: "home" }],
    },
  ] as never;
  const player = (patch: Partial<SectorUser> = {}) =>
    ({
      userId: "target",
      username: "target",
      villageId: "other",
      allianceStatus: "NEUTRAL",
      latitude: 5,
      longitude: 5,
      status: "AWAKE",
      rank: "JONIN",
      curHealth: 100,
      maxHealth: 100,
      ...patch,
    }) as SectorUser;
  const scoutingOffersAttack = (target: SectorUser) =>
    !!render(
      <SorroundingUsers
        userData={viewer}
        users={[target]}
        hex={{ col: 5, row: 5 } as TerrainHex}
        allyAttack={false}
        wars={wars}
        storedBracket={-1}
        setIsOpen={vi.fn()}
        setAllyAttack={vi.fn()}
        setStoredBracket={vi.fn()}
        attackUser={vi.fn()}
        robUser={vi.fn()}
        move={vi.fn()}
      />,
    ).queryByAltText("Attack-target");
  const hoverOffersAttack = (target: SectorUser) =>
    travelActionAvailability(viewer, target, false, wars).attack;

  // A live map update carries no `warRelationship`, so only the war list knows the side.
  it("offers no attack on a war-side supporter in scouting or hover", () => {
    const supporter = player({ villageId: "support" });
    expect(scoutingOffersAttack(supporter)).toBe(false);
    expect(hoverOffersAttack(supporter)).toBe(false);
  });

  it("keeps the attack on a war enemy in scouting and hover", () => {
    const enemy = player({ villageId: "foe" });
    expect(scoutingOffersAttack(enemy)).toBe(true);
    expect(hoverOffersAttack(enemy)).toBe(true);
  });

  it.each(["BATTLE", "HOSPITALIZED"] as const)(
    "offers no hover attack on a %s target",
    (status) => {
      expect(hoverOffersAttack(player({ status }))).toBe(false);
    },
  );

  it("offers no hover or scouting attack on a banned target", () => {
    const banned = player({ isBanned: true });
    expect(scoutingOffersAttack(banned)).toBe(false);
    expect(hoverOffersAttack(banned)).toBe(false);
  });
});

it("closes scouting during travel and restores it after arrival", () => {
  const scoutingModal = vi
    .spyOn(modal, "default")
    .mockImplementation(({ children, isOpen, title }) =>
      isOpen ? (
        <div role="dialog" aria-label={title}>
          {children}
        </div>
      ) : null,
    );
  const props = {
    userData: { userId: "viewer", status: "AWAKE" } as NonNullable<UserWithRelations>,
    users: [],
    hex: { col: 13, row: 13 } as TerrainHex,
    allyAttack: false,
    wars: null,
    storedBracket: -1,
    setIsOpen: vi.fn(),
    setAllyAttack: vi.fn(),
    setStoredBracket: vi.fn(),
    attackUser: vi.fn(),
    robUser: vi.fn(),
    move: vi.fn(),
  };
  const view = render(<SorroundingUsers {...props} />);
  expect(scoutingModal.mock.calls.at(-1)?.[0].isOpen).toBe(true);
  view.rerender(
    <SorroundingUsers {...props} userData={{ ...props.userData, status: "TRAVEL" }} />,
  );
  expect(scoutingModal.mock.calls.at(-1)?.[0].isOpen).toBe(false);
  expect(view.queryByRole("dialog")).toBeNull();
  view.rerender(<SorroundingUsers {...props} />);
  expect(scoutingModal.mock.calls.at(-1)?.[0].isOpen).toBe(true);
  expect(
    view.getByRole("dialog", { name: "Scouting. Your position: [13, 13]" }),
  ).toBeDefined();
  expect(props.setIsOpen).not.toHaveBeenCalled();
});
