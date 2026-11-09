import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "bun:test";
import { GameAssetPreview } from "@/layout/GameAssetPreview";
import { lpcAssets } from "../setup/lpc";

afterEach(cleanup);

it("anchors mixed-size and trimmed LPC layers in one logical viewport", () => {
  const asset = lpcAssets.find(({ id }) => id === "shirt")!;
  const source = asset.lpcConfig.variants["male/gray/blue"]![0]!;
  const stand = [[0], [1], [2], [3]];
  const view = render(
    <GameAssetPreview
      asset={{
        ...asset,
        frames: 1,
        speed: 50,
        lpcConfig: {
          ...asset.lpcConfig,
          variants: {
            "male/gray/blue": [
              { ...source, z: 35, layout: { cell: 64, columns: 4, clips: { stand } } },
              {
                ...source,
                z: -5,
                layout: {
                  cell: 192,
                  columns: 4,
                  clips: { stand },
                  trim: { x: 70, y: 80, width: 20, height: 25 },
                },
              },
              { ...source, layout: { cell: 128, columns: 4, clips: { slash: stand } } },
            ],
          },
        },
      }}
    />,
  );
  const viewport = view.getByRole("img", { name: asset.name });
  expect(viewport.getAttribute("viewBox")).toBe("0 0 192 192");
  const layers = viewport.querySelectorAll<HTMLDivElement>("foreignObject > div > div");
  expect(layers).toHaveLength(2);
  expect([layers[0]!.style.left, layers[0]!.style.top]).toEqual(["64px", "64px"]);
  expect([layers[1]!.style.left, layers[1]!.style.top]).toEqual(["70px", "80px"]);
  expect([layers[1]!.style.width, layers[1]!.style.height]).toEqual(["20px", "25px"]);
  expect(layers[1]!.style.backgroundPosition).toBe("-45px -1px");
  expect(layers[0]!.style.zIndex).toBe("1035");
  expect(layers[1]!.style.zIndex).toBe("995");
});
