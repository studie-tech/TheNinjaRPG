import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as Hub from "@/hooks/kessen/useKessenHub";
import * as Link from "@/layout/Link";
import { kessenCardToCardData } from "@/libs/kessen/catalog";
import { CardSection } from "@/screens/manual/item/edit/ItemEditScreen";
import {
  KESSEN_SEED_CATALOG,
  seedCardByName,
} from "../../libs/kessen/fixtures/catalog";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals();
  vi.spyOn(Link, "default").mockImplementation(({ children, href, ...props }) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("keeps card fields and preview available through catalog loading, error, retry and recovery", () => {
  const card = seedCardByName("Colossus");
  const draft = { ...card, cardData: kessenCardToCardData(card) };
  const refetch = vi.fn();
  const catalog = vi
    .spyOn(Hub, "useKessenCatalog")
    .mockReturnValue({ data: undefined, isFetching: true, refetch } as never);
  const editor = () => (
    <CardSection saved={draft} draft={draft}>
      {(summary) => (
        <>
          <label>
            Card name
            <input defaultValue={card.name} />
          </label>
          <p>Card face preview</p>
          {summary}
        </>
      )}
    </CardSection>
  );
  const view = render(editor());
  expect(view.getByText("Loading the card catalog")).toBeTruthy();
  expect(view.queryByText(/card data is valid/)).toBeNull();
  fireEvent.change(view.getByRole("textbox", { name: "Card name" }), {
    target: { value: "My draft" },
  });
  catalog.mockReturnValue({
    data: undefined,
    isError: true,
    isFetching: false,
    error: new Error("offline"),
    refetch,
  } as never);
  view.rerender(editor());
  expect(view.getAllByRole("alert")).toHaveLength(1);
  expect(view.getByRole("alert").textContent).toContain("offline");
  expect(view.queryByText("Loading the card catalog")).toBeNull();
  expect(view.queryByText(/card data is valid/)).toBeNull();
  expect(view.getByText("Card face preview")).toBeTruthy();
  expect((view.getByRole("textbox") as HTMLInputElement).value).toBe("My draft");
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  expect(refetch).toHaveBeenCalledTimes(1);
  catalog.mockReturnValue({
    data: undefined,
    isError: true,
    isFetching: true,
    error: new Error("offline"),
    refetch,
  } as never);
  view.rerender(editor());
  expect(view.getByRole("button", { name: "Try again" }).hasAttribute("disabled")).toBe(
    true,
  );
  catalog.mockReturnValue({
    data: { cards: KESSEN_SEED_CATALOG },
    isError: false,
    isFetching: false,
    refetch,
  } as never);
  view.rerender(editor());
  expect(view.queryByRole("alert")).toBeNull();
  expect(view.queryByText("Loading the card catalog")).toBeNull();
  expect(view.getByRole("button", { name: /Test in matches/ })).toBeTruthy();
  expect((view.getByRole("textbox") as HTMLInputElement).value).toBe("My draft");
});

it("shows invalid draft guidance only with a loaded catalog", () => {
  vi.spyOn(Hub, "useKessenCatalog").mockReturnValue({
    data: { cards: KESSEN_SEED_CATALOG },
  } as never);
  const card = seedCardByName("Colossus");
  const draft = { ...card, cardData: null };
  const view = render(
    <CardSection saved={draft} draft={draft}>
      {(summary) => <>{summary}</>}
    </CardSection>,
  );
  expect(
    view.getByText("Balance checks appear once the card data is valid."),
  ).toBeTruthy();
  expect(view.queryByRole("button", { name: /Test in matches/ })).toBeNull();
});
