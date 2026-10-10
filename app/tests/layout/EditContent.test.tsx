import { ensureDom } from "../setup-dom.mjs";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { MassEffectEditor } from "@/layout/EditContent";
import { DamageTag, HealTag, type ZodAllTags } from "@/validators/combat";

const save = vi.fn(async (_input: { id: string; data: { effects: ZodAllTags[] } }) => ({
  success: true,
  message: "Saved",
}));
const pending = vi.fn();
const toast = vi.fn();
const names = { useQuery: () => ({ data: [] }) };
const update = { useMutation: () => ({ mutateAsync: save }) };

vi.mock("@/app/_trpc/client", () => ({
  api: {
    profile: { getAllAiNames: names },
    item: { getAllNames: names, update },
    jutsu: { getAllNames: names, update },
    bloodline: { getAllNames: names, update },
    sageMode: { getAllNames: names },
    misc: { getAllGameAssetNames: names },
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/libs/toast", () => ({ showMutationToast: toast }));
vi.mock("@/layout/ContentImageSelector", () => ({ default: () => null }));

beforeEach(() => {
  ensureDom();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("MassEffectEditor numeric drafts", () => {
  for (const kind of ["item", "jutsu", "bloodline"] as const) {
    it(`validates all ${kind} effect rows for the saved entry and retains invalid drafts`, async () => {
      const entries = [
        {
          id: "first",
          name: "First",
          effects: [DamageTag.parse({}), DamageTag.parse({})],
          updatedAt: new Date(),
        },
        {
          id: "second",
          name: "Second",
          effects: [DamageTag.parse({})],
          updatedAt: new Date(),
        },
      ];
      const view = render(
        <MassEffectEditor
          kind={kind}
          entries={entries}
          selectedFields={["power"]}
          onPendingChange={pending}
        />,
      );
      const inputs = view.getAllByRole("spinbutton") as HTMLInputElement[];
      const invalid = inputs[1]!;
      const reportValidity = vi.spyOn(invalid, "reportValidity");
      fireEvent.input(invalid, { target: { value: "" } });
      fireEvent.click(
        view.getAllByRole("button", { name: `Save ${kind} effects for First` })[0]!,
      );

      expect(reportValidity).toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(pending).not.toHaveBeenCalled();
      expect(invalid.value).toBe("");
      expect(invalid.getAttribute("aria-invalid")).toBe("true");
      expect(view.container.firstElementChild?.getAttribute("aria-busy")).toBe("false");

      fireEvent.click(
        view.getByRole("button", { name: `Save ${kind} effects for Second` }),
      );
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false));
      expect(save.mock.calls[0]?.[0]).toMatchObject({ id: "second" });
      expect(invalid.value).toBe("");

      fireEvent.input(inputs[0]!, { target: { value: "3.5" } });
      fireEvent.input(invalid, { target: { value: "7" } });
      fireEvent.click(
        view.getAllByRole("button", { name: `Save ${kind} effects for First` })[0]!,
      );
      await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      expect(save.mock.calls[1]?.[0]).toMatchObject({
        id: "first",
        data: { effects: [{ power: 3.5 }, { power: 7 }] },
      });
      await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false));
    });

    it(`blocks ${kind} drafts after their numeric field or effect row is hidden`, async () => {
      const entries = [
        {
          id: "first",
          name: "First",
          effects: [DamageTag.parse({}), DamageTag.parse({}), HealTag.parse({})],
          updatedAt: new Date(),
        },
      ];
      const mount = (selectedFields: string[], filterEffectTypes?: string[]) => (
        <MassEffectEditor
          kind={kind}
          entries={entries}
          selectedFields={selectedFields}
          filterEffectTypes={filterEffectTypes}
          onPendingChange={pending}
        />
      );
      const view = render(mount(["power"]));
      fireEvent.input(view.getAllByRole("spinbutton")[1]!, { target: { value: "" } });
      view.rerender(mount(["description"]));
      fireEvent.click(
        view.getAllByRole("button", { name: `Save ${kind} effects for First` })[0]!,
      );
      expect(save).not.toHaveBeenCalled();
      expect(pending).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith({
        success: false,
        message: expect.any(String),
      });
      view.rerender(mount(["power"], ["heal"]));
      fireEvent.click(
        view.getByRole("button", { name: `Save ${kind} effects for First` }),
      );
      expect(save).not.toHaveBeenCalled();
      expect(pending).not.toHaveBeenCalled();
      view.rerender(mount(["power"]));
      expect((view.getAllByRole("spinbutton")[1] as HTMLInputElement).value).toBe("");
      fireEvent.input(view.getAllByRole("spinbutton")[1]!, { target: { value: "7" } });
      fireEvent.click(
        view.getAllByRole("button", { name: `Save ${kind} effects for First` })[0]!,
      );
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false));
    });
  }
});
