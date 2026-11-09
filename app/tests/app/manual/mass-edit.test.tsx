import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import BloodlineMassEditPage from "@/app/[shell]/manual/bloodline/mass_edit/page";
import ItemMassEditPage from "@/app/[shell]/manual/item/mass_edit/page";
import JutsuMassEditPage from "@/app/[shell]/manual/jutsu/mass_edit/page";
import * as BloodlineFiltering from "@/layout/BloodlineFiltering";
import * as ItemFiltering from "@/layout/ItemFiltering";
import * as JutsuFiltering from "@/layout/JutsuFiltering";
import * as MassEffectEditorPage from "@/layout/MassEffectEditorPage";
import * as pagination from "@/libs/pagination";

const effect = ["damage"];
const getAll = {
  useInfiniteQuery: () => ({
    data: { pages: [] },
    isFetching: false,
    fetchNextPage: async () => undefined,
    hasNextPage: false,
    refetch: async () => undefined,
  }),
};
let editor: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  editor = vi
    .spyOn(MassEffectEditorPage, "MassEffectEditorPage")
    .mockImplementation(() => <div />);
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  for (const filtering of [ItemFiltering, BloodlineFiltering, JutsuFiltering]) {
    vi.spyOn(filtering, "useFiltering").mockReturnValue({ effect } as never);
    vi.spyOn(filtering, "getFilter").mockReturnValue({} as never);
  }
  Object.assign(vi.spyOn(client, "api" as never), {
    item: { getAll },
    bloodline: { getAll },
    jutsu: { getAll },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([
  ["item", ItemMassEditPage],
  ["bloodline", BloodlineMassEditPage],
  ["jutsu", JutsuMassEditPage],
])("narrows %s mass edit to the effect types selected in its filter", (_kind, Page) => {
  render(<Page />);
  expect(editor.mock.calls.at(-1)?.[0]).toEqual(
    expect.objectContaining({ filterEffectTypes: effect }),
  );
});
