import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { ComponentProps } from "react";
import { useState } from "react";
import * as client from "@/app/_trpc/client";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import * as ContentImageSelector from "@/layout/ContentImageSelector";
import { FurnitureViewsEditor } from "@/layout/FurnitureViewsEditor";
import * as Image from "@/layout/Image";
import { FURNITURE_IMAGE_PROMPT } from "@/libs/imagePrompts";
import type { FurnitureGeometry, FurnitureViews } from "@/validators/itemFurniture";

type MeasurementResult = RouterOutputs["item"]["getFurnitureImageGeometry"];
type MeasurementInput = RouterInputs["item"]["getFurnitureImageGeometry"];
const measurements = new Map<string, MeasurementResult>();
let measurementPending = false;
const refetch = vi.fn();
const measurementCalls: { input: MeasurementInput; enabled: boolean }[] = [];
const pendingMeasurementImages = new Set<string>();
const originalGeometry: FurnitureGeometry = {
  aspectRatio: 4 / 3,
  visibleBounds: { x: 10, y: 10, width: 80, height: 70 },
  footprint: { x: 10, y: 60, width: 80, height: 20 },
};

type SelectorProps = ComponentProps<typeof ContentImageSelector.default>;
let selector: SelectorProps;
const original = "https://example.com/original.webp";
const turns: FurnitureViews = {
  "90": { image: "https://example.com/90.webp", width: 17, groundAnchor: 86 },
  "180": { image: "https://example.com/180.webp", width: 29, groundAnchor: 93 },
};
const onBaseChange = vi.fn();
const onViewsChange = vi.fn();
const props: ComponentProps<typeof FurnitureViewsEditor> = {
  id: "tea-table",
  name: "Tea table",
  description: "Two cups and a pot",
  image: original,
  width: 30,
  groundAnchor: 90,
  geometry: originalGeometry,
  views: turns,
  onBaseChange,
  onViewsChange,
  canEdit: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  measurements.clear();
  measurementCalls.length = 0;
  measurementPending = false;
  pendingMeasurementImages.clear();
  const query = (input: MeasurementInput, options: { enabled: boolean }) => {
    measurementCalls.push({ input, enabled: options.enabled });
    return {
      data: measurements.get(input.image),
      isFetching:
        (measurementPending || pendingMeasurementImages.has(input.image)) &&
        options.enabled,
      refetch,
    };
  };
  Object.assign(vi.spyOn(client, "api" as never), {
    item: { getFurnitureImageGeometry: { useQuery: query } },
    useQueries: (
      queries: (builder: {
        item: { getFurnitureImageGeometry: typeof query };
      }) => unknown[],
    ) => queries({ item: { getFurnitureImageGeometry: query } }),
  });
  // Capture the shared selector contract without generating or uploading external media.
  vi.spyOn(ContentImageSelector, "default").mockImplementation((next) => {
    selector = next;
    return <span>{next.label}</span>;
  });
  vi.spyOn(Image, "default").mockImplementation(({ src, alt, style }) => (
    // biome-ignore lint/performance/noImgElement: isolated furniture preview stub
    <img src={typeof src === "string" ? src : undefined} alt={alt} style={style} />
  ));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Select a real tab while keeping the test focused on the editor's view changes. */
const selectTurn = (view: ReturnType<typeof render>, degrees: number) => {
  fireEvent.mouseDown(view.getByRole("tab", { name: new RegExp(`${degrees}°$`) }), {
    button: 0,
    ctrlKey: false,
  });
};

describe("furniture directional content editor", () => {
  it("uses the canonical original, fixed-camera prompt and intended framing for every turn", () => {
    const view = render(<FurnitureViewsEditor {...props} />);
    expect(selector.referenceImageUrl).toBeUndefined();
    expect(selector.imageUrl).toBe(original);
    expect(selector.preprompt).toBe(FURNITURE_IMAGE_PROMPT);
    expect(selector.provider).toBe("OPENAI");
    expect(selector.prompt).toBe("Tea table Two cups and a pot");

    for (const degrees of [90, 180, 270]) {
      selectTurn(view, degrees);
      expect(selector.referenceImageUrl).toBe(original);
      expect(selector.id).toBe(`tea-table:furniture:${degrees}`);
      expect(selector.preprompt).toBe(FURNITURE_IMAGE_PROMPT);
      expect(selector.provider).toBe("OPENAI");
      expect(selector.prompt).toContain(`${degrees} degrees clockwise`);
      expect(selector.prompt).toContain("original 0-degree image");
      expect(selector.prompt).toContain("Keep the camera");
      expect(selector.size).toBe(degrees === 180 ? "landscape" : "portrait");
      expect(selector.maxDim).toBe(768);
    }
  });

  it("adds an incomplete direction without replacing existing views or their framing", () => {
    const view = render(<FurnitureViewsEditor {...props} />);
    selectTurn(view, 270);
    expect(selector.imageUrl).toBeUndefined();
    expect(selector.emptyImageLabel).toBe("Generate or upload this view");
    expect(view.getByText("Generate or upload this view.")).toBeTruthy();
    selector.onUploadComplete("https://example.com/270.webp");
    expect(onViewsChange).toHaveBeenCalledWith({
      ...turns,
      "270": { image: "https://example.com/270.webp", geometry: undefined },
    });
    expect(onBaseChange).not.toHaveBeenCalled();
  });

  it("replaces only the selected image and removes only the selected direction", () => {
    const view = render(<FurnitureViewsEditor {...props} />);
    selectTurn(view, 90);
    selector.onUploadComplete("https://example.com/corrected.webp");
    expect(onViewsChange).toHaveBeenLastCalledWith({
      ...turns,
      "90": {
        ...turns["90"],
        image: "https://example.com/corrected.webp",
        geometry: undefined,
      },
    });
    fireEvent.click(view.getByRole("button", { name: "Remove this view" }));
    expect(onViewsChange).toHaveBeenLastCalledWith({ "180": turns["180"] });
    expect(onBaseChange).not.toHaveBeenCalled();
  });

  it("keeps per-view footprint and floor anchor independent of the original", () => {
    const view = render(<FurnitureViewsEditor {...props} />);
    selectTurn(view, 90);
    const preview = view.getByRole("img", { name: "90° furniture scene preview" });
    const placed = preview.querySelector<HTMLDivElement>("div[style]");
    expect(placed?.style.width).toBe("17%");
    expect(placed?.style.transform).toBe("translate(-50%, -86%)");
    fireEvent.input(view.getByRole("spinbutton", { name: "Scene width (%)" }), {
      target: { value: "19.5" },
    });
    expect(onViewsChange).toHaveBeenLastCalledWith({
      ...turns,
      "90": { ...turns["90"], width: 19.5 },
    });
    fireEvent.input(view.getByRole("spinbutton", { name: "Ground anchor (%)" }), {
      target: { value: "88" },
    });
    expect(onViewsChange).toHaveBeenLastCalledWith({
      ...turns,
      "90": { ...turns["90"], groundAnchor: 88 },
    });
    expect(onBaseChange).not.toHaveBeenCalled();
  });

  it("edits canonical geometry and image through the original fields", () => {
    const view = render(<FurnitureViewsEditor {...props} />);
    fireEvent.input(view.getByRole("spinbutton", { name: "Scene width (%)" }), {
      target: { value: "32" },
    });
    expect(onBaseChange).toHaveBeenLastCalledWith({ width: 32 });
    selector.onUploadComplete("https://example.com/new-original.webp");
    expect(onBaseChange).toHaveBeenLastCalledWith({
      image: "https://example.com/new-original.webp",
      geometry: undefined,
    });
    expect(onViewsChange).not.toHaveBeenCalled();
    expect(view.queryByRole("button", { name: "Remove this view" })).toBeNull();
  });

  it("measures original cutouts, reports pending work and preserves source aspect in previews", () => {
    measurements.set(original, {
      success: true,
      message: "Measured",
      image: original,
      useFullFootprint: false,
      geometry: originalGeometry,
    });
    const onMeasurementPendingChange = vi.fn();
    const view = render(
      <FurnitureViewsEditor
        {...props}
        views={{}}
        geometry={undefined}
        onMeasurementPendingChange={onMeasurementPendingChange}
      />,
    );
    expect(onBaseChange).toHaveBeenCalledWith({
      geometry: originalGeometry,
      groundAnchor: 80,
    });
    expect(
      measurementCalls.find(
        ({ input, enabled }) => input.image === original && enabled,
      ),
    ).toBeTruthy();
    expect(onMeasurementPendingChange).toHaveBeenLastCalledWith(true);

    view.rerender(
      <FurnitureViewsEditor
        {...props}
        views={{}}
        geometry={{ ...originalGeometry, aspectRatio: 0.75 }}
        onMeasurementPendingChange={onMeasurementPendingChange}
      />,
    );
    expect(onMeasurementPendingChange).toHaveBeenLastCalledWith(false);
    const preview = view.getByRole("img", { name: "0° furniture scene preview" });
    expect(
      Number.parseFloat(
        preview.querySelector<HTMLDivElement>("div[style]")?.style.aspectRatio ?? "",
      ),
    ).toBe(0.75);
  });

  it("matches the original's painted length when a new view has a portrait canvas", () => {
    const portrait: FurnitureGeometry = {
      aspectRatio: 0.75,
      visibleBounds: { x: 20, y: 5, width: 60, height: 90 },
      footprint: { x: 20, y: 70, width: 60, height: 25 },
    };
    measurements.set(turns["90"]!.image, {
      success: true,
      message: "Measured",
      image: turns["90"]!.image,
      useFullFootprint: false,
      geometry: portrait,
    });
    const view = render(
      <FurnitureViewsEditor {...props} geometry={originalGeometry} />,
    );
    selectTurn(view, 90);
    const next = onViewsChange.mock.calls[0]?.[0]["90"];
    expect(next).toMatchObject({
      image: turns["90"]!.image,
      geometry: portrait,
      groundAnchor: 95,
    });
    expect(next.width).toBeCloseTo(14);
    expect(onBaseChange).not.toHaveBeenCalled();
  });

  it.each([
    {
      degrees: 90,
      geometry: {
        aspectRatio: 0.75,
        visibleBounds: { x: 22.9282, y: 11.9475, width: 54.2357, height: 75.2762 },
        footprint: { x: 22.9282, y: 18.7224, width: 54.2357, height: 68.5014 },
      },
      expectedWidth: 19.0813,
    },
    {
      degrees: 180,
      geometry: {
        aspectRatio: 4 / 3,
        visibleBounds: { x: 7.0442, y: 22.0074, width: 86.0497, height: 57.5506 },
        footprint: { x: 7.0442, y: 27.7624, width: 86.0497, height: 51.7956 },
      },
      expectedWidth: 31.7949,
    },
  ])(
    "matches catalogue bed calibration at $degrees degrees",
    ({ degrees, geometry, expectedWidth }) => {
      const key = String(degrees) as "90" | "180";
      const source: FurnitureGeometry = {
        aspectRatio: 4 / 3,
        visibleBounds: { x: 9.8958, y: 33.1597, width: 80.4688, height: 57.8125 },
        footprint: { x: 9.8958, y: 38.941, width: 80.4688, height: 52.0312 },
      };
      measurements.set(turns[key]!.image, {
        success: true,
        message: "Measured",
        image: turns[key]!.image,
        useFullFootprint: false,
        geometry,
      });
      const view = render(
        <FurnitureViewsEditor {...props} width={34} geometry={source} />,
      );
      selectTurn(view, degrees);
      expect(onViewsChange.mock.calls[0]?.[0][key].width).toBeCloseTo(expectedWidth, 4);
    },
  );

  it("finishes measuring the original after a tab switch and waits before generating turns", () => {
    const view = render(<FurnitureViewsEditor {...props} geometry={undefined} />);
    selectTurn(view, 90);
    expect(selector.disabled).toBe(true);
    measurements.set(original, {
      success: true,
      message: "Measured",
      image: original,
      useFullFootprint: false,
      geometry: originalGeometry,
    });
    view.rerender(<FurnitureViewsEditor {...props} geometry={undefined} />);
    expect(onBaseChange).toHaveBeenCalledWith({
      geometry: originalGeometry,
      groundAnchor: 80,
    });
    view.rerender(<FurnitureViewsEditor {...props} />);
    expect(selector.disabled).toBe(false);
  });

  it("discards stale geometry on replacement and ignores measurements for another image", () => {
    const view = render(
      <FurnitureViewsEditor
        {...props}
        geometry={originalGeometry}
        views={{ ...turns, "90": { ...turns["90"]!, geometry: originalGeometry } }}
      />,
    );
    selectTurn(view, 90);
    selector.onUploadComplete("https://example.com/recreated.webp");
    expect(onViewsChange.mock.calls[0]?.[0]["90"].geometry).toBeUndefined();
    measurements.set(original, {
      success: true,
      message: "Measured",
      image: "https://example.com/stale.webp",
      useFullFootprint: false,
      geometry: originalGeometry,
    });
    onBaseChange.mockClear();
    view.rerender(<FurnitureViewsEditor {...props} />);
    expect(onBaseChange).not.toHaveBeenCalled();
  });

  it("edits floor footprints without changing the silhouette and constrains them to the canvas", () => {
    const view = render(
      <FurnitureViewsEditor {...props} geometry={originalGeometry} />,
    );
    fireEvent.input(
      view.getByRole("spinbutton", { name: "Footprint x (%)", hidden: true }),
      { target: { value: "90" } },
    );
    expect(onBaseChange).toHaveBeenCalledWith({
      geometry: {
        ...originalGeometry,
        footprint: { ...originalGeometry.footprint, x: 20 },
      },
    });
  });

  it("waits for portrait measurements before accepting footprint edits", () => {
    measurementPending = true;
    function UpdatingFurniture() {
      const [geometry, setGeometry] = useState<FurnitureGeometry>();
      return (
        <FurnitureViewsEditor
          {...props}
          geometry={geometry}
          onBaseChange={(change) => {
            onBaseChange(change);
            if ("geometry" in change) setGeometry(change.geometry);
          }}
        />
      );
    }
    const view = render(<UpdatingFurniture />);
    const footprint = view.getByRole("spinbutton", {
      name: "Footprint x (%)",
      hidden: true,
    }) as HTMLInputElement;
    expect(footprint.disabled).toBe(true);
    fireEvent.input(footprint, { target: { value: "12" } });
    expect(onBaseChange).not.toHaveBeenCalled();
    const portrait = { ...originalGeometry, aspectRatio: 0.75 };
    measurementPending = false;
    measurements.set(original, {
      success: true,
      message: "Measured",
      image: original,
      useFullFootprint: false,
      geometry: portrait,
    });
    view.rerender(<UpdatingFurniture />);
    expect(onBaseChange).toHaveBeenCalledWith({ geometry: portrait, groundAnchor: 80 });
    expect(footprint.disabled).toBe(false);
  });

  it("keeps unfinished turns pending across tab changes and publishes their measurements offscreen", () => {
    pendingMeasurementImages.add(turns["90"]!.image);
    const onMeasurementPendingChange = vi.fn();
    function UpdatingFurniture() {
      const [views, setViews] = useState<FurnitureViews>({
        ...turns,
        "180": { ...turns["180"]!, geometry: originalGeometry },
      });
      return (
        <FurnitureViewsEditor
          {...props}
          views={views}
          onMeasurementPendingChange={onMeasurementPendingChange}
          onViewsChange={(next) => {
            onViewsChange(next);
            setViews(next);
          }}
        />
      );
    }
    const view = render(<UpdatingFurniture />);
    selectTurn(view, 90);
    expect(onMeasurementPendingChange).toHaveBeenLastCalledWith(true);
    selectTurn(view, 180);
    expect(onMeasurementPendingChange).toHaveBeenLastCalledWith(true);
    expect(view.getByRole("status")).toBeTruthy();
    const portrait: FurnitureGeometry = {
      aspectRatio: 0.75,
      visibleBounds: { x: 20, y: 5, width: 60, height: 90 },
      footprint: { x: 20, y: 70, width: 60, height: 25 },
    };
    pendingMeasurementImages.clear();
    measurements.set(turns["90"]!.image, {
      success: true,
      message: "Measured",
      image: turns["90"]!.image,
      useFullFootprint: false,
      geometry: portrait,
    });
    view.rerender(<UpdatingFurniture />);
    expect(onViewsChange.mock.calls.at(-1)?.[0]["90"]).toMatchObject({
      geometry: portrait,
      groundAnchor: 95,
    });
    expect(onMeasurementPendingChange).toHaveBeenLastCalledWith(false);
    expect(view.getByRole("tab", { name: "180°" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("keeps a failed offscreen measurement recoverable and blocks publishing its fallback geometry", () => {
    const onMeasurementPendingChange = vi.fn();
    measurements.set(turns["90"]!.image, {
      success: false,
      message: "90° cutout needs transparency",
      geometry: null,
    });
    const view = render(
      <FurnitureViewsEditor
        {...props}
        views={{ ...turns, "180": { ...turns["180"]!, geometry: originalGeometry } }}
        onMeasurementPendingChange={onMeasurementPendingChange}
      />,
    );
    selectTurn(view, 180);
    expect(view.getByRole("alert").textContent).toContain(
      "90° cutout needs transparency",
    );
    expect(onMeasurementPendingChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(view.getByRole("button", { name: "Retry measurement" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows recoverable measurement failures beside the affected image", () => {
    measurements.set(original, {
      success: false,
      message: "Choose a transparent cutout",
      geometry: null,
    });
    const view = render(<FurnitureViewsEditor {...props} geometry={undefined} />);
    expect(view.getByRole("alert").textContent).toContain(
      "Choose a transparent cutout",
    );
    fireEvent.click(view.getByRole("button", { name: "Retry measurement" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(onBaseChange).not.toHaveBeenCalled();
  });

  it("notifies the enclosing form while measurements are pending", () => {
    measurementPending = true;
    const onMeasurementPendingChange = vi.fn();
    const view = render(
      <FurnitureViewsEditor
        {...props}
        geometry={undefined}
        onMeasurementPendingChange={onMeasurementPendingChange}
      />,
    );
    expect(onMeasurementPendingChange).toHaveBeenLastCalledWith(true);
    expect(view.getByRole("status").textContent).toContain("Measuring");
    view.unmount();
    expect(onMeasurementPendingChange).toHaveBeenLastCalledWith(false);
  });

  it("requires an original before creating a turn and exposes recoverable missing-view feedback", () => {
    const view = render(<FurnitureViewsEditor {...props} image="" views={{}} />);
    selectTurn(view, 90);
    expect(selector.disabled).toBe(true);
    expect(selector.referenceImageUrl).toBeUndefined();
    expect(view.getByText("Create the original image first.")).toBeTruthy();
    expect(view.queryByRole("spinbutton")).toBeNull();
  });

  it("lets staff prepare framing suggestions without permission to change images", () => {
    const view = render(<FurnitureViewsEditor {...props} canEdit={false} />);
    expect(selector.allowImageUpload).toBe(false);
    expect(selector.disabled).toBe(true);
    selector.onUploadComplete("https://example.com/blocked-original.webp");
    expect(onBaseChange).not.toHaveBeenCalled();

    const originalWidth = view.getByRole("spinbutton", {
      name: "Scene width (%)",
    }) as HTMLInputElement;
    const originalAnchor = view.getByRole("spinbutton", {
      name: "Ground anchor (%)",
    }) as HTMLInputElement;
    expect(originalWidth.disabled).toBe(false);
    expect(originalAnchor.disabled).toBe(false);
    fireEvent.input(originalWidth, { target: { value: "32" } });
    expect(onBaseChange).toHaveBeenLastCalledWith({ width: 32 });
    fireEvent.input(originalAnchor, { target: { value: "91" } });
    expect(onBaseChange).toHaveBeenLastCalledWith({ groundAnchor: 91 });

    selectTurn(view, 90);
    expect(selector.imageUrl).toBe(turns["90"]?.image);
    expect(selector.allowImageUpload).toBe(false);
    expect(selector.disabled).toBe(true);
    expect(view.queryByRole("button", { name: "Remove this view" })).toBeNull();
    selector.onUploadComplete("https://example.com/blocked-turn.webp");
    expect(onViewsChange).not.toHaveBeenCalled();

    const turnWidth = view.getByRole("spinbutton", {
      name: "Scene width (%)",
    }) as HTMLInputElement;
    const turnAnchor = view.getByRole("spinbutton", {
      name: "Ground anchor (%)",
    }) as HTMLInputElement;
    expect(turnWidth.value).toBe("17");
    expect(turnAnchor.value).toBe("86");
    expect(turnWidth.disabled).toBe(false);
    expect(turnAnchor.disabled).toBe(false);
    fireEvent.input(turnWidth, { target: { value: "19.5" } });
    expect(onViewsChange).toHaveBeenLastCalledWith({
      ...turns,
      "90": { ...turns["90"], width: 19.5 },
    });
    fireEvent.input(turnAnchor, { target: { value: "88" } });
    expect(onViewsChange).toHaveBeenLastCalledWith({
      ...turns,
      "90": { ...turns["90"], groundAnchor: 88 },
    });
    expect(onViewsChange).toHaveBeenCalledTimes(2);
    expect(onBaseChange).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])(
    "blocks image and framing changes while saving (canEdit=%s)",
    (canEdit) => {
      const view = render(
        <FurnitureViewsEditor {...props} canEdit={canEdit} disabled />,
      );
      for (const degrees of [0, 90]) {
        if (degrees) selectTurn(view, degrees);
        expect(selector.disabled).toBe(true);
        selector.onUploadComplete("https://example.com/stale.webp");
        for (const name of ["Scene width (%)", "Ground anchor (%)"]) {
          const input = view.getByRole("spinbutton", { name }) as HTMLInputElement;
          expect(input.disabled).toBe(true);
          fireEvent.input(input, { target: { value: "20" } });
        }
        const remove = view.queryByRole("button", {
          name: "Remove this view",
        }) as HTMLButtonElement | null;
        if (remove) {
          expect(remove.disabled).toBe(true);
          fireEvent.click(remove);
        }
      }
      expect(onViewsChange).not.toHaveBeenCalled();
      expect(onBaseChange).not.toHaveBeenCalled();
    },
  );
});
