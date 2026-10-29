import * as radixSize from "@radix-ui/react-use-size";
import { QueryClient, QueryClientProvider, useMutation, type UseMutationOptions } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import { type ComponentProps, type ReactNode, Suspense } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import * as client from "@/app/_trpc/client";
import ItemEdit from "@/app/[shell]/manual/item/edit/[itemid]/page";
import ManualItems from "@/app/[shell]/manual/item/page";
import type { Item } from "@/drizzle/schema";
import * as itemHooks from "@/hooks/item";
import { useItemEditForm } from "@/hooks/item";
import * as ContentHelp from "@/layout/ContentHelp";
import * as ContentBox from "@/layout/ContentBox";
import * as Confirm from "@/layout/Confirm";
import * as ContentImageSelector from "@/layout/ContentImageSelector";
import * as editContent from "@/layout/EditContent";
import { EditContent } from "@/layout/EditContent";
import * as furnitureEditor from "@/layout/FurnitureViewsEditor";
import * as Image from "@/layout/Image";
import * as itemFiltering from "@/layout/ItemFiltering";
import * as ItemWithEffects from "@/layout/ItemWithEffects";
import * as SuggestChange from "@/layout/SuggestChange";
import * as pagination from "@/libs/pagination";
import { ItemValidator, ItemValidatorRawSchema, UnlockItemVariantTag, type ZodItemType } from "@/validators/combat";
import { DEFAULT_FURNITURE_DATA, FURNITURE_ITEM_DEFAULTS, ItemVariantValidator } from "@/validators/item";
import type { FurnitureGeometry } from "@/validators/itemFurniture";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import * as UserContext from "@/utils/UserContext";
import { ensureDom } from "../setup/dom.mjs";

ensureDom();
const validItem = ItemValidator.parse({
  name: "Shop item",
  image: "item.webp",
  description: "Shop item",
  battleDescription: "",
  stackSize: 10,
  chakraCost: 0,
  healthCost: 0,
  staminaCost: 0,
  healthCostReducePerLvl: 0,
  chakraCostReducePerLvl: 0,
  staminaCostReducePerLvl: 0,
  actionCostPerc: 100,
  maxImbueNumber: 1,
  maxDurability: 100,
  hidden: false,
  cooldown: 0,
  cost: 1,
  repsCost: 0,
  seichiSilverCost: 0,
  range: 0,
  maxEquips: 0,
  method: "SINGLE",
  target: "SELF",
  itemType: "MATERIAL",
  weaponType: "NONE",
  rarity: "COMMON",
  slot: "NONE",
  expireFromStoreAt: null,
  effects: [],
  farmYieldItemId: null,
  farmExtractSeedItemId: null,
  crystalTargetTypes: null,
  bloodlineId: null,
});
const data = {
  ...validItem,
  id: "shop-item",
  createdAt: new Date(),
  updatedAt: new Date(),
  craftingRequirements: [],
} as Item & { craftingRequirements: [] };
const updateItem = vi.fn();
const catalogueInvalidations = {
  getAllNames: vi.fn(async () => undefined),
  getVariantNames: vi.fn(async () => undefined),
  getItemVariants: vi.fn(async (_input: { itemId: string }) => undefined),
};
const itemUtils = Object.fromEntries(Object.entries(catalogueInvalidations).map(([name, invalidate]) => [name, { invalidate }]));
const originalEvent = globalThis.Event;
const originalCustomEvent = globalThis.CustomEvent;
const ActualFurnitureViewsEditor = furnitureEditor.FurnitureViewsEditor;
const ActualEditContent = EditContent;
const actualUseItemEditForm = useItemEditForm;

beforeEach(() => {
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent;
  updateItem.mockReset();
  for (const invalidate of Object.values(catalogueInvalidations)) invalidate.mockClear();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ item: itemUtils }),
    item: {
      getAllNames: { useQuery: () => ({ data: [] }) },
      update: { useMutation: () => ({ mutateAsync: updateItem, isPending: false }) },
    },
    skillTree: { getAllNames: { useQuery: () => ({ data: [] }) } },
    bloodline: { getAllNames: { useQuery: () => ({ data: [] }) } },
    gameAsset: {
      getNameTags: { useQuery: () => ({ data: undefined }) },
      getSceneAssets: { useQuery: () => ({ data: [] }) },
      getAll: { useInfiniteQuery: () => ({ data: { pages: [] } }) },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.Event = originalEvent;
  globalThis.CustomEvent = originalCustomEvent;
});

describe("staff item economy editor", () => {
  it("saves ordinary items after the page converts nullable fields to empty strings", async () => {
    const pageData = { ...data, furnitureData: null };
    setNullsToEmptyStrings(pageData);
    const { result } = renderHook(() => useItemEditForm(pageData, async () => undefined));
    await act(async () => {
      result.current.form.setValue("name", "Renamed shop item", { shouldDirty: true });
      await result.current.handleItemSubmit();
    });
    expect(result.current.form.getFieldState("furnitureData").error).toBeUndefined();
    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(updateItem).toHaveBeenCalledWith(expect.objectContaining({
      id: data.id,
      data: expect.objectContaining({ name: "Renamed shop item", furnitureData: null }),
    }));
    expect(ItemValidator.safeParse(result.current.form.getValues()).success).toBe(true);
  });
  it("normalizes an existing combat item when switching to furniture and exposes placement controls", async () => {
    const { result } = renderHook(() => useItemEditForm({
      ...data,
      itemType: "WEAPON",
      maxEquips: 1,
      slot: "HAND",
      target: "CHARACTER",
      canBeImbued: true,
      effects: [{ type: "damage", description: "Attack", power: 1 }],
    } as unknown as typeof data, async () => undefined));
    expect(result.current.formData.some((field) => field.id === "furnitureData.action")).toBe(false);
    await act(async () => {
      result.current.form.setValue("itemType", "FURNITURE");
    });
    expect(result.current.form.getValues()).toMatchObject({
      effects: [], slot: "NONE", target: "SELF", maxEquips: 0,
      preventBattleUsage: true, maxImbueNumber: 0, maxDurability: 0,
      canBeImbued: false,
      furnitureData: { action: null, width: 24, groundAnchor: 100, isFloor: false },
    });
    const ids = result.current.formData.map((field) => field.id);
    expect(ids).toContain("furnitureData.action");
    expect(ids).not.toContain("furnitureData.width");
    expect(ids).not.toContain("furnitureData.groundAnchor");
    expect(ids).toContain("furnitureData.isFloor");
    expect(ids).not.toContain("battleDescription");
    expect(ids).not.toContain("slot");
    expect(ids).not.toContain("image");
    expect(await result.current.form.trigger()).toBe(true);
  });
  it("saves nested furniture settings and clears them when changing to another item type", async () => {
    const { result } = renderHook(() => useItemEditForm(data, async () => undefined));
    await act(async () => {
      result.current.form.setValue("itemType", "FURNITURE");
    });
    await act(async () => {
      result.current.form.setValue("furnitureData.width", 32);
      result.current.form.setValue("furnitureData.action", "storage");
    });
    expect(ItemValidator.parse(result.current.form.getValues()).furnitureData).toMatchObject({
      width: 32, action: "storage",
    });
    await act(async () => {
      result.current.form.setValue("itemType", "MATERIAL");
    });
    expect(result.current.form.getValues("furnitureData")).toBeNull();
    expect(await result.current.form.trigger()).toBe(true);
  });
  it("clears and saves loaded furniture after editing its nested controls", async () => {
    vi.spyOn(radixSize, "useSize").mockReturnValue({ width: 0, height: 0 });
    const savedFurniture = {
      ...data,
      ...ItemValidator.parse({
        ...data,
        ...FURNITURE_ITEM_DEFAULTS,
        itemType: "FURNITURE",
        furnitureData: {
          ...DEFAULT_FURNITURE_DATA,
          action: "storage",
          width: 32,
          views: { "90": { image: "chair-90.webp" } },
        },
      }),
    } as typeof data;
    let editor!: ReturnType<typeof useItemEditForm>;
    const FurnitureEditor = () => {
      editor = useItemEditForm(savedFurniture, async () => undefined);
      return <>
        <EditContent
          schema={ItemValidatorRawSchema}
          form={editor.form as unknown as UseFormReturn<ZodItemType>}
          formData={editor.formData.filter((field) => field.id.startsWith("furnitureData."))}
          showSubmit={false}
        />
        {editor.form.getValues("itemType") === "FURNITURE" && <Controller
          control={editor.form.control}
          name="furnitureData.views"
          render={({ field }) => <output>{JSON.stringify(field.value)}</output>}
        />}
        <output data-testid="dirty">{String(editor.form.formState.isDirty)}</output>
      </>;
    };
    const view = render(<FurnitureEditor />);
    expect(view.getByTestId("dirty").textContent).toBe("false");
    expect(editor.form.getValues("furnitureData")).toEqual(savedFurniture.furnitureData);
    const floor = view.getByRole("switch", { name: "Floor decoration" });
    fireEvent.click(floor);
    expect(editor.form.getValues("furnitureData.isFloor")).toBe(true);
    expect(editor.form.getFieldState("furnitureData.isFloor").isDirty).toBe(true);
    fireEvent.click(floor);
    expect(view.getByTestId("dirty").textContent).toBe("false");
    expect(editor.form.getValues("furnitureData")).toEqual(savedFurniture.furnitureData);
    await act(async () => {
      editor.form.setValue("itemType", "MATERIAL", { shouldDirty: true });
    });
    expect(view.queryByRole("switch", { name: "Floor decoration" })).toBeNull();
    expect(editor.form.getValues("furnitureData")).toBeNull();
    expect(editor.form.getFieldState("furnitureData").isDirty).toBe(true);
    expect(editor.form.formState.defaultValues?.furnitureData).toEqual(savedFurniture.furnitureData);
    expect(view.getByTestId("dirty").textContent).toBe("true");
    await act(async () => {
      expect(await editor.form.trigger()).toBe(true);
      await editor.handleItemSubmit();
    });
    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(updateItem).toHaveBeenCalledWith(expect.objectContaining({
      id: data.id,
      data: expect.objectContaining({ itemType: "MATERIAL", furnitureData: null }),
    }));
  });
  it("clears seed extraction when an extractable crop becomes furniture", async () => {
    const crop = { ...data, itemType: "COOKING" as const, farmExtractSeedItemId: "rice-seed", farmExtractSeedCount: 5 };
    expect(ItemValidator.safeParse(crop).success).toBe(true);
    const { result } = renderHook(() => useItemEditForm(crop, async () => undefined));
    expect(result.current.formData.some((field) => field.id === "farmExtractSeedItemId")).toBe(true);
    await act(async () => {
      result.current.form.setValue("itemType", "FURNITURE");
    });
    expect(result.current.form.getValues()).toMatchObject({
      farmExtractSeedItemId: null, farmExtractSeedCount: 0,
    });
    expect(result.current.formData.some((field) => field.id === "farmExtractSeedItemId")).toBe(false);
    expect(result.current.formData.some((field) => field.id === "farmExtractSeedCount")).toBe(false);
    expect(await result.current.form.trigger()).toBe(true);
    expect(ItemValidator.safeParse(result.current.form.getValues()).success).toBe(true);
  });
  it("replaces a saved furniture image, remeasures it and saves without changing other placement data", async () => {
    const geometry: FurnitureGeometry = {
      aspectRatio: 4 / 3,
      visibleBounds: { x: 10, y: 10, width: 80, height: 70 },
      footprint: { x: 10, y: 60, width: 80, height: 20 },
    };
    const savedFurniture = {
      ...data,
      ...ItemValidator.parse({
        ...data,
        ...FURNITURE_ITEM_DEFAULTS,
        itemType: "FURNITURE",
        image: "https://example.com/original.webp",
        furnitureData: {
          ...DEFAULT_FURNITURE_DATA,
          action: "storage",
          width: 32,
          groundAnchor: 80,
          geometry,
          views: { "90": { image: "https://example.com/90.webp", width: 20, geometry } },
        },
      }),
    } as typeof data;
    const originalFurniture = structuredClone(savedFurniture.furnitureData);
    const replacement = "https://example.com/replacement.webp";
    let measurement: client.RouterOutputs["item"]["getFurnitureImageGeometry"] | undefined;
    let editor!: ReturnType<typeof useItemEditForm>;
    let viewProps!: ComponentProps<typeof ActualFurnitureViewsEditor>;
    let selector!: ComponentProps<typeof ContentImageSelector.default>;
    const query = () => ({ data: measurement, isFetching: false });
    Object.assign(client.api.item, {
      getItemWithCraftingRequirements: { useQuery: () => ({ data: savedFurniture, isPending: false, refetch: async () => undefined }) },
      getItemVariants: { useQuery: () => ({ data: [] }) },
      upsertItemVariant: { useMutation: () => ({ isPending: false }) },
      deleteItemVariant: { useMutation: () => ({ isPending: false }) },
      getFurnitureImageGeometry: { useQuery: query },
    });
    Object.assign(client.api, { useQueries: () => [query(), query(), query()] });
    vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
    vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({ data: { role: "CONTENT-ADMIN" } } as never);
    vi.spyOn(radixSize, "useSize").mockReturnValue({ width: 0, height: 0 });
    vi.spyOn(ContentHelp, "ItemHelper").mockImplementation(() => null);
    vi.spyOn(SuggestChange, "SuggestChange").mockImplementation(() => null);
    vi.spyOn(Image, "default").mockImplementation(({ alt }) => <span>{alt}</span>);
    vi.spyOn(itemHooks, "useItemEditForm").mockImplementation((...args) => {
      editor = actualUseItemEditForm(...args);
      return editor;
    });
    vi.spyOn(editContent, "EditContent").mockImplementation((props) => <>
      <ActualEditContent {...props} formData={props.formData.filter(({ id }) => id.startsWith("furnitureData."))} />
      <output data-testid="dirty">{String(props.form.formState.isDirty)}</output>
    </>);
    vi.spyOn(furnitureEditor, "FurnitureViewsEditor").mockImplementation((props) => {
      viewProps = props;
      return <ActualFurnitureViewsEditor {...props} />;
    });
    vi.spyOn(ContentImageSelector, "default").mockImplementation((props) => {
      selector = props;
      return null;
    });
    const params = Promise.resolve({ itemid: savedFurniture.id });
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<Suspense fallback={null}><ItemEdit params={params} /></Suspense>);
    });
    expect(view.getByTestId("dirty").textContent).toBe("false");
    await act(async () => { viewProps.onBaseChange({}); });
    expect(view.getByTestId("dirty").textContent).toBe("false");
    await act(async () => { selector.onUploadComplete(replacement); });
    expect(editor.form.getValues("image")).toBe(replacement);
    expect(editor.form.getValues("furnitureData")).toEqual({ ...originalFurniture, geometry: undefined });
    expect(editor.form.formState.defaultValues?.furnitureData).toEqual(originalFurniture);
    expect(editor.form.getFieldState("furnitureData").isDirty).toBe(true);
    expect(view.getByTestId("dirty").textContent).toBe("true");
    expect(view.getByRole("button", { name: "Measuring furniture" }).hasAttribute("disabled")).toBe(true);
    await act(async () => { viewProps.onBaseChange({ geometry: undefined }); });
    expect(editor.form.getValues("furnitureData.geometry")).toBeUndefined();
    await act(async () => {
      viewProps.onBaseChange({ image: savedFurniture.image, geometry });
    });
    expect(editor.form.getValues("furnitureData")).toEqual(originalFurniture);
    expect(view.getByTestId("dirty").textContent).toBe("false");
    await act(async () => { selector.onUploadComplete(replacement); });
    const measuredGeometry = { ...geometry, aspectRatio: 0.75 };
    measurement = { success: true, message: "Measured", image: replacement, useFullFootprint: false, geometry: measuredGeometry };
    await act(async () => { view.rerender(<Suspense fallback={null}><ItemEdit params={params} /></Suspense>); });
    expect(editor.form.getValues("furnitureData")).toEqual({ ...originalFurniture, geometry: measuredGeometry });
    expect(editor.form.formState.defaultValues?.furnitureData).toEqual(originalFurniture);
    await act(async () => {
      expect(await editor.form.trigger()).toBe(true);
      fireEvent.click(view.getByRole("button", { name: "Save to Database" }));
    });
    await waitFor(() => expect(updateItem).toHaveBeenCalledTimes(1));
    expect(updateItem).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ image: replacement, furnitureData: { ...originalFurniture, geometry: measuredGeometry } }),
    }));
  });
  it("starts unrestricted and places fields beside shop/trading settings", () => {
    const { result } = renderHook(() => useItemEditForm(data, async () => undefined));
    expect(result.current.form.getValues("purchaseLimitPeriod")).toBe("NONE");
    expect(result.current.form.getValues("purchaseLimit")).toBeNull();
    expect(result.current.form.getValues("auctionMinPrice")).toBeNull();
    expect(result.current.form.getValues("auctionMaxPrice")).toBeNull();
    const ids = result.current.formData.map((field) => field.id);
    expect(ids.slice(ids.indexOf("inShop"), ids.indexOf("inShop") + 3)).toEqual([
      "inShop",
      "purchaseLimitPeriod",
      "purchaseLimit",
    ]);
    expect(
      ids.slice(ids.indexOf("canBeTraded"), ids.indexOf("canBeTraded") + 3),
    ).toEqual(["canBeTraded", "auctionMinPrice", "auctionMaxPrice"]);
  });
  it("requires quantity for a limited period and allows clearing bounds", async () => {
    const { result } = renderHook(() => useItemEditForm(data, async () => undefined));
    await act(async () => {
      result.current.form.setValue("purchaseLimitPeriod", "DAILY");
      await result.current.form.trigger("purchaseLimit");
    });
    expect(result.current.form.getFieldState("purchaseLimit").error?.message).toContain(
      "requires a quantity",
    );
    await act(async () => {
      result.current.form.setValue("purchaseLimit", 5);
      result.current.form.setValue("auctionMinPrice", "");
      result.current.form.setValue("auctionMaxPrice", "");
      await result.current.form.trigger();
    });
    expect(result.current.form.getFieldState("purchaseLimit").error).toBeUndefined();
    expect(result.current.form.getFieldState("auctionMinPrice").error).toBeUndefined();
    expect(result.current.form.getFieldState("auctionMaxPrice").error).toBeUndefined();
  });
});

describe("staff item selector refreshes", () => {
  let queryClient: QueryClient;
  const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
    vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
    vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({ data: { role: "CONTENT-ADMIN" } } as never);
    vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: { role: "CONTENT-ADMIN" } } as never);
    vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <section>{children}</section>);
    vi.spyOn(ContentHelp, "ItemHelper").mockImplementation(() => null);
    vi.spyOn(SuggestChange, "SuggestChange").mockImplementation(() => null);
    vi.spyOn(Image, "default").mockImplementation(({ alt }) => <span>{alt}</span>);
  });
  afterEach(() => {
    queryClient.clear();
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });

  it.each([true, false])("refreshes token bindings and variant labels only after a successful item save (success=%s)", async (success) => {
    type Input = client.RouterInputs["item"]["update"];
    type Result = client.RouterOutputs["item"]["update"];
    updateItem.mockResolvedValue({ success, message: success ? "Saved" : "Cannot save" });
    Object.assign(client.api.item, {
      update: { useMutation: (options: UseMutationOptions<Result, Error, Input>) => useMutation({ ...options, mutationFn: updateItem }) },
    });
    const refetch = vi.fn(async () => undefined);
    const token = { ...data, itemType: "CONSUMABLE" as const, destroyOnUse: true, preventBattleUsage: true };
    const { result } = renderHook(() => useItemEditForm(token, refetch), { wrapper });
    await act(async () => {
      result.current.form.setValue("name", "Renamed token", { shouldDirty: true });
      result.current.form.setValue("effects", [UnlockItemVariantTag.parse({ variantId: "red-variant" })], { shouldDirty: true });
      expect(ItemValidator.safeParse(result.current.form.getValues()).success).toBe(true);
      await result.current.handleItemSubmit();
    });
    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(catalogueInvalidations.getAllNames).toHaveBeenCalledTimes(success ? 1 : 0);
    expect(catalogueInvalidations.getVariantNames).toHaveBeenCalledTimes(success ? 1 : 0);
    expect(refetch).toHaveBeenCalledTimes(success ? 1 : 0);
  });

  it.each(["create", "update", "delete"] as const)("refreshes token variant choices after a variant %s", async (operation) => {
    const variant = { ...ItemVariantValidator.parse({ name: "Red", image: "https://example.com/red.webp", costType: "VARIANT_TOKEN", cost: 1, order: 1 }), id: "red-variant", itemId: data.id };
    const saveVariant = vi.fn(async () => ({ success: true, message: "Saved" }));
    const deleteVariant = vi.fn(async () => ({ success: true, message: "Deleted" }));
    Object.assign(client.api.item, {
      getItemWithCraftingRequirements: { useQuery: () => ({ data: structuredClone(data), isPending: false, refetch: async () => undefined }) },
      getItemVariants: { useQuery: () => ({ data: operation === "create" ? [] : [variant] }) },
      upsertItemVariant: { useMutation: (options: UseMutationOptions<client.RouterOutputs["item"]["upsertItemVariant"], Error, client.RouterInputs["item"]["upsertItemVariant"]>) => useMutation({ ...options, mutationFn: saveVariant }) },
      deleteItemVariant: { useMutation: (options: UseMutationOptions<client.RouterOutputs["item"]["deleteItemVariant"], Error, client.RouterInputs["item"]["deleteItemVariant"]>) => useMutation({ ...options, mutationFn: deleteVariant }) },
    });
    vi.spyOn(editContent, "EditContent").mockImplementation(() => <></>);
    vi.spyOn(ContentImageSelector, "default").mockImplementation(({ onUploadComplete }) => <button type="button" onClick={() => onUploadComplete("https://example.com/new.webp")}>Choose variant image</button>);
    vi.spyOn(Confirm, "default").mockImplementation(({ onAccept }) => <button type="button" onClick={onAccept}>Confirm variant deletion</button>);
    const params = Promise.resolve({ itemid: data.id });
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<Suspense fallback={null}><ItemEdit params={params} /></Suspense>, { wrapper }); });
    if (operation === "delete") {
      fireEvent.click(view.getByRole("button", { name: "Confirm variant deletion" }));
    } else {
      fireEvent.click(view.getByRole("button", { name: operation === "create" ? "+ Add Variant" : "Edit" }));
      fireEvent.change(view.getByRole("textbox", { name: "Name" }), { target: { value: "Blue" } });
      if (operation === "create") {
        fireEvent.click(view.getByRole("combobox", { name: "Cost Type" }));
        fireEvent.click(await view.findByRole("option", { name: "Variant Token" }));
      }
      fireEvent.click(view.getByRole("button", { name: "Choose variant image" }));
      fireEvent.click(view.getByRole("button", { name: "Save Variant" }));
    }
    await waitFor(() => expect(catalogueInvalidations.getVariantNames).toHaveBeenCalledTimes(1));
    expect(catalogueInvalidations.getItemVariants).toHaveBeenCalledWith({ itemId: data.id });
    expect(operation === "delete" ? deleteVariant : saveVariant).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])("refreshes token variant choices only after a successful parent deletion (success=%s)", async (success) => {
    const refetch = vi.fn(async () => undefined);
    const deleteItem = vi.fn(async () => ({ success, message: success ? "Deleted" : "Cannot delete" }));
    Object.assign(client.api.item, {
      getAll: { useInfiniteQuery: () => ({ data: { pages: [{ data: [data] }] }, isFetching: false, isPending: false, refetch, fetchNextPage: async () => undefined, hasNextPage: false }) },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: (options: UseMutationOptions<client.RouterOutputs["item"]["delete"], Error, client.RouterInputs["item"]["delete"]>) => useMutation({ ...options, mutationFn: deleteItem }) },
    });
    vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
    vi.spyOn(itemFiltering, "default").mockImplementation(() => null);
    vi.spyOn(itemFiltering, "useFiltering").mockReturnValue({ itemType: "ANY" } as never);
    vi.spyOn(itemFiltering, "getFilter").mockReturnValue({} as never);
    vi.spyOn(ItemWithEffects, "default").mockImplementation(({ item, onDelete }) => <button type="button" onClick={() => onDelete?.(item.id)}>Delete parent item</button>);
    const view = render(<ManualItems />, { wrapper });
    fireEvent.click(view.getByRole("button", { name: "Delete parent item" }));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(deleteItem).toHaveBeenCalledWith({ id: data.id }, expect.anything());
    expect(catalogueInvalidations.getVariantNames).toHaveBeenCalledTimes(success ? 1 : 0);
    expect(catalogueInvalidations.getAllNames).toHaveBeenCalledTimes(success ? 1 : 0);
  });
});
