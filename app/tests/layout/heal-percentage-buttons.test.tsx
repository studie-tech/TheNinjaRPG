import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HealPercentageButtons } from "@/layout/HealPercentageButtons";

afterEach(cleanup);

const enabledShares = () =>
  screen
    .getAllByRole("button")
    .filter((button) => !(button as HTMLButtonElement).disabled)
    .map((button) => button.textContent);

it("offers the shares the healer can afford and the target is missing", () => {
  render(
    <HealPercentageButtons
      maxHealth={100}
      missingHealth={60}
      maxHeal={75}
      onHeal={vi.fn()}
    />,
  );
  expect(enabledShares()).toEqual(["25%", "50%", "75%"]);
});

it("requires missing health above the previous share", () => {
  render(
    <HealPercentageButtons
      maxHealth={100}
      missingHealth={50}
      maxHeal={100}
      onHeal={vi.fn()}
    />,
  );
  expect(enabledShares()).toEqual(["25%", "50%"]);
});

it("reports the chosen share as a whole percentage", () => {
  const onHeal = vi.fn();
  render(
    <HealPercentageButtons
      maxHealth={100}
      missingHealth={100}
      maxHeal={100}
      onHeal={onHeal}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "75%" }));
  expect(onHeal).toHaveBeenCalledWith(75);
});

it("disables every share on request", () => {
  render(
    <HealPercentageButtons
      disabled
      maxHealth={100}
      missingHealth={100}
      maxHeal={100}
      onHeal={vi.fn()}
    />,
  );
  expect(enabledShares()).toEqual([]);
});
