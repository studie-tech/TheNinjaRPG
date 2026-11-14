import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  vi,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import * as client from "@/app/_trpc/client";
import type { ItemRarity } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import * as contentImage from "@/layout/ContentImage";
import { CraftingCatalog } from "@/layout/CraftingCatalog";
import type { UserWithRelations } from "@/routers/profile";
import * as userContext from "@/utils/UserContext";
import { DecreaseCraftingTime } from "@/validators/combat";
import { mockUserContextValue } from "../setup/userContext";
import { stubCraftingCatalog } from "./helpers/craftingCatalog";

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

// Crafting experience at the Apprentice rank
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
    // Keep context metadata local so another suite cannot supply the catalog's clock.
    mockUserContextValue({ timeDiff: 0 } as never);
    stubCraftingCatalog();
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
      useUtils: () => ({ profile: { getUser: { invalidate: invalidate } } }),
    });
    const effect = DecreaseCraftingTime.parse({ power: 10 });
    const userData = {
      craftingExperience: 0,
      bloodlineId: null,
      items: [
        {
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
          imbuements: [
            {
              craftingFinishedAt: new Date(start + 15_000),
              item: { effects: [effect] },
            },
          ],
        },
      ],
    } as unknown as UserWithRelations;
    const view = renderCatalog("COMMON", userData);
    const duration = () =>
      view.getByText("Total Crafting Time:").parentElement?.textContent;
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
  ] as const)(
    "shows the required rank for $rarity items above Apprentice",
    ({ rarity, rank }) => {
      const view = renderCatalog(rarity);
      expect(view.getByText("Total Crafting Time:").parentElement?.textContent).toBe(
        `Total Crafting Time:Requires ${rank} rank`,
      );
      const craftButton = view.getByRole("button", { name: `Requires ${rank} rank` });
      expect((craftButton as HTMLButtonElement).disabled).toBe(true);
    },
  );

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
    mockUserContextValue({ timeDiff } as never);
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

  it("keeps a rarity-framed material icon inside its own row", () => {
    vi.spyOn(contentImage, "default").mockImplementation(({ alt }) => (
      <span>{alt} art</span>
    ));
    const material = {
      id: "material",
      name: "Sun Petal",
      rarity: "RARE",
      image: "https://example.com/sun-petal.png",
    };
    const item = makeItem("COMMON");
    item.craftingRequirements = [
      { quantity: 1, requirementItemId: material.id, requirementItem: material },
    ] as unknown as CraftableItem["craftingRequirements"];
    const view = render(
      <CraftingCatalog
        craftableItems={[item]}
        userItems={userItems}
        userData={apprentice}
        isBusy={false}
        isQueueFull={false}
      />,
    );
    fireEvent.click(view.getByText("Weapons"));
    fireEvent.click(view.getByRole("button", { name: item.name }));

    // ContentImage positions its art absolutely over the rarity frame.
    const wrapper = view.getByText("Sun Petal art").parentElement;
    expect(wrapper?.className).toContain("relative");
    expect(wrapper?.className).toContain("h-8 w-8");
  });
});
