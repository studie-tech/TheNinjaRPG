import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as Image from "@/layout/Image";
import { VillageChooser } from "@/layout/VillageChooser";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

const villages = [
  { name: "Akikaze", villageGraphic: null, hexColor: "#fff", activeThisWeek: 12 },
  { name: "Hyorin", villageGraphic: null, hexColor: "#000", activeThisWeek: 3 },
];
let query: { data: typeof villages | undefined; isPending: boolean };

beforeEach(() => {
  installBrowserGlobals();
  query = { data: undefined, isPending: true };
  Object.assign(vi.spyOn(client, "api" as never), {
    village: { getVillageChoices: { useQuery: () => query } },
  });
  vi.spyOn(Image, "default").mockImplementation(({ alt }) => <img alt={alt} />);
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

const chooser = () => (
  <VillageChooser
    options={villages.map((village) => ({ text: village.name }))}
    isPending={false}
    onChoose={() => undefined}
    onHide={() => undefined}
  />
);

it("moves focus from the dismiss button to the first village once the cards load", async () => {
  const view = render(chooser());
  await act(flushRadixFocus);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Not yet, let me look around" }),
  );

  query = { data: villages, isPending: false };
  view.rerender(chooser());
  await act(flushRadixFocus);
  expect(document.activeElement?.id).toBe("tutorial-village-choice-akikaze");
});

it("opens on the first village when the cards are already loaded", async () => {
  query = { data: villages, isPending: false };
  render(chooser());
  await act(flushRadixFocus);
  expect(document.activeElement?.id).toBe("tutorial-village-choice-akikaze");
});
