import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { LpcDepthThumbnail } from "@/layout/LpcDepthThumbnail";
import * as thumbnail from "@/libs/lpc/thumbnail";
import { lpcAssets } from "../setup/lpc";

const originalImageData = Object.getOwnPropertyDescriptor(globalThis, "ImageData");
const originalObserver = Object.getOwnPropertyDescriptor(
  globalThis,
  "IntersectionObserver",
);
beforeEach(() => {
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: undefined,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const [name, descriptor] of [
    ["ImageData", originalImageData],
    ["IntersectionObserver", originalObserver],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

it("crops transparent overscan without resampling and requests the selected build", async () => {
  Object.defineProperty(globalThis, "ImageData", {
    configurable: true,
    value: class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  });
  const putImageData = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    putImageData,
  } as never);
  const pixels = new Uint8Array(8 * 8 * 4);
  pixels[(2 * 8 + 1) * 4 + 3] = 255;
  pixels[(6 * 8 + 4) * 4 + 3] = 255;
  const load = vi
    .spyOn(thumbnail, "renderLpcThumbnail")
    .mockResolvedValue({ size: 8, pixels });
  const config = lpcAssets[0]!.lpcConfig;
  const view = render(
    <LpcDepthThumbnail config={config} body="female" label="Slender outfit" />,
  );
  const canvas = view.getByRole("img", { name: "Slender outfit" }) as HTMLCanvasElement;
  await waitFor(() => expect(canvas.getAttribute("aria-busy")).toBe("false"));
  expect(load.mock.lastCall?.[2]).toBe("female");
  expect([canvas.width, canvas.height]).toEqual([8, 9]);
  expect(putImageData.mock.lastCall?.slice(1)).toEqual([1, 0]);
  expect(putImageData.mock.lastCall?.[0].data).toEqual(new Uint8ClampedArray(pixels));
});

it("leaves an unreadable thumbnail as a recoverable text placeholder", async () => {
  vi.spyOn(thumbnail, "renderLpcThumbnail").mockRejectedValue(
    new Error("Artwork unavailable"),
  );
  const view = render(
    <LpcDepthThumbnail config={lpcAssets[0]!.lpcConfig} label="Outfit" />,
  );
  await waitFor(() => expect(view.getByText("Preview unavailable")).toBeTruthy());
});
