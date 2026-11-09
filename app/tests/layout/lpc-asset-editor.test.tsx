import { zodResolver } from "@hookform/resolvers/zod";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { useForm } from "react-hook-form";
import * as client from "@/app/_trpc/client";
import * as preview from "@/layout/CharacterPreview";
import { LpcAssetEditor } from "@/layout/LpcAssetEditor";
import * as uploads from "@/utils/uploadthing";
import type { ZodGameAssetInput, ZodGameAssetType } from "@/validators/asset";
import { gameAssetValidator } from "@/validators/asset";
import { lpcAssets } from "../setup/lpc";

beforeEach(() => {
  Object.assign(vi.spyOn(client, "api" as never), {
    gameAsset: {
      getLpcCatalog: {
        useQuery: () => ({
          data: lpcAssets,
          error: null,
          refetch: async () => undefined,
        }),
      },
      prepareLpcSheet: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  });
  vi.spyOn(preview, "CharacterPreview").mockImplementation(() => <div>Preview</div>);
  vi.spyOn(uploads, "UploadButton").mockImplementation(() => (
    <button type="button">Upload</button>
  ));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("discards an unapplied layout draft when selecting a variant with an identical saved layout", async () => {
  const asset = lpcAssets.find((entry) => entry.id === "shirt")!;
  const { result } = renderHook(() =>
    useForm<ZodGameAssetInput, unknown, ZodGameAssetType>({ defaultValues: asset }),
  );
  const view = render(
    <LpcAssetEditor
      id={asset.id}
      name={asset.name}
      form={result.current}
      disabled={false}
      onBusyChange={() => {}}
    />,
  );
  fireEvent.change(view.getByLabelText("Upload format"), {
    target: { value: "packed" },
  });
  const layout = view.getByRole("textbox", {
    name: /Frame layout/,
  }) as HTMLTextAreaElement;
  const original = layout.value;
  await act(async () => {
    fireEvent.change(layout, { target: { value: '{"columns":0}' } });
  });
  expect(layout.value).toBe('{"columns":0}');
  await act(async () => {
    fireEvent.change(view.getByLabelText("Body style"), {
      target: { value: "female" },
    });
  });
  expect(layout.value).toBe(original);
});

it("reveals invalid attribution on save and keeps the draft editable through recovery", async () => {
  const source = lpcAssets.find((entry) => entry.id === "shirt")!;
  const asset = {
    ...source,
    frames: 1,
    speed: 50,
    onInitialBattleField: false,
    lpcConfig: {
      ...source.lpcConfig,
      attributions: [
        { authors: [], licenses: ["TNR"], chosenLicense: "TNR", urls: [], notes: "" },
      ],
    },
  };
  const { result } = renderHook(() =>
    useForm<ZodGameAssetInput, unknown, ZodGameAssetType>({
      defaultValues: asset,
      resolver: zodResolver(gameAssetValidator),
    }),
  );
  const view = render(
    <LpcAssetEditor
      id={asset.id}
      name={asset.name}
      form={result.current}
      disabled={false}
      onBusyChange={() => {}}
    />,
  );
  const details = view.getByText("Attribution and source details").closest("details")!;
  expect(details.open).toBe(false);
  const save = vi.fn();
  await act(async () => {
    await result.current.handleSubmit(save)();
  });
  expect(save).not.toHaveBeenCalled();
  expect(details.open).toBe(true);
  expect(view.getByText(/Enter at least one artist/)).toBeDefined();
  const artists = view.getByLabelText("Artists (required, one per line)");
  expect(artists.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(artists);
  await act(async () => {
    fireEvent.change(artists, { target: { value: "QA artist" } });
  });
  expect(view.queryByText(/Enter at least one artist/)).toBeNull();
  expect(details.open).toBe(true);
  const addCredit = view.getByRole("button", { name: "Add credit" });
  addCredit.focus();
  await act(async () => {
    fireEvent.click(addCredit);
  });
  expect(document.activeElement).toBe(addCredit);
  const secondArtist = view.getAllByLabelText("Artists (required, one per line)")[1]!;
  secondArtist.focus();
  await act(async () => {
    fireEvent.change(secondArtist, { target: { value: "Second artist" } });
  });
  expect(document.activeElement).toBe(secondArtist);
  await act(async () => {
    await result.current.handleSubmit(save)();
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(result.current.getValues("lpcConfig.variants")).toEqual(
    asset.lpcConfig.variants,
  );
});
