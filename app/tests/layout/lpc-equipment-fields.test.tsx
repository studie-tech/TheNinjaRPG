import { ensureDom } from "../setup/dom.mjs";
const { act, cleanup, fireEvent, render, renderHook } = await import("@testing-library/react");
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { useForm } from "react-hook-form";
import * as characterPreview from "@/layout/CharacterPreview";
import { LpcEquipmentFields } from "@/layout/LpcEquipmentFields";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import type { LpcColor, SpriteAppearance } from "@/validators/lpc";

type Fields = { lpcProfile: string | null; lpcColor: LpcColor | null };
const item = { id: "staff-preview", name: "Blue armour", slot: "CHEST", itemType: "ARMOR", lpcProfile: "plate", lpcColor: "blue" as const };

beforeEach(() => {
  ensureDom();
  vi.spyOn(characterPreview, "CharacterPreview").mockImplementation(({ user, label }) => (
    <output data-testid="appearance" aria-label={label}>{JSON.stringify(resolveSpriteAppearance(user))}</output>
  ));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("staff equipment preview", () => {
  it("updates unsaved equipment fields and hides unconfigured base equipment", async () => {
    const { result } = renderHook(() => useForm<Fields>({ defaultValues: { lpcProfile: "leather", lpcColor: "gold" } }));
    const view = render(<LpcEquipmentFields control={result.current.control} item={item} />);
    const appearance = () => JSON.parse(view.getByTestId("appearance").textContent!) as SpriteAppearance;
    expect(appearance().layers.find((layer) => layer.slot === "shirt")).toMatchObject({ profile: "leather", color: "gold" });

    await act(async () => { result.current.setValue("lpcProfile", null); result.current.setValue("lpcColor", null); });
    expect(appearance().layers.find((layer) => layer.slot === "shirt")).toMatchObject({ profile: "shirt", color: "black" });

    await act(async () => { result.current.setValue("lpcProfile", "NONE"); });
    expect(view.getByLabelText("Hidden on character")).toBeTruthy();
    expect(appearance().layers.find((layer) => layer.slot === "shirt")?.profile).toBe("shirt");
  });

  it("inherits saved item fields independently of variant names and previews either body", async () => {
    const { result } = renderHook(() => useForm<Fields>({ defaultValues: { lpcProfile: null, lpcColor: null } }));
    const view = render(<LpcEquipmentFields control={result.current.control} item={item} variant={{ name: "Crimson edition" }} />);
    const appearance = () => JSON.parse(view.getByTestId("appearance").textContent!) as SpriteAppearance;
    expect(appearance().layers.find((layer) => layer.slot === "shirt")).toMatchObject({ profile: "plate", color: "blue" });

    await act(async () => { result.current.setValue("lpcProfile", "robe"); result.current.setValue("lpcColor", "green"); });
    expect(appearance().layers.find((layer) => layer.slot === "shirt")).toMatchObject({ profile: "robe", color: "green" });
    fireEvent.click(view.getByRole("button", { name: "Slender" }));
    expect(appearance().body).toBe("female");
    expect(view.getByRole("button", { name: "Slender" }).getAttribute("aria-pressed")).toBe("true");

    await act(async () => { result.current.setValue("lpcProfile", null); result.current.setValue("lpcColor", null); });
    view.rerender(<LpcEquipmentFields control={result.current.control} item={item} variant={{ name: "Standard edition" }} />);
    expect(appearance().layers.find((layer) => layer.slot === "shirt")).toMatchObject({ profile: "plate", color: "blue" });
    expect(item.lpcProfile).toBe("plate");
    expect(item.lpcColor).toBe("blue");
  });
});
