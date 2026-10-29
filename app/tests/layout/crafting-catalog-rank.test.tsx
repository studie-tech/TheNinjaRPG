import { ensureDom } from "../setup/dom.mjs";

ensureDom();
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, setSystemTime, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import type { ItemRarity } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import * as combatActions from "@/layout/CombatActions";
import { CraftingCatalog } from "@/layout/CraftingCatalog";
import * as itemWithEffects from "@/layout/ItemWithEffects";
import * as modal from "@/layout/Modal";
import type { UserWithRelations } from "@/routers/profile";
import * as userContext from "@/utils/UserContext";
import { DecreaseCraftingTime } from "@/validators/combat";

type CatalogProps = ComponentProps<typeof CraftingCatalog>;
type CraftableItem = NonNullable<CatalogProps["craftableItems"]>[number];

const material = { id: "material", name: "Material", rarity: "COMMON" };

const makeItem = (rarity: ItemRarity) =>
  ({
    id: `blade-${rarity}`,
    name: `${rarity} blade`,
    image: "",
    itemType: "WEAPON",
    rarity,
    effects: [],
    hidden: false,
    craftingExperience: 0,
    craftingRequirements: [
      { quantity: 1, requirementItemId: material.id, requirementItem: material },
    ],
  }) as unknown as CraftableItem;

const userItems = [
  { id: "owned", itemId: material.id, quantity: 10, item: material },
] as unknown as UserItemWithRelations[];

// Experience of the support-ticket player (Apprentice crafter)
const apprentice = {
  craftingExperience: 1_175_305,
  village: null,
} as unknown as UserWithRelations;

const renderCatalog = (rarity: ItemRarity, userData = apprentice) => {
  const view = render(
    <CraftingCatalog
      craftableItems={[makeItem(rarity)]}
      userItems={userItems}
      userData={userData}
      isBusy={false}
      isQueueFull={false}
    />,
  );
  fireEvent.click(view.getByText("Weapons"));
  fireEvent.click(view.getByRole("button", { name: `${rarity} blade` }));
  return view;
};

describe("CraftingCatalog crafting rank gate", () => {
  beforeEach(() => {
    Object.assign(vi.spyOn(client, "api" as never), {
      useUtils: () => ({}),
      occupation: {
        craftItem: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
      },
    });
    vi.spyOn(modal, "default").mockImplementation(
      ({
        children,
        isOpen,
        proceed_label,
        proceedDisabled,
      }: {
        children: ReactNode;
        isOpen: boolean;
        proceed_label?: string | null;
        proceedDisabled?: boolean;
      }) =>
        isOpen ? (
          <div>
            {children}
            {proceed_label && (
              <button type="button" disabled={proceedDisabled}>
                {proceed_label}
              </button>
            )}
          </div>
        ) : null,
    );
    vi.spyOn(combatActions, "ActionSelector").mockImplementation(
      ({
        items,
        onClick,
      }: ComponentProps<typeof combatActions.ActionSelector>) => (
        <>
          {items?.map((entry) => (
            <button key={entry.id} type="button" onClick={() => onClick(entry.id)}>
              {entry.name}
            </button>
          ))}
        </>
      ),
    );
    vi.spyOn(itemWithEffects, "default").mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    setSystemTime();
    vi.restoreAllMocks();
  });

  it("refreshes an open preview when gear and imbuements finish without changing the profile", () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 9, 25, 12);
    setSystemTime(start);
    const invalidate = vi.fn();
    Object.assign(vi.spyOn(client, "api" as never), {
      ...client.api,
      useUtils: () => ({ profile: { getUser: { refetch: invalidate } } }),
    });
    const effect = DecreaseCraftingTime.parse({ power: 10 });
    const userData = {
      craftingExperience: 0,
      bloodlineId: null,
      items: [{
        id: "gear",
        equipped: "CHEST",
        quantity: 1,
        durability: 100,
        level: 1,
        craftingFinishedAt: new Date(start + 5000),
        item: {
          itemType: "ARMOR",
          maxDurability: 100,
          bloodlineId: null,
          canBeImbued: true,
          effects: [effect],
        },
        imbuements: [{
          craftingFinishedAt: new Date(start + 15_000),
          item: { effects: [effect] },
        }],
      }],
    } as unknown as UserWithRelations;
    const view = renderCatalog("COMMON", userData);
    const duration = () => view.getByText("Total Crafting Time:").parentElement?.textContent;
    expect(duration()).toBe("Total Crafting Time:60m");
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(duration()).toBe("Total Crafting Time:54m");
    expect(invalidate).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(duration()).toBe("Total Crafting Time:48m");
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it.each([
    { rarity: "EPIC", rank: "Master" },
    { rarity: "LEGENDARY", rank: "Forgemaster" },
  ] as const)("shows the required rank for $rarity items above Apprentice", ({
    rarity,
    rank,
  }) => {
    const view = renderCatalog(rarity);
    expect(view.getByText("Total Crafting Time:").parentElement?.textContent).toBe(
      `Total Crafting Time:Requires ${rank} rank`,
    );
    const craftButton = view.getByRole("button", { name: `Requires ${rank} rank` });
    expect((craftButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the crafting time and Craft button for rarities the rank allows", () => {
    const view = renderCatalog("RARE");
    expect(
      view.getByText("Total Crafting Time:").parentElement?.textContent,
    ).not.toContain("Requires");
    const craftButton = view.getByRole("button", { name: "Start Crafting" });
    expect((craftButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("updates an open recipe across server-time bonus expiry with unchanged profile data", () => {
    const serverNow = Date.UTC(2026, 9, 24, 12);
    const timeDiff = 3_600_000;
    let now = serverNow + timeDiff;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(userContext, "useUserData").mockReturnValue({ timeDiff } as never);
    const user = {
      craftingExperience: 0,
      village: { territoryWarBoostUntil: new Date(serverNow + 5000) },
    } as unknown as UserWithRelations;
    const props = {
      craftableItems: [{ ...makeItem("COMMON"), craftingExperience: 1000 }],
      userItems,
      userData: user,
      isBusy: false,
      isQueueFull: false,
    };
    const view = render(<CraftingCatalog {...props} />);
    fireEvent.click(view.getByText("Weapons"));
    fireEvent.click(view.getByRole("button", { name: "COMMON blade" }));
    expect(view.getByText("Total Crafting Time:").parentElement?.textContent).toBe(
      "Total Crafting Time:51m",
    );
    expect(view.getByText("+1150 EXP")).toBeTruthy();
    now += 6000;
    view.rerender(<CraftingCatalog {...props} />);
    expect(view.getByText("Total Crafting Time:").parentElement?.textContent).toBe(
      "Total Crafting Time:60m",
    );
    expect(view.getByText("+1000 EXP")).toBeTruthy();
    expect(
      (view.getByRole("button", { name: "Start Crafting" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
