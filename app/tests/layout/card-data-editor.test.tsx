import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { zodResolver } from "@hookform/resolvers/zod";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { AbilityListEditor } from "@/layout/AbilityListEditor";
import { CardDataEditor } from "@/layout/CardDataEditor";
import type { DraftAbility } from "@/libs/kessen/abilityEditor";
import type { KessenCard } from "@/libs/kessen/types";
import {
  ItemValidator,
  type ZodItemInput,
  type ZodItemType,
} from "@/validators/combat";
import {
  CARD_ITEM_DEFAULTS,
  type CardData,
  DEFAULT_CARD_DATA,
  KESSEN_MAX_ABILITIES,
} from "@/validators/itemCard";
import { KESSEN_SEED_CATALOG } from "../libs/kessen/fixtures/catalog";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

const itemOf = (cardData: Partial<CardData>, rarity = "LEGENDARY") =>
  ({
    ...CARD_ITEM_DEFAULTS,
    itemType: "CARD",
    cardData: { ...DEFAULT_CARD_DATA, ...cardData },
    name: "Moonprowler",
    image: "/images/cards/moonprowler.webp",
    description: "It hunts by the light it steals.",
    rarity,
    hidden: false,
    inShop: false,
    cost: 0,
    repsCost: 0,
    seichiSilverCost: 0,
    expireFromStoreAt: null,
    farmYieldItemId: null,
    farmExtractSeedItemId: null,
    bloodlineId: null,
  }) as unknown as ZodItemInput;

const cardDataOf = ({ id: _id, name: _name, rarity: _rarity, ...data }: KessenCard) =>
  data;

type Form = UseFormReturn<ZodItemInput, unknown, ZodItemType>;

const renderEditor = (values: ZodItemInput) => {
  const handle = { form: undefined as unknown as Form };
  const Harness = () => {
    const form = useForm<ZodItemInput, unknown, ZodItemType>({
      mode: "all",
      criteriaMode: "all",
      defaultValues: values,
      resolver: zodResolver(ItemValidator),
    });
    form.register("cardData");
    handle.form = form;
    return <CardDataEditor form={form} groups={["Crew"]} />;
  };
  render(<Harness />);
  const abilities = () => (handle.form.getValues("cardData") as CardData).abilities;
  return { abilities };
};

const pick = async (label: string, option: string) => {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
  await flushRadixFocus();
};

describe("card ability editor", () => {
  beforeEach(() =>
    installBrowserGlobals({ resizeObserver: true, scrollIntoView: true }),
  );
  afterEach(async () => {
    cleanup();
    await flushRadixFocus();
    restoreBrowserGlobals();
  });

  it.each(KESSEN_SEED_CATALOG)(
    "keeps $name's ability list through moving, adding and removing entries",
    (card) => {
      const stored = structuredClone(card.abilities);
      let current: DraftAbility[] = card.abilities;
      const Harness = () => {
        const [abilities, setAbilities] = useState(current);
        current = abilities;
        return (
          <AbilityListEditor
            abilities={abilities}
            cardKind={card.kind}
            groups={[]}
            errors={[]}
            disabled={false}
            onChange={setAbilities}
          />
        );
      };
      const { getByText, getByTitle } = render(<Harness />);
      if (stored.length < KESSEN_MAX_ABILITIES) {
        fireEvent.click(getByText("Add ability"));
        expect(current).toHaveLength(stored.length + 1);
        fireEvent.click(getByTitle(`Remove Ability ${stored.length + 1}`));
      }
      for (let index = 1; index < stored.length; index++) {
        fireEvent.click(getByTitle(`Move Ability ${index + 1} up`));
        fireEvent.click(getByTitle(`Move Ability ${index} down`));
      }
      expect(current).toEqual(stored);
    },
  );

  it("builds an ability from its verb, amount and target", async () => {
    const { abilities } = renderEditor(itemOf({}));
    fireEvent.click(screen.getByRole("button", { name: "Add ability" }));
    expect(abilities()).toEqual([{ k: "strike", x: 1, mode: "single" }]);
    await pick("Ability 1: Target", "Every enemy unit");
    fireEvent.input(screen.getByRole("spinbutton", { name: "Ability 1: Amount" }), {
      target: { value: "3" },
    });
    expect(abilities()).toEqual([{ k: "strike", x: 3, mode: "allEnemies" }]);
    expect(screen.getByText("Strike 3 each enemy unit")).toBeTruthy();
    await pick("Ability 1: ability", "Summon");
    expect(abilities()).toEqual([{ k: "summon", group: "Crew" }]);
  });

  it("toggles optional fields without storing an empty value", () => {
    const { abilities } = renderEditor(itemOf({ abilities: [{ k: "revive" }] }));
    const twice = screen.getByRole("checkbox", {
      name: "Ability 1: Revive a second unit",
    });
    fireEvent.click(twice);
    expect(abilities()).toEqual([{ k: "revive", times: 2 }]);
    fireEvent.click(twice);
    expect(abilities()).toEqual([{ k: "revive" }]);
    expect("times" in (abilities()[0] ?? {})).toBe(false);
  });

  it("shows a field's problem under that field", () => {
    renderEditor(itemOf({ abilities: [{ k: "rally", x: 2 }] }));
    const amount = screen.getByRole("spinbutton", { name: "Ability 1: Amount" });
    fireEvent.input(amount, { target: { value: "" } });
    const error = document.getElementById(
      amount.getAttribute("aria-describedby") ?? "",
    );
    expect(error?.textContent).toBe("Use 1 to 20");
  });

  it("moves a rejected amount with its entry", () => {
    renderEditor(
      itemOf({
        abilities: [
          { k: "rally", x: 2 },
          { k: "meditate", x: 3 },
        ],
      }),
    );
    const amount = (entry: number) =>
      screen.getByRole("spinbutton", { name: `Ability ${entry}: Amount` });
    fireEvent.input(amount(1), { target: { value: "21" } });
    fireEvent.input(amount(2), { target: { value: "22" } });
    fireEvent.click(screen.getByRole("button", { name: "Move Ability 1 down" }));
    expect([1, 2].map((entry) => (amount(entry) as HTMLInputElement).value)).toEqual([
      "22",
      "21",
    ]);
  });

  it("shows the keyword budget of the rarity under the list", async () => {
    renderEditor(itemOf({ abilities: [{ k: "rally", x: 2 }] }, "COMMON"));
    fireEvent.click(screen.getByRole("button", { name: "Add ability" }));
    await waitFor(() =>
      expect(
        screen.getByText(/A common card may print at most 1 keyword/),
      ).toBeTruthy(),
    );
  });

  it("offers leader verbs to leaders only and four entries at most", async () => {
    const leader = KESSEN_SEED_CATALOG.find((card) => card.kind === "LEADER");
    if (!leader) throw new Error("No seeded leader");
    renderEditor(itemOf({ abilities: [{ k: "rally", x: 2 }] }));
    fireEvent.click(screen.getByRole("combobox", { name: "Ability 1: ability" }));
    const option = await screen.findByRole("option", { name: "Draw" });
    expect(option.getAttribute("aria-disabled")).toBe("true");
    cleanup();

    const { abilities } = renderEditor(itemOf(cardDataOf(leader)));
    const add = screen.getByRole("button", { name: "Add ability" });
    for (let i = 0; i < 6; i++) fireEvent.click(add);
    expect(abilities()).toHaveLength(4);
    expect(add.hasAttribute("disabled")).toBe(true);
  });

  it("keeps an entry it does not recognise until it is replaced", async () => {
    const unknown = { k: "vanish", depth: 2 };
    const { abilities } = renderEditor(
      itemOf({
        abilities: [unknown, { k: "unyielding" }] as unknown as CardData["abilities"],
      }),
    );
    expect(screen.getByText(JSON.stringify(unknown))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move Ability 1 down" }));
    expect(abilities()[1] as unknown).toEqual(unknown);
    await pick("Ability 2: ability", "Resilient");
    expect(abilities()).toEqual([{ k: "unyielding" }, { k: "resilient" }]);
  });
});
