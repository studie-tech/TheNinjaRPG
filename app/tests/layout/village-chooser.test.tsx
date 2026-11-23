import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as Image from "@/layout/Image";
import { VillageChooser } from "@/layout/VillageChooser";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

const village = (
  name: string,
  flags: { isFull?: boolean; needsShinobi?: boolean },
) => ({
  name,
  villageGraphic: null,
  hexColor: "#fff",
  isFull: false,
  needsShinobi: false,
  ...flags,
});
const villages = [village("Akikaze", {}), village("Hyorin", { needsShinobi: true })];
let query: {
  data: ReturnType<typeof village>[] | undefined;
  isPending: boolean;
  refetch: () => Promise<unknown>;
};
let refetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installBrowserGlobals();
  refetch = vi.fn(async () => undefined);
  query = { data: undefined, isPending: true, refetch };
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

const chooser = (
  onChoose: React.ComponentProps<typeof VillageChooser>["onChoose"] = () => undefined,
  names = villages.map((entry) => entry.name),
) => (
  <VillageChooser
    options={names.map((text) => ({ text }))}
    isPending={false}
    onChoose={onChoose}
    onHide={() => undefined}
  />
);

it("moves focus from the dismiss button to the first village once the cards load", async () => {
  const view = render(chooser());
  await act(flushRadixFocus);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Not yet, let me look around" }),
  );

  query = { data: villages, isPending: false, refetch };
  view.rerender(chooser());
  await act(flushRadixFocus);
  expect(document.activeElement?.id).toBe("tutorial-village-choice-akikaze");
});

it("opens on the first village when the cards are already loaded", async () => {
  query = { data: villages, isPending: false, refetch };
  render(chooser());
  await act(flushRadixFocus);
  expect(document.activeElement?.id).toBe("tutorial-village-choice-akikaze");
});

it("leaves out full villages, names them and tags the quietest", async () => {
  query = {
    data: [
      village("Akikaze", { isFull: true }),
      village("Hyorin", { isFull: true }),
      village("Akasumi", { needsShinobi: true }),
      village("Tsukimori", {}),
    ],
    isPending: false,
    refetch,
  };
  render(chooser(undefined, ["Akikaze", "Hyorin", "Akasumi", "Tsukimori"]));
  await act(flushRadixFocus);
  expect(document.getElementById("tutorial-village-choice-akikaze")).toBeNull();
  expect(document.getElementById("tutorial-village-choice-hyorin")).toBeNull();
  expect(document.activeElement?.id).toBe("tutorial-village-choice-akasumi");
  expect(
    screen.getByText(/Akikaze and Hyorin aren't taking new Genin right now/),
  ).toBeTruthy();
  expect(screen.getAllByText("Needs shinobi")).toHaveLength(1);
});

it("returns to the choice and reloads the villages when joining is refused", async () => {
  query = { data: villages, isPending: false, refetch };
  render(chooser((_option, onRejected) => onRejected()));
  await act(flushRadixFocus);
  fireEvent.click(screen.getByText("Akikaze"));
  fireEvent.click(screen.getByRole("button", { name: "Join Akikaze" }));
  expect(screen.queryByRole("button", { name: "Join Akikaze" })).toBeNull();
  expect(refetch).toHaveBeenCalledTimes(1);
});
