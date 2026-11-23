import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import * as lpcHooks from "@/hooks/lpc";
import * as characterPreview from "@/layout/CharacterPreview";
import { LpcEquipmentFields } from "@/layout/LpcEquipmentFields";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { buildLpcCatalog, spriteLayerSheets } from "@/libs/lpc/catalog";
import type { LpcColor, LpcMaterialColors, SpriteAppearance } from "@/validators/lpc";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";
import { lpcAssets } from "../setup/lpc";

type Fields = {
  lpcProfile: string | null;
  lpcColor: LpcColor | null;
  lpcMaterialColors?: LpcMaterialColors | null;
};
const item = {
  id: "staff-preview",
  name: "Blue armour",
  slot: "CHEST",
  itemType: "ARMOR",
  lpcProfile: "plate",
  lpcColor: "blue" as const,
};

beforeEach(() => {
  installBrowserGlobals({ scrollIntoView: true });
  vi.spyOn(lpcHooks, "useLpcDesigns").mockReturnValue({
    data: lpcAssets,
    error: null,
  } as unknown as ReturnType<typeof lpcHooks.useLpcDesigns>);
  vi.spyOn(characterPreview, "CharacterPreview").mockImplementation(
    ({ user, label }) => (
      <output data-testid="appearance" aria-label={label}>
        {JSON.stringify(resolveSpriteAppearance(user))}
      </output>
    ),
  );
});
afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("staff equipment preview", () => {
  it("describes automatic base colour while retaining gray before a custom design default", async () => {
    const source = structuredClone(lpcAssets.find((asset) => asset.id === "shirt")!);
    source.lpcConfig.defaultColor = "blue";
    vi.spyOn(lpcHooks, "useLpcDesigns").mockReturnValue({
      data: [source],
      error: null,
    } as unknown as ReturnType<typeof lpcHooks.useLpcDesigns>);
    const { result } = renderHook(() =>
      useForm<Fields>({
        defaultValues: { lpcProfile: "shirt", lpcColor: null },
      }),
    );
    const view = render(
      <LpcEquipmentFields control={result.current.control} item={item} />,
    );
    const help = "Uses gray when available, otherwise the design default.";
    expect(view.getByRole("combobox", { name: "Equipment colour" }).textContent).toBe(
      "Automatic colour",
    );
    expect(view.getByText(help)).toBeTruthy();
    const appearance = JSON.parse(
      view.getByTestId("appearance").textContent!,
    ) as SpriteAppearance;
    const layer = appearance.layers.find((entry) => entry.slot === "CHEST")!;
    expect(
      spriteLayerSheets(buildLpcCatalog([source]), appearance, layer)[0]!.image,
    ).toBe(source.lpcConfig.variants["male/gray/blue"]![0]!.image);
    await act(async () => result.current.setValue("lpcColor", "blue"));
    expect(view.queryByText(help)).toBeNull();
    await act(async () => result.current.setValue("lpcColor", null));
    view.rerender(
      <LpcEquipmentFields
        control={result.current.control}
        item={item}
        variant={{ name: "Inherited" }}
      />,
    );
    expect(view.getByRole("combobox", { name: "Equipment colour" }).textContent).toBe(
      "Inherit item colour",
    );
    expect(view.queryByText(help)).toBeNull();
  });

  it("updates coverage with inherited and unsaved material palettes on either body", async () => {
    const source = structuredClone(lpcAssets.find((asset) => asset.id === "shirt")!);
    for (const [key, sheets] of Object.entries(source.lpcConfig.variants))
      for (const sheet of sheets) {
        sheet.part = "fabric";
        sheet.component = "fabric";
        sheet.material = "cloth";
        if (key.split("/")[1] === "blue") delete sheet.layout.clips.idle;
      }
    vi.spyOn(lpcHooks, "useLpcDesigns").mockReturnValue({
      data: [source],
      error: null,
    } as unknown as ReturnType<typeof lpcHooks.useLpcDesigns>);
    const { result } = renderHook(() =>
      useForm<Fields>({
        defaultValues: { lpcProfile: null, lpcColor: null, lpcMaterialColors: null },
      }),
    );
    const view = render(
      <LpcEquipmentFields
        control={result.current.control}
        item={{
          ...item,
          lpcProfile: "shirt",
          lpcColor: "gray",
          lpcMaterialColors: { cloth: "blue" },
        }}
        variant={{ name: "Inherited" }}
      />,
    );
    expect(view.getByText(/Held-pose fallback: idle\./)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Slender" }));
    expect(view.getByText(/Held-pose fallback: idle\./)).toBeTruthy();
    await act(async () =>
      result.current.setValue("lpcMaterialColors", { cloth: "gray" }),
    );
    expect(view.queryByText(/Held-pose fallback: idle\./)).toBeNull();
    expect(view.getByText(/^Authored:/).textContent).toContain("idle");
  });

  it("searches the visual library and applies a design without changing saved item data", async () => {
    const { result } = renderHook(() =>
      useForm<Fields>({ defaultValues: { lpcProfile: null, lpcColor: "blue" } }),
    );
    const view = render(
      <LpcEquipmentFields control={result.current.control} item={item} />,
    );
    fireEvent.click(view.getByRole("button", { name: "Browse designs" }));
    fireEvent.change(view.getByRole("textbox", { name: "Search equipment designs" }), {
      target: { value: "leather" },
    });
    expect(view.getByText("1 designs")).toBeTruthy();
    expect(view.getByRole("img", { name: "LPC leather, slender" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: /leather.*12 colours/i }));
    expect(result.current.getValues()).toMatchObject({
      lpcProfile: "leather",
      lpcColor: "blue",
    });
    expect(view.queryByRole("dialog")).toBeNull();
    expect(item.lpcProfile).toBe("plate");
  });

  it("previews material inheritance and offers only complete palettes on both bodies", async () => {
    const source = structuredClone(lpcAssets.find((asset) => asset.id === "plate")!);
    for (const sheets of Object.values(source.lpcConfig.variants)) {
      sheets.forEach((sheet, index) => {
        sheet.part = `metal_${index}`;
        sheet.material = "metal";
      });
    }
    delete source.lpcConfig.variants["female/red/blue"];
    vi.spyOn(lpcHooks, "useLpcDesigns").mockReturnValue({
      data: [source],
      error: null,
    } as unknown as ReturnType<typeof lpcHooks.useLpcDesigns>);
    const { result } = renderHook(() =>
      useForm<Fields>({
        defaultValues: { lpcProfile: null, lpcColor: null, lpcMaterialColors: null },
      }),
    );
    const view = render(
      <LpcEquipmentFields
        control={result.current.control}
        item={{ ...item, lpcMaterialColors: { metal: "gold" } }}
        variant={{ name: "Inherited" }}
      />,
    );
    const appearance = () =>
      JSON.parse(view.getByTestId("appearance").textContent!) as SpriteAppearance;
    expect(
      appearance().layers.find((layer) => layer.profile === "plate")?.materialColors,
    ).toEqual({ metal: "gold" });
    fireEvent.click(view.getByRole("combobox", { name: "Metal colour" }));
    expect(view.queryByRole("option", { name: "red" })).toBeNull();
    fireEvent.click(view.getByRole("option", { name: "silver" }));
    expect(result.current.getValues("lpcMaterialColors")).toEqual({ metal: "silver" });
    expect(
      appearance().layers.find((layer) => layer.profile === "plate")?.materialColors,
    ).toEqual({ metal: "silver" });
    fireEvent.click(view.getByRole("combobox", { name: "Metal colour" }));
    fireEvent.click(view.getByRole("option", { name: "Inherit item material" }));
    expect(
      appearance().layers.find((layer) => layer.profile === "plate")?.materialColors,
    ).toEqual({ metal: "gold" });
  });

  it("updates unsaved equipment fields and hides unconfigured base equipment", async () => {
    const { result } = renderHook(() =>
      useForm<Fields>({ defaultValues: { lpcProfile: "leather", lpcColor: "gold" } }),
    );
    const view = render(
      <LpcEquipmentFields control={result.current.control} item={item} />,
    );
    const appearance = () =>
      JSON.parse(view.getByTestId("appearance").textContent!) as SpriteAppearance;
    expect(
      appearance().layers.find((layer) => layer.profile === "leather"),
    ).toMatchObject({ profile: "leather", color: "gold" });

    await act(async () => {
      result.current.setValue("lpcProfile", null);
      result.current.setValue("lpcColor", null);
    });
    expect(appearance().layers.find((layer) => layer.slot === "shirt")).toMatchObject({
      profile: "shirt",
      color: "black",
    });

    await act(async () => {
      result.current.setValue("lpcProfile", "NONE");
    });
    expect(view.getByLabelText("Hidden on character")).toBeTruthy();
    expect(appearance().layers.find((layer) => layer.slot === "shirt")?.profile).toBe(
      "shirt",
    );
  });

  it("inherits saved item fields independently of variant names and previews either body", async () => {
    const { result } = renderHook(() =>
      useForm<Fields>({ defaultValues: { lpcProfile: null, lpcColor: null } }),
    );
    const view = render(
      <LpcEquipmentFields
        control={result.current.control}
        item={item}
        variant={{ name: "Crimson edition" }}
      />,
    );
    const appearance = () =>
      JSON.parse(view.getByTestId("appearance").textContent!) as SpriteAppearance;
    expect(
      appearance().layers.find((layer) => layer.profile === "plate"),
    ).toMatchObject({ profile: "plate", color: "blue" });

    await act(async () => {
      result.current.setValue("lpcProfile", "robe");
      result.current.setValue("lpcColor", "green");
    });
    expect(appearance().layers.find((layer) => layer.profile === "robe")).toMatchObject(
      { profile: "robe", color: "green" },
    );
    fireEvent.click(view.getByRole("button", { name: "Slender" }));
    expect(appearance().body).toBe("female");
    expect(
      view.getByRole("button", { name: "Slender" }).getAttribute("aria-pressed"),
    ).toBe("true");

    await act(async () => {
      result.current.setValue("lpcProfile", null);
      result.current.setValue("lpcColor", null);
    });
    view.rerender(
      <LpcEquipmentFields
        control={result.current.control}
        item={item}
        variant={{ name: "Standard edition" }}
      />,
    );
    expect(
      appearance().layers.find((layer) => layer.profile === "plate"),
    ).toMatchObject({ profile: "plate", color: "blue" });
    expect(item.lpcProfile).toBe("plate");
    expect(item.lpcColor).toBe("blue");
  });
});
