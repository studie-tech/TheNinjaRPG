import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { type ComponentProps, type ImgHTMLAttributes, useState } from "react";
import {
  HOME_FLOOR_TILES,
  HOME_FURNITURE_MAX_PLACEMENTS,
  HOME_WALL_PAINTS,
  type HomeType,
  HomeTypeDetails,
  HomeTypes,
  IMG_HOME_PROPERTIES,
} from "@/drizzle/constants";
import { HomeScene as ResidenceScene } from "@/layout/HomeScene";
import * as Image from "@/layout/Image";
import {
  type HomeFurniture,
  homeLayoutPlacementError,
  projectHomePlacement,
  unprojectHomePlacement,
} from "@/libs/home";
import {
  boundHomeCamera,
  getHomeOverviewCamera,
  getHomePlacementRoom,
  getHomeRoomCamera,
  getHomeRooms,
  type HomeCamera,
  zoomHomeCamera,
} from "@/libs/homeProperty";
import { HOME_ART_PLANS, HOME_FLOOR_PROJECTION } from "@/libs/homeRoomGeometry";
import { bunnyImageUrl, transformImageUrl } from "@/utils/image";
import { type HomePlacement, homeFurnitureSaveInputSchema } from "@/validators/home";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { deferred } from "../setup/deferred";

/** The page header owns decoration; this wrapper keeps that state through scene rerenders. */
const HomeScene = (
  props: Omit<
    ComponentProps<typeof ResidenceScene>,
    "isDecorating" | "onDecoratingChange"
  > & { isRefreshingFurniture?: boolean },
) => {
  const [isDecorating, setIsDecorating] = useState(false);
  return (
    <>
      {props.canDecorate && (
        <button
          type="button"
          disabled={isDecorating || props.isRefreshingFurniture}
          onClick={() => setIsDecorating(true)}
        >
          Decorate
        </button>
      )}
      <ResidenceScene
        {...props}
        isDecorating={isDecorating}
        onDecoratingChange={setIsDecorating}
      />
    </>
  );
};

const starterFurniture: HomeFurniture[] = [
  {
    id: "owned-bed",
    itemId: "home-bed",
    name: "Bed",
    image: "https://ui0arpl8sm.ufs.sh/f/V2umBvRsN1p0ECHU5FA5r.webp",
    width: 34,
    groundAnchor: 91.1,
    action: "sleep",
    isFloor: false,
    quantity: 1,
    views: {},
  },
  {
    id: "owned-armory",
    itemId: "home-armory",
    name: "Armory",
    image: "https://ui0arpl8sm.ufs.sh/f/EyNeihgG6GdMTMBcOC9JA.webp",
    width: 24,
    groundAnchor: 95.8,
    action: "storage",
    isFloor: false,
    quantity: 1,
    views: {},
  },
  {
    id: "owned-kitchen",
    itemId: "home-kitchen",
    name: "Kitchen",
    image: "https://ui0arpl8sm.ufs.sh/f/i520XbXoRXRYIZrNImg62.webp",
    width: 32,
    groundAnchor: 89.1,
    action: "kitchen",
    isFloor: false,
    quantity: 1,
    views: {},
  },
  {
    id: "owned-garden",
    itemId: "home-garden",
    name: "Garden",
    image: "https://ui0arpl8sm.ufs.sh/f/cInj_p_PE20tF9FWO_frE.webp",
    width: 10,
    groundAnchor: 88.3,
    geometry: {
      aspectRatio: 4 / 3,
      visibleBounds: { x: 0, y: 40, width: 100, height: 60 },
      footprint: { x: 10, y: 85, width: 80, height: 15 },
    },
    action: "farm",
    isFloor: false,
    quantity: 1,
    views: {},
  },
];
const rugDefinition: HomeFurniture = {
  id: "owned-rug",
  itemId: "custom-rug",
  name: "Woven Rug",
  image: "/custom-rug.webp",
  width: 25,
  groundAnchor: 88.5,
  action: null,
  isFloor: true,
  quantity: 1,
  views: { "90": { image: "/custom-rug-90.webp" } },
};

const props = {
  homeType: "NONE" as const,
  isGuest: false,
  isAsleep: false,
  isTogglingSleep: false,
  onSleep: vi.fn(),
  onStorage: vi.fn(),
  onKitchen: vi.fn(),
  onFarm: vi.fn(),
  furniture: starterFurniture,
  layout: [
    { id: "owned-bed", x: 22, y: 15.15, rotation: 0 as const },
    { id: "owned-armory", x: 75, y: 15.15, rotation: 0 as const },
    { id: "owned-kitchen", x: 76, y: 57.58, rotation: 0 as const },
    { id: "owned-garden", x: 86, y: 90.91, rotation: 0 as const },
  ],
};
const essentialFurniture = starterFurniture.slice(0, 3);
const essentialLayout = props.layout.slice(0, 3);
const centeredEssentialsLayout = [
  { id: "owned-bed", x: 50, y: 50, rotation: 0 as const },
  { id: "owned-armory", x: 20, y: 15.15, rotation: 0 as const },
  { id: "owned-kitchen", x: 73, y: 15.15, rotation: 0 as const },
];

beforeEach(() => {
  installBrowserGlobals();
  // The image stub exposes art failures without relying on a browser image loader.
  vi.spyOn(Image, "default").mockImplementation((({
    src,
    alt,
    onError,
    style,
  }: ImgHTMLAttributes<HTMLImageElement>) => (
    // biome-ignore lint/performance/noImgElement: isolated image-failure test stub
    <img src={src} alt={alt} onError={onError} style={style} />
  )) as never);
});
afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
  vi.restoreAllMocks();
});

/** Regression coverage for residence navigation, owner access, and artwork recovery. */
describe("Home scene", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([...HomeTypes])(
    "renders %s as one complete property with depth masks from the same painting",
    (homeType) => {
      const view = render(<HomeScene {...props} homeType={homeType} />);
      const scene = view.getByRole("group", { name: "Home scene" });
      const plan = HOME_ART_PLANS[homeType];
      const painting = view.getByAltText(
        `${HomeTypeDetails[homeType].name} interior and garden`,
      );
      expect(painting.getAttribute("src")).toBe(
        bunnyImageUrl(IMG_HOME_PROPERTIES[homeType].ground, 1448),
      );
      const mobileSource = painting.closest("picture")!.querySelector("source")!;
      expect(mobileSource.getAttribute("media")).toBe("(max-width: 768px)");
      expect(mobileSource.getAttribute("srcset")).toBe(
        bunnyImageUrl(IMG_HOME_PROPERTIES[homeType].ground, 960),
      );
      const art = scene.querySelector<HTMLElement>("[data-home-art]")!;
      expect(art.style.width).toBe(`${plan.size}%`);
      expect(art.style.height).toBe(`${plan.size}%`);
      const foreground = [
        ...scene.querySelectorAll<HTMLElement>("[data-home-foreground]"),
      ];
      expect(foreground).toHaveLength(plan.foreground.length);
      expect(foreground.length).toBeGreaterThan(0);
      foreground.forEach((mask, index) => {
        const { polygon, depth } = plan.foreground[index]!;
        expect(mask.querySelector("img")?.getAttribute("src")).toBe(
          painting.getAttribute("src"),
        );
        expect(mask.querySelector("source")?.outerHTML).toBe(mobileSource.outerHTML);
        expect(mask.style.clipPath).toBe(
          `polygon(${polygon.map(([x, y]) => `${x}% ${y}%`).join(",")})`,
        );
        expect(mask.style.zIndex).toBe(`${Math.round((depth * plan.size) / 10)}`);
      });
      expect(view.queryByLabelText("Jump to room")).toBeNull();
      expect(
        view
          .getByRole("group", { name: "Property navigation" })
          .closest('[aria-label="Home scene"]'),
      ).toBe(scene);
      expect(
        scene.querySelector("[data-home-camera]")?.getAttribute("style"),
      ).toContain(`scale(${getHomeOverviewCamera(homeType).scale})`);
      expect(view.getByLabelText("Camera zoom").textContent).toBe("100%");
    },
  );

  it.each(
    HomeTypes.flatMap((homeType) =>
      (
        [
          ["ground", "ground"],
          ["dessert", "dessert"],
          ["ice", "snow"],
        ] as const
      ).map(([biome, terrain]) => ({ homeType, biome, terrain })),
    ),
  )(
    "uses one matching $homeType/$biome painting for the home, garden and foreground",
    ({ homeType, biome, terrain }) => {
      const view = render(<HomeScene {...props} homeType={homeType} biome={biome} />);
      const scene = view.getByRole("group", { name: "Home scene" });
      const source = bunnyImageUrl(IMG_HOME_PROPERTIES[homeType][terrain], 1448);
      expect(
        view
          .getByAltText(`${HomeTypeDetails[homeType].name} interior and garden`)
          .getAttribute("src"),
      ).toBe(source);
      expect(
        scene.querySelector("[data-home-biome]")?.getAttribute("data-home-biome"),
      ).toBe(terrain);
      expect(
        [...scene.querySelectorAll("[data-home-foreground] img")].every(
          (image) => image.getAttribute("src") === source,
        ),
      ).toBe(true);
      fireEvent.click(view.getByRole("button", { name: "Bed: Go to sleep" }));
      expect(props.onSleep).toHaveBeenCalledTimes(1);
    },
  );

  it.each(Object.keys(HOME_FLOOR_TILES) as (keyof typeof HOME_FLOOR_TILES)[])(
    "clips %s to the authored floor and leaves the garden painting intact",
    (material) => {
      const view = render(
        <HomeScene
          {...props}
          homeType="TOWN_HOUSE"
          canDecorate
          styles={[
            { room: "room-1", paint: "sage", floor: material },
            { room: "yard", paint: "rose", floor: "terracotta" },
          ]}
        />,
      );
      const scene = view.getByRole("group", { name: "Home scene" });
      expect(scene.querySelectorAll("[data-home-room-style]")).toHaveLength(
        material === "original" ? 0 : 1,
      );
      const floor = scene.querySelector('[data-home-room-style="room-1"] image');
      const surfaces = HOME_ART_PLANS.TOWN_HOUSE.floorSurfaces[1]!;
      if (material === "original") expect(floor).toBeNull();
      else {
        expect(floor?.getAttribute("href")).toBe(
          transformImageUrl(HOME_FLOOR_TILES[material]),
        );
        const pattern = floor?.closest("pattern");
        const finish = scene.querySelector('[data-home-room-style="room-1"] rect');
        expect(finish?.getAttribute("width")).toBe("100");
        expect(finish?.getAttribute("height")).toBe("100");
        expect(finish?.getAttribute("fill")).toBe(`url(#${pattern?.id})`);
        expect(finish?.getAttribute("clip-path")).toBe(
          `url(#${scene.querySelector('[data-home-room-style="room-1"] clipPath')?.id})`,
        );
        const masks = [
          ...scene.querySelectorAll('[data-home-room-style="room-1"] clipPath polygon'),
        ];
        expect(masks.map((mask) => mask.getAttribute("points"))).toEqual(
          surfaces.map((polygon) => polygon.map(([x, y]) => `${x},${y}`).join(" ")),
        );
        // A finish replaces the source material completely, including its tile or wood pattern.
        expect(
          scene.querySelectorAll('[data-home-room-style="room-1"] image'),
        ).toHaveLength(1);
      }
      expect(scene.querySelector('[data-home-room-style="yard"]')).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      fireEvent.click(view.getByRole("button", { name: "Decorate Garden" }));
      expect(view.queryByLabelText("Wall paint")).toBeNull();
      expect(view.queryByLabelText("Floor tiles")).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Cancel" }));
      view.rerender(<HomeScene {...props} homeType="TOWN_HOUSE" canDecorate />);
      expect(scene.querySelector("[data-home-room-style]")).toBeNull();
    },
  );

  it.each([...HomeTypes])(
    "anchors every %s room finish to the painting with the texture's physical proportions",
    (homeType) => {
      const rooms = getHomeRooms(homeType).filter(({ isYard }) => !isYard);
      const view = render(
        <HomeScene
          {...props}
          homeType={homeType}
          styles={rooms.map(({ id }) => ({ room: id, paint: "sage", floor: "slate" }))}
        />,
      );
      const patterns = [
        ...view
          .getByRole("group", { name: "Home scene" })
          .querySelectorAll("[data-home-room-style] pattern"),
      ];
      expect(patterns).toHaveLength(rooms.length);
      const aspectRatio = HOME_ART_PLANS[homeType].aspectRatio ?? 4 / 3;
      patterns.forEach((pattern) => {
        expect(pattern.getAttribute("patternUnits")).toBe("userSpaceOnUse");
        expect(pattern.getAttribute("x")).toBe("0");
        expect(pattern.getAttribute("y")).toBe("0");
        expect(pattern.getAttribute("width")).toBe("32");
        expect(pattern.getAttribute("height")).toBe("24");
        expect(pattern.getAttribute("patternTransform")).toBe(
          `scale(${1 / aspectRatio} 1)`,
        );
        const image = pattern.querySelector("image")!;
        expect(image.getAttribute("width")).toBe(pattern.getAttribute("width"));
        expect(image.getAttribute("height")).toBe(pattern.getAttribute("height"));
        expect(image.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
      });
    },
  );

  it.each([...HomeTypes])(
    "places a stored garden in the authored cultivation space for %s",
    async (homeType) => {
      const garden = starterFurniture[3]!;
      const onSave = vi
        .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
        .mockResolvedValue(false);
      const view = render(
        <HomeScene
          {...props}
          homeType={homeType}
          furniture={[garden]}
          layout={[]}
          canDecorate
          onSave={onSave}
        />,
      );
      expect(view.queryByRole("button", { name: "Garden: Open farm" })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      fireEvent.click(
        within(view.getByRole("group", { name: "Owned furniture" })).getByRole(
          "button",
          { name: /^GardenPlace$/ },
        ),
      );
      expect(view.getByRole("button", { name: "Move Garden" })).toBeTruthy();
      expect(
        within(view.getByRole("group", { name: "Furniture controls" })).getByRole(
          "button",
          { name: "Store" },
        ),
      ).toBeTruthy();
      fireEvent.click(
        within(view.getByRole("group", { name: "Owned furniture" })).getByRole(
          "button",
          { name: /^GardenPlaced$/ },
        ),
      );
      expect(view.getByRole("group", { name: "Furniture controls" })).toBeTruthy();
      expect((view.getByLabelText("Furniture room") as HTMLSelectElement).value).toBe(
        "yard",
      );
      fireEvent.click(view.getByRole("button", { name: "Save layout" }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      const placements = onSave.mock.calls[0]![0].placements;
      expect(placements).toHaveLength(1);
      expect(placements[0]?.room).toBe("yard");
      expect(homeLayoutPlacementError(placements, [garden], homeType)).toBeNull();
    },
  );

  it.each([...HomeTypes])(
    "tints the measured %s wall panels without recoloring timber, windows or the garden",
    (homeType) => {
      const rooms = getHomeRooms(homeType).filter(({ isYard }) => !isYard);
      const view = render(
        <HomeScene
          {...props}
          homeType={homeType}
          styles={rooms.map(({ id }) => ({
            room: id,
            paint: "sage",
            floor: "original",
          }))}
        />,
      );
      const scene = view.getByRole("group", { name: "Home scene" });
      const plan = HOME_ART_PLANS[homeType];
      rooms.forEach((room, index) => {
        const panels = [
          ...scene.querySelectorAll<SVGSVGElement>(
            `[data-home-wall-paint="${room.id}"]`,
          ),
        ];
        expect(plan.paint[index]?.length).toBeGreaterThan(0);
        expect(panels).toHaveLength(plan.paint[index]!.length);
        panels.forEach((panel, panelIndex) => {
          const polygon = plan.paint[index]![panelIndex]!;
          expect(panel.style.width).toBe(`${plan.size}%`);
          expect(panel.style.height).toBe(`${plan.size}%`);
          expect(panel.style.mixBlendMode).toBe("color");
          expect(panel.querySelector("polygon")?.getAttribute("points")).toBe(
            polygon.map(([x, y]) => `${x},${y}`).join(" "),
          );
          expect(panel.querySelector("polygon")?.getAttribute("fill")).toBe(
            HOME_WALL_PAINTS.sage,
          );
        });
      });
      expect(scene.querySelector('[data-home-wall-paint="yard"]')).toBeNull();
    },
  );

  it("drags furniture onto the extended Mansion rear floor and saves its unchanged facing", async () => {
    const chair: HomeFurniture = {
      ...starterFurniture[1]!,
      id: "chair",
      name: "Chair",
      width: 6,
      action: null,
      views: {},
    };
    const room = getHomeRooms("MANSION").find(({ id }) => id === "room-3")!;
    const initial = {
      id: chair.id,
      room: room.id,
      rotation: 0 as const,
      ...unprojectHomePlacement({
        x: ((50 * 3.7 - room.x) * 100) / room.width,
        y: ((38 * 3.7 - room.y) * 100) / room.height,
      }),
    };
    const onSave = vi
      .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
      .mockResolvedValue(false);
    const view = render(
      <HomeScene
        {...props}
        homeType="MANSION"
        furniture={[chair]}
        layout={[initial]}
        canDecorate
        onSave={onSave}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    const scene = view.getByRole("group", { name: "Home scene" });
    scene.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 1000);
    const button = view.getByRole("button", { name: "Move Chair" });
    button.setPointerCapture = vi.fn();
    firePointerEvent(button, "pointerdown", 1, 0, 0);
    firePointerEvent(button, "pointermove", 1, -140, -10);
    firePointerEvent(button, "pointerup", 1, -140, -10);
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0].placements[0]!;
    const anchor = projectHomePlacement(saved);
    expect((room.x + (anchor.x * room.width) / 100) / 3.7).toBeCloseTo(36);
    expect((room.y + (anchor.y * room.height) / 100) / 3.7).toBeCloseTo(37);
    expect(saved.rotation).toBe(0);
    expect(
      homeFurnitureSaveInputSchema.safeParse(onSave.mock.calls[0]![0]).success,
    ).toBe(true);
    expect(homeLayoutPlacementError([saved], [chair], "MANSION")).toBeNull();
  });

  it("retains wall finishes on the foreground while furniture remains above rear walls", () => {
    const view = render(
      <HomeScene
        {...props}
        homeType="MANSION"
        styles={[{ room: "room-2", paint: "rose", floor: "original" }]}
      />,
    );
    const scene = view.getByRole("group", { name: "Home scene" });
    const front = scene.querySelector('[data-home-foreground="70.5"]')!;
    const finish = front.querySelector(
      '[data-home-foreground-paint="room-2"] polygon',
    )!;
    expect(finish.getAttribute("fill")).toBe(HOME_WALL_PAINTS.rose);
    const rear = scene.querySelector<SVGSVGElement>('[data-home-wall-paint="room-2"]')!;
    expect(Number(rear.style.zIndex)).toBeLessThan(
      Number(
        scene.querySelector<HTMLElement>('[aria-label="Bed: Go to sleep"]')!.style
          .zIndex,
      ),
    );
  });

  it.each(["Bed", "Armory", "Kitchen"])(
    "moves %s to the lawn and saves its room",
    async (name) => {
      const onSave = vi
        .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
        .mockResolvedValue(true);
      const view = render(
        <HomeScene {...props} homeType="TOWN_HOUSE" canDecorate onSave={onSave} />,
      );
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      fireEvent.click(
        within(view.getByRole("group", { name: "Owned furniture" })).getByRole(
          "button",
          { name: new RegExp(`^${name}Placed`) },
        ),
      );
      fireEvent.change(view.getByLabelText("Furniture room"), {
        target: { value: "yard" },
      });
      expect((view.getByLabelText("Furniture room") as HTMLSelectElement).value).toBe(
        "yard",
      );
      expect(view.queryByLabelText("Wall paint")).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Save layout" }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      const saved = onSave.mock.calls[0]![0].placements;
      expect(
        saved.find(
          ({ id }) => id === starterFurniture.find((piece) => piece.name === name)!.id,
        )?.room,
      ).toBe("yard");
      expect(
        homeLayoutPlacementError(saved, starterFurniture, "TOWN_HOUSE"),
      ).toBeNull();
    },
  );

  it("keeps the original painting and home controls available when an optional floor texture fails", () => {
    const view = render(
      <HomeScene
        {...props}
        homeType="TOWN_HOUSE"
        canDecorate
        styles={[{ room: "room-1", paint: "sage", floor: "terracotta" }]}
      />,
    );
    const scene = view.getByRole("group", { name: "Home scene" });
    const painting = view.getByAltText(
      `${HomeTypeDetails.TOWN_HOUSE.name} interior and garden`,
    );
    const foreground = [...scene.querySelectorAll("[data-home-foreground]")];
    const floor = scene.querySelector('[data-home-room-style="room-1"] image');
    expect(floor).not.toBeNull();
    fireEvent.error(floor!);
    expect(view.queryByText(/Home artwork is unavailable/)).toBeNull();
    expect(
      view.getByAltText(`${HomeTypeDetails.TOWN_HOUSE.name} interior and garden`),
    ).toBe(painting);
    expect([...scene.querySelectorAll("[data-home-foreground]")]).toEqual(foreground);
    fireEvent.click(view.getByRole("button", { name: "Bed: Go to sleep" }));
    expect(props.onSleep).toHaveBeenCalledTimes(1);
    fireEvent.click(
      within(view.getByRole("group", { name: "Home actions" })).getByRole("button", {
        name: "Home storage",
      }),
    );
    expect(props.onStorage).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
    expect(view.getByLabelText("Camera zoom").textContent).toBe("120%");
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    fireEvent.click(view.getByRole("button", { name: "Decorate Room 2" }));
    fireEvent.change(view.getByLabelText("Floor tiles"), {
      target: { value: "original" },
    });
    expect(scene.querySelector("[data-home-room-style]")).toBeNull();
    expect(
      view.getByAltText(`${HomeTypeDetails.TOWN_HOUSE.name} interior and garden`),
    ).toBe(painting);
  });

  it.each(["painting", "foreground"] as const)(
    "keeps furniture actions and camera navigation usable when the property %s fails",
    (layer) => {
      const view = render(<HomeScene {...props} homeType="TOWN_HOUSE" />);
      const scene = view.getByRole("group", { name: "Home scene" });
      fireEvent.error(
        layer === "painting"
          ? view.getByAltText(`${HomeTypeDetails.TOWN_HOUSE.name} interior and garden`)
          : scene.querySelector("[data-home-foreground] img")!,
      );
      expect(scene.querySelector("[data-home-art]")).toBeNull();
      expect(scene.querySelector("[data-home-foreground]")).toBeNull();
      expect(
        view.getByText(/Home artwork is unavailable/).closest("[data-home-camera]"),
      ).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Bed: Go to sleep" }));
      expect(props.onSleep).toHaveBeenCalledTimes(1);
      fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
      expect(view.getByLabelText("Camera zoom").textContent).toBe("120%");
    },
  );

  it("serves responsive property and furniture renditions through Bunny", () => {
    const view = render(<HomeScene {...props} canDecorate />);
    expect(view.getByAltText("Tent interior and garden").getAttribute("src")).toBe(
      bunnyImageUrl(IMG_HOME_PROPERTIES.NONE.ground, 1448),
    );
    const bedSource = view
      .getByRole("button", { name: "Bed: Go to sleep" })
      .querySelector("source");
    expect(bedSource?.getAttribute("srcset")).toContain(
      `${bunnyImageUrl(starterFurniture[0]!.image, 128)} 128w`,
    );
    expect(bedSource?.getAttribute("sizes")).toBe("(max-width: 768px) 34vw, 261px");
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    const previews = view.getByRole("group", { name: "Owned furniture" });
    expect(previews.querySelector("source")?.getAttribute("sizes")).toBe("80px");
  });

  it.each([...HomeTypes])(
    "upgrades every %s painting layer together when the camera zooms",
    (homeType) => {
      const view = render(<HomeScene {...props} homeType={homeType} canDecorate />);
      const scene = view.getByRole("group", { name: "Home scene" });
      const source = IMG_HOME_PROPERTIES[homeType].ground;
      const paintingSources = () => [
        ...scene.querySelectorAll(
          "[data-home-art] source, [data-home-foreground] source",
        ),
      ];
      const expectWidth = (width: number) => {
        expect(paintingSources().length).toBeGreaterThan(1);
        expect(
          paintingSources().every(
            (image) => image.getAttribute("srcset") === bunnyImageUrl(source, width),
          ),
        ).toBe(true);
      };
      expectWidth(960);
      fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
      expectWidth(1448);
      fireEvent.click(view.getByRole("button", { name: "Reset view" }));
      expectWidth(960);
      for (let zoom = 0; zoom < 12; zoom++)
        fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
      expectWidth(1448);
      fireEvent.click(view.getByRole("button", { name: "Reset view" }));
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      fireEvent.click(
        within(view.getByRole("group", { name: "Owned furniture" })).getByRole(
          "button",
          { name: /^BedPlaced$/ },
        ),
      );
      expectWidth(1448);
    },
  );

  it("opens home actions through callbacks without leaving the residence", () => {
    const view = render(<HomeScene {...props} />);
    const scene = within(view.getByRole("group", { name: "Home scene" }));
    fireEvent.click(scene.getByRole("button", { name: "Bed: Go to sleep" }));
    fireEvent.click(scene.getByRole("button", { name: "Armory: Open home storage" }));
    const kitchen = scene.getByRole("button", { name: "Kitchen: Open kitchen" });
    fireEvent.click(kitchen);
    expect(props.onSleep).toHaveBeenCalledTimes(1);
    expect(props.onStorage).toHaveBeenCalledTimes(1);
    expect(props.onKitchen).toHaveBeenCalledTimes(1);
    expect(props.onKitchen).toHaveBeenCalledWith(kitchen);
    expect(view.queryByRole("link")).toBeNull();
    expect(scene.getByRole("button", { name: "Garden: Open farm" })).toBeTruthy();
    const actions = within(view.getByRole("group", { name: "Home actions" }));
    for (const name of ["Go to sleep", "Home storage", "Kitchen", "Farm"]) {
      expect(
        actions.getByRole("button", { name }).classList.contains("bg-primary"),
      ).toBe(true);
    }
  });

  it("preserves awake/asleep feedback and prevents duplicate pending sleep actions", () => {
    const view = render(<HomeScene {...props} isAsleep />);
    expect(view.getByRole("button", { name: "Wake up" })).toBeTruthy();
    expect(view.container.querySelector('p[role="status"]')!.textContent).toContain(
      "You are asleep",
    );
    expect(
      view.container.querySelector('p[role="status"]')!.classList.contains("sr-only"),
    ).toBe(true);
    view.rerender(<HomeScene {...props} isTogglingSleep />);
    fireEvent.click(view.getByRole("button", { name: "Bed: Please wait…" }));
    fireEvent.click(view.getByRole("button", { name: "Please wait…" }));
    expect(props.onSleep).not.toHaveBeenCalled();
    expect(view.container.querySelector('p[role="status"]')!.textContent).toContain(
      "Changing sleep status",
    );
  });

  it("keeps storage and management unavailable in a guest residence", () => {
    const view = render(<HomeScene {...props} isGuest />);
    fireEvent.click(
      view.getByRole("button", { name: "Armory: Home storage is in your own village" }),
    );
    fireEvent.click(view.getByRole("button", { name: "Home storage" }));
    expect(props.onStorage).not.toHaveBeenCalled();
    expect(view.queryByRole("button", { name: "Manage home" })).toBeNull();
    expect(view.getByRole("button", { name: "Go to sleep" })).toBeTruthy();
  });

  it("keeps textual navigation working when the artwork fails", () => {
    const view = render(<HomeScene {...props} />);
    fireEvent.error(
      view.getByAltText(`${HomeTypeDetails.NONE.name} interior and garden`),
    );
    const actions = within(view.getByRole("group", { name: "Home actions" }));
    fireEvent.click(actions.getByRole("button", { name: "Home storage" }));
    expect(props.onStorage).toHaveBeenCalledTimes(1);
    fireEvent.click(actions.getByRole("button", { name: "Farm" }));
    expect(props.onFarm).toHaveBeenCalledTimes(1);
    expect(view.getByText(/Home artwork is unavailable/)).toBeTruthy();
  });

  it("loads a new tier after artwork failure while keeping dialog triggers mounted", () => {
    const view = render(<HomeScene {...props} />);
    const trigger = view.getByRole("button", { name: "Home storage" });
    fireEvent.error(
      view.getByAltText(`${HomeTypeDetails.NONE.name} interior and garden`),
    );
    view.rerender(<HomeScene {...props} homeType="PALACE" />);
    expect(view.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    expect(view.queryByText(/Home artwork is unavailable/)).toBeNull();
    expect(view.getByRole("button", { name: "Home storage" })).toBe(trigger);
  });

  it("edits furniture without triggering its game action and cancels without saving", () => {
    const view = render(<HomeScene {...props} canDecorate />);
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    const bed = view.getByRole("button", { name: "Move Bed" });
    const before = bed.style.left;
    fireEvent.keyDown(bed, { key: "ArrowRight" });
    expect(bed.style.left).not.toBe(before);
    fireEvent.click(bed);
    expect(props.onSleep).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(view.getByRole("button", { name: "Bed: Go to sleep" }).style.left).toBe(
      before,
    );
  });

  it("leaves decoration controls in the page header and blocks editing until inventory refresh finishes", () => {
    const view = render(<HomeScene {...props} canDecorate isRefreshingFurniture />);
    const scene = within(view.getByRole("group", { name: "Home scene" }));
    expect(scene.queryByRole("button", { name: "Decorate" })).toBeNull();
    expect(view.queryByRole("button", { name: "Manage home" })).toBeNull();
    expect(view.queryByRole("button", { name: "House shop" })).toBeNull();
    const decorate = view.getByRole("button", {
      name: "Decorate",
    }) as HTMLButtonElement;
    expect(decorate.disabled).toBe(true);
    fireEvent.click(decorate);
    expect(view.queryByRole("button", { name: "Save layout" })).toBeNull();
    view.rerender(<HomeScene {...props} canDecorate />);
    fireEvent.click(decorate);
    expect(view.getByRole("button", { name: "Move Bed" })).toBeTruthy();
  });

  it("cycles four painted views clockwise while preserving the floor anchor", async () => {
    const furniture = [
      {
        ...starterFurniture[0]!,
        views: {
          "90": {
            image: "https://ui0arpl8sm.ufs.sh/f/bed-90.webp",
            width: 20,
            groundAnchor: 85,
          },
          "180": { image: "/bed-180.webp" },
          "270": { image: "/bed-270.webp", width: 21 },
        },
      },
      ...starterFurniture.slice(1),
    ];
    const onSave = vi
      .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
      .mockResolvedValue(false);
    const view = render(
      <HomeScene
        {...props}
        furniture={furniture}
        layout={centeredEssentialsLayout}
        canDecorate
        onSave={onSave}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    const bed = view.getByRole("button", { name: "Move Bed" });
    const rotate = view.getByRole("button", {
      name: "Rotate clockwise",
    }) as HTMLButtonElement;
    const controls = view.getByRole("group", { name: "Furniture controls" });
    expect(controls.closest("button")).toBeNull();
    expect(view.queryByRole("button", { name: "Move Bed right" })).toBeNull();
    expect(rotate.disabled).toBe(false);
    for (const [angle, image, width] of [
      [90, "https://ui0arpl8sm.ufs.sh/f/bed-90.webp", 20],
      [180, "/bed-180.webp", 34],
      [270, "/bed-270.webp", 21],
      [0, furniture[0]!.image, 34],
    ] as const) {
      fireEvent.click(rotate);
      expect(bed.querySelector("img")?.getAttribute("src")).toBe(
        bunnyImageUrl(image, 400),
      );
      expect(bed.querySelector("img")!.style.transform).not.toContain("scaleX");
      expect(bed.querySelector("source")?.getAttribute("srcset")).toContain(
        `${bunnyImageUrl(image, 128)} 128w`,
      );
      expect(bed.querySelector("source")?.getAttribute("sizes")).toBe(
        `(max-width: 768px) ${width}vw, ${Math.round(width * 7.68)}px`,
      );
      expect(rotate.getAttribute("aria-description")).toBe(
        `Current orientation: ${angle}°`,
      );
    }
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0].placements[0]!;
    expect(saved.id).toBe("owned-bed");
    expect(saved.x).toBeCloseTo(50, 2);
    expect(saved.y).toBeCloseTo(50, 2);
    expect(saved.rotation).toBe(0);
  });

  it("skips missing directions and recovers removed artwork through the canonical view", async () => {
    const bedDefinition = {
      ...starterFurniture[0]!,
      views: { "180": { image: "/bed-180.webp", width: 20 } },
    };
    const onSave = vi
      .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
      .mockResolvedValue(false);
    const view = render(
      <HomeScene
        {...props}
        furniture={[bedDefinition, ...starterFurniture.slice(1)]}
        canDecorate
        onSave={onSave}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    const bed = view.getByRole("button", { name: "Move Bed" });
    const rotate = view.getByRole("button", {
      name: "Rotate clockwise",
    }) as HTMLButtonElement;
    fireEvent.click(rotate);
    expect(rotate.getAttribute("aria-description")).toContain("180°");
    expect(bed.querySelector("img")?.getAttribute("src")).toBe("/bed-180.webp");
    view.rerender(
      <HomeScene
        {...props}
        furniture={[{ ...bedDefinition, views: {} }, ...starterFurniture.slice(1)]}
        canDecorate
        onSave={onSave}
      />,
    );
    expect(bed.querySelector("img")?.getAttribute("src")).toBe(
      bunnyImageUrl(bedDefinition.image, 400),
    );
    expect(rotate.disabled).toBe(false);
    fireEvent.click(rotate);
    expect(rotate.getAttribute("aria-description")).toContain("0°");
    expect(rotate.disabled).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(
      onSave.mock.calls[0]![0].placements.find(({ id }) => id === "owned-bed")
        ?.rotation,
    ).toBe(0);
  });

  it.each([
    { id: "owned-bed", name: "Bed", width: 800, height: 600, dx: 48, dy: 24 },
    { id: "owned-bed", name: "Bed", width: 400, height: 300, dx: 24, dy: 12 },
  ] as const)(
    "keeps $id under the pointer in a $width by $height scene and saves normalized coordinates",
    async ({ id, name, width, height, dx, dy }) => {
      const onSave = vi
        .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
        .mockResolvedValue(false);
      const layout = centeredEssentialsLayout;
      const view = render(
        <HomeScene {...props} canDecorate layout={layout} onSave={onSave} />,
      );
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      const furniture = view.getByRole("button", { name: `Move ${name}` });
      furniture.setPointerCapture = vi.fn();
      view.getByRole("group", { name: "Home scene" }).getBoundingClientRect = () =>
        new DOMRect(0, 0, width, height);
      const before = [
        Number.parseFloat(furniture.style.left),
        Number.parseFloat(furniture.style.top),
      ];
      const camera = getHomeOverviewCamera("NONE");
      const room = getHomeRooms("NONE")[0]!;
      const clientX = width / 2;
      const clientY = height / 2;

      firePointerEvent(furniture, "pointerdown", 1, clientX, clientY);
      firePointerEvent(furniture, "pointermove", 1, clientX + dx, clientY + dy);
      expect(
        ((Number.parseFloat(furniture.style.left) - before[0]!) *
          width *
          camera.scale) /
          100,
      ).toBeCloseTo(dx, 1);
      expect(
        ((Number.parseFloat(furniture.style.top) - before[1]!) *
          height *
          camera.scale) /
          100,
      ).toBeCloseTo(dy, 1);
      firePointerEvent(furniture, "pointerup", 1, clientX + dx, clientY + dy);
      fireEvent.click(view.getByRole("button", { name: "Save layout" }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      const saved = onSave.mock.calls[0]![0].placements.find(
        (placement) => placement.id === id,
      )!;
      expect(saved.x).toBeCloseTo(
        50 +
          (10000 * dx) /
            width /
            camera.scale /
            room.width /
            HOME_FLOOR_PROJECTION.scaleX,
        2,
      );
      expect(saved.y).toBeCloseTo(
        50 +
          (10000 * dy) /
            height /
            camera.scale /
            room.height /
            HOME_FLOOR_PROJECTION.scaleY,
        2,
      );
      expect(layout.find((placement) => placement.id === id)).toEqual({
        id,
        x: 50,
        y: 50,
        rotation: 0,
      });
    },
  );

  it("drags the tent garden within its cultivation clearing and saves the moved position", async () => {
    const onSave = vi
      .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
      .mockResolvedValue(false);
    const placement = gardenPlacement("NONE");
    const layout = [placement];
    const view = render(
      <HomeScene {...props} canDecorate layout={layout} onSave={onSave} />,
    );
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    const garden = view.getByRole("button", { name: "Move Garden" });
    garden.setPointerCapture = vi.fn();
    view.getByRole("group", { name: "Home scene" }).getBoundingClientRect = () =>
      new DOMRect(0, 0, 800, 600);
    const before = furniturePosition(garden);

    firePointerEvent(garden, "pointerdown", 1, 400, 550);
    firePointerEvent(garden, "pointermove", 1, 360, 550);
    const camera = getHomeOverviewCamera("NONE");
    const room = getHomeRooms("NONE").find(({ isYard }) => isYard)!;
    expect(
      ((Number.parseFloat(garden.style.left) - Number.parseFloat(before[0]!)) *
        800 *
        camera.scale) /
        100,
    ).toBeCloseTo(-40, 2);
    expect(Number.parseFloat(garden.style.top)).toBeCloseTo(
      Number.parseFloat(before[1]!),
      8,
    );
    firePointerEvent(garden, "pointerup", 1, 360, 550);
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0].placements).toEqual([
      expect.objectContaining({
        ...placement,
        x: expect.closeTo(
          placement.x - 500 / camera.scale / room.width / HOME_FLOOR_PROJECTION.scaleX,
          2,
        ),
        y: expect.closeTo(placement.y, 8),
      }),
    ]);
  });

  it.each([
    { key: "ArrowLeft", x: 48, y: 50 },
    { key: "ArrowUp", x: 50, y: 48 },
    { key: "ArrowDown", x: 50, y: 52 },
    { key: "ArrowRight", x: 52, y: 50 },
  ])(
    "moves $key along the floor axis without changing the other coordinate",
    async ({ key, x, y }) => {
      const onSave = vi
        .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
        .mockResolvedValue(false);
      const view = render(
        <HomeScene
          {...props}
          canDecorate
          layout={centeredEssentialsLayout}
          onSave={onSave}
        />,
      );
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      fireEvent.keyDown(view.getByRole("button", { name: "Move Bed" }), { key });
      fireEvent.click(view.getByRole("button", { name: "Save layout" }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      const saved = onSave.mock.calls[0]![0].placements.find(
        (placement) => placement.id === "owned-bed",
      )!;
      expect(saved.x).toBeCloseTo(x, 2);
      expect(saved.y).toBeCloseTo(y, 2);
      expect(saved.rotation).toBe(0);
    },
  );

  it.each(["Cancel", "Undo changes"])(
    "ends the captured drag when %s replaces the draft and permits a new drag",
    (action) => {
      const view = render(<HomeScene {...props} canDecorate />);
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      const bed = view.getByRole("button", { name: "Move Bed" });
      bed.setPointerCapture = vi.fn();
      view.getByRole("group", { name: "Home scene" }).getBoundingClientRect = () =>
        new DOMRect(0, 0, 1000, 1000);
      const saved = furniturePosition(bed);
      fireEvent.keyDown(bed, { key: "ArrowRight" });
      const dragOrigin = furniturePosition(bed);
      expect(dragOrigin).not.toEqual(saved);
      firePointerEvent(bed, "pointerdown", 1);
      firePointerEvent(bed, "pointermove", 1, 120, 120);
      expect(furniturePosition(bed)).not.toEqual(dragOrigin);

      fireEvent.click(view.getByRole("button", { name: action }));
      if (action === "Cancel") {
        fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      }
      const replacement = view.getByRole("button", { name: "Move Bed" });
      expect(furniturePosition(replacement)).toEqual(saved);
      for (const type of ["pointermove", "pointercancel", "lostpointercapture"]) {
        firePointerEvent(replacement, type, 1, 140, 140);
        expect(furniturePosition(replacement)).toEqual(saved);
      }
      firePointerEvent(replacement, "pointerdown", 2);
      firePointerEvent(replacement, "pointermove", 2, 160, 160);
      expect(furniturePosition(replacement)).not.toEqual(saved);
    },
  );

  it.each(["pointerup", "pointercancel", "lostpointercapture"])(
    "ignores %s from another pointer or furniture while dragging",
    (type) => {
      const view = render(<HomeScene {...props} canDecorate />);
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      const bed = view.getByRole("button", { name: "Move Bed" });
      const garden = view.getByRole("button", { name: "Move Garden" });
      bed.setPointerCapture = vi.fn();
      view.getByRole("group", { name: "Home scene" }).getBoundingClientRect = () =>
        new DOMRect(0, 0, 1000, 1000);
      const gardenBefore = furniturePosition(garden);
      firePointerEvent(bed, "pointerdown", 1);
      firePointerEvent(bed, "pointermove", 1, 120, 120);

      let coordinate = 140;
      for (const [target, pointerId] of [
        [bed, 2],
        [garden, 1],
        [garden, 2],
      ] as const) {
        const moved = furniturePosition(bed);
        firePointerEvent(target, type, pointerId);
        expect(furniturePosition(garden)).toEqual(gardenBefore);
        expect(furniturePosition(bed)).toEqual(moved);
        firePointerEvent(bed, "pointermove", 1, coordinate, coordinate);
        expect(furniturePosition(bed)).not.toEqual(moved);
        coordinate += 20;
      }
    },
  );

  it.each(["pointerup", "pointercancel", "lostpointercapture"])(
    "ends the matching drag on %s and restores the origin only on cancellation",
    (type) => {
      const view = render(<HomeScene {...props} canDecorate />);
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      const bed = view.getByRole("button", { name: "Move Bed" });
      const garden = view.getByRole("button", { name: "Move Garden" });
      bed.setPointerCapture = vi.fn();
      view.getByRole("group", { name: "Home scene" }).getBoundingClientRect = () =>
        new DOMRect(0, 0, 1000, 1000);
      const bedBefore = furniturePosition(bed);
      const gardenBefore = furniturePosition(garden);
      firePointerEvent(bed, "pointerdown", 1);
      firePointerEvent(bed, "pointermove", 1, 120, 120);
      const moved = furniturePosition(bed);
      expect(moved).not.toEqual(bedBefore);
      firePointerEvent(bed, type, 1);
      const expected = type === "pointercancel" ? bedBefore : moved;
      expect(furniturePosition(bed)).toEqual(expected);
      expect(furniturePosition(garden)).toEqual(gardenBefore);
      firePointerEvent(bed, "pointermove", 1, 160, 160);
      expect(furniturePosition(bed)).toEqual(expected);
    },
  );

  it("retains rejected drafts and saves only the revision that the player began editing", async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    const view = render(
      <HomeScene {...props} canDecorate revision={3} onSave={onSave} />,
    );
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    fireEvent.keyDown(view.getByRole("button", { name: "Move Bed" }), {
      key: "ArrowRight",
    });
    view.rerender(<HomeScene {...props} canDecorate revision={4} onSave={onSave} />);
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0].revision).toBe(3);
    expect(view.getByRole("button", { name: "Move Bed" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Undo changes" }));
    onSave.mockResolvedValue(true);
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Decorate" })).toBeTruthy(),
    );
    expect(onSave.mock.calls[1]![0].revision).toBe(4);
  });

  it("ends a captured drag when saving and preserves its submitted position after rejection", async () => {
    const { promise: pendingSave, resolve: resolveSave } = deferred<boolean>();
    const onSave = vi.fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>(
      () => pendingSave,
    );
    const PendingSaveScene = () => {
      const [isSaving, setIsSaving] = useState(false);
      return (
        <HomeScene
          {...props}
          canDecorate
          isSaving={isSaving}
          onSave={async (draft) => {
            setIsSaving(true);
            const success = await onSave(draft);
            setIsSaving(false);
            return success;
          }}
        />
      );
    };
    const view = render(<PendingSaveScene />);
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    const bed = view.getByRole("button", { name: "Move Bed" });
    bed.setPointerCapture = vi.fn();
    view.getByRole("group", { name: "Home scene" }).getBoundingClientRect = () =>
      new DOMRect(0, 0, 1000, 1000);
    const origin = furniturePosition(bed);
    firePointerEvent(bed, "pointerdown", 1);
    firePointerEvent(bed, "pointermove", 1, 120, 120);
    const submitted = furniturePosition(bed);
    expect(submitted).not.toEqual(origin);
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect((bed as HTMLButtonElement).disabled).toBe(true);
    for (const name of [
      "Rotate clockwise",
      "Store",
      "Decorate Main room",
      "Undo changes",
      "Cancel",
    ]) {
      const control = view.getByRole("button", { name }) as HTMLButtonElement;
      expect(control.disabled).toBe(true);
      fireEvent.click(control);
    }
    expect(furniturePosition(bed)).toEqual(submitted);

    for (const type of ["pointermove", "pointercancel", "lostpointercapture"]) {
      firePointerEvent(bed, type, 1, 140, 140);
      expect(furniturePosition(bed)).toEqual(submitted);
    }
    await act(async () => {
      resolveSave(false);
      await pendingSave;
    });
    expect(view.getByRole("button", { name: "Move Bed" })).toBe(bed);
    firePointerEvent(bed, "pointermove", 1, 160, 160);
    expect(furniturePosition(bed)).toEqual(submitted);
    firePointerEvent(bed, "pointerdown", 2);
    firePointerEvent(bed, "pointermove", 2, 180, 180);
    expect(furniturePosition(bed)).not.toEqual(submitted);
  });

  it.each(["Bed", "Sleeping Mat"])(
    "saves a stored bed and optionally places %s later",
    async (replacementName) => {
      const replacement = {
        ...starterFurniture[0]!,
        id: "replacement-mat",
        itemId: "sleeping-mat",
        name: "Sleeping Mat",
        width: 20,
      };
      const onSave = vi
        .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
        .mockResolvedValue(false);
      const view = render(
        <HomeScene
          {...props}
          canDecorate
          furniture={[...starterFurniture, replacement]}
          onSave={onSave}
        />,
      );
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      fireEvent.click(view.getByRole("button", { name: "Store" }));
      expect(view.queryByRole("button", { name: "Move Bed" })).toBeNull();
      const save = view.getByRole("button", {
        name: "Save layout",
      }) as HTMLButtonElement;
      expect(save.disabled).toBe(false);
      expect(view.queryByRole("alert")).toBeNull();
      fireEvent.click(save);
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(
        onSave.mock.calls[0]![0].placements.some(({ id }) => id === "owned-bed"),
      ).toBe(false);
      const tray = within(view.getByRole("group", { name: "Owned furniture" }));
      fireEvent.click(
        tray.getByRole("button", { name: new RegExp(`^${replacementName}Place$`) }),
      );
      fireEvent.click(save);
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
      const saved = onSave.mock.calls[1]![0].placements;
      expect(
        saved.some(
          ({ id }) => id === (replacementName === "Bed" ? "owned-bed" : replacement.id),
        ),
      ).toBe(true);
      expect(saved.some(({ id }) => id === "owned-bed")).toBe(
        replacementName === "Bed",
      );
    },
  );

  it("saves every piece in storage while retaining textual home actions", async () => {
    const onSave = vi
      .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
      .mockResolvedValue(true);
    const view = render(<HomeScene {...props} canDecorate onSave={onSave} />);
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    for (const piece of starterFurniture) {
      fireEvent.click(view.getByRole("button", { name: `Move ${piece.name}` }));
      fireEvent.click(view.getByRole("button", { name: "Store" }));
      expect(view.queryByRole("button", { name: `Move ${piece.name}` })).toBeNull();
    }
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0].placements).toEqual([]);
    view.rerender(
      <HomeScene {...props} furniture={starterFurniture} layout={[]} revision={1} />,
    );
    const actions = within(view.getByRole("group", { name: "Home actions" }));
    fireEvent.click(actions.getByRole("button", { name: "Go to sleep" }));
    fireEvent.click(actions.getByRole("button", { name: "Home storage" }));
    fireEvent.click(actions.getByRole("button", { name: "Farm" }));
    fireEvent.click(actions.getByRole("button", { name: "Kitchen" }));
    expect(props.onSleep).toHaveBeenCalledTimes(1);
    expect(props.onStorage).toHaveBeenCalledTimes(1);
    expect(props.onFarm).toHaveBeenCalledTimes(1);
    expect(props.onKitchen).toHaveBeenCalledTimes(1);
  });

  it("saves an empty room with no furniture", async () => {
    const onSave = vi
      .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
      .mockResolvedValue(false);
    const view = render(
      <HomeScene {...props} furniture={[]} layout={[]} canDecorate onSave={onSave} />,
    );
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    expect(view.getByText(/Buy furniture in the item shop/)).toBeTruthy();
    expect(view.queryByRole("button", { name: "Move Bed" })).toBeNull();
    expect(
      (view.getByRole("button", { name: "Save layout" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(view.queryByRole("alert")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0].placements).toEqual([]);
  });

  it("renders custom metadata, floor layers and action roles without fixed catalog IDs", () => {
    const custom = {
      ...rugDefinition,
      id: "new-inventory-row",
      name: "Cloud Mat",
      width: 17,
      groundAnchor: 70,
    };
    const farm = { ...starterFurniture[3]!, id: "custom-farm-row", name: "Planter" };
    const view = render(
      <HomeScene
        {...props}
        furniture={[custom, farm]}
        layout={[
          { id: custom.id, x: 50, y: 50, rotation: 1 },
          { id: farm.id, x: 50, y: 50, rotation: 0 },
        ]}
        canDecorate
      />,
    );
    const farmButton = view.getByRole("button", { name: "Planter: Open farm" });
    fireEvent.click(farmButton);
    expect(props.onFarm).toHaveBeenCalledTimes(1);
    const customImage = view.container.querySelector('img[src="/custom-rug-90.webp"]')!;
    expect(customImage).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    expect(view.getByRole("button", { name: "Move Cloud Mat" })).toBeTruthy();
  });

  it("moves duplicate copies independently and saves their inventory IDs", async () => {
    const copies = [rugDefinition, { ...rugDefinition, id: "owned-rug-second" }];
    const onSave = vi
      .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
      .mockResolvedValue(false);
    const view = render(
      <HomeScene
        {...props}
        furniture={[...essentialFurniture, ...copies]}
        layout={essentialLayout}
        canDecorate
        onSave={onSave}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    const tray = within(view.getByRole("group", { name: "Owned furniture" }));
    const cards = tray.getAllByRole("button", { name: /Woven Rug.*Place$/ });
    expect(tray.queryByText("Quantity: 1")).toBeNull();
    fireEvent.click(cards[0]!);
    fireEvent.keyDown(view.getByRole("button", { name: "Move Woven Rug" }), {
      key: "ArrowRight",
    });
    fireEvent.click(cards[1]!);
    fireEvent.click(view.getByRole("button", { name: "Rotate clockwise" }));
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(
      onSave.mock.calls[0]![0].placements.filter(({ id }) =>
        id.startsWith("owned-rug"),
      ),
    ).toEqual([
      { id: "owned-rug", x: 52, y: 50, rotation: 0 },
      { id: "owned-rug-second", x: 50, y: 50, rotation: 1 },
    ]);
  });

  it("limits placed furniture while allowing selection and storage to make room", async () => {
    const rugLimit = HOME_FURNITURE_MAX_PLACEMENTS - essentialLayout.length;
    const copies = Array.from({ length: rugLimit + 1 }, (_, index) => ({
      ...rugDefinition,
      id: `owned-rug-${index}`,
    }));
    const layout = [
      ...essentialLayout,
      ...copies.slice(0, rugLimit).map((piece) => ({
        id: piece.id,
        x: 50,
        y: 50,
        rotation: 0 as const,
      })),
    ];
    const onSave = vi
      .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
      .mockResolvedValue(false);
    const view = render(
      <HomeScene
        {...props}
        furniture={[...essentialFurniture, ...copies]}
        layout={layout}
        canDecorate
        onSave={onSave}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    const tray = within(view.getByRole("group", { name: "Owned furniture" }));
    const spare = tray.getByRole("button", { name: /Place$/ }) as HTMLButtonElement;
    expect(spare.disabled).toBe(true);
    fireEvent.click(spare);
    expect(view.getAllByRole("button", { name: "Move Woven Rug" })).toHaveLength(
      rugLimit,
    );
    expect(view.getByText(/Store a piece to make room/).getAttribute("role")).toBe(
      "status",
    );
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(
      homeFurnitureSaveInputSchema.safeParse(onSave.mock.calls[0]![0]).success,
    ).toBe(true);

    const placed = tray.getByRole("button", {
      name: /^Woven Rug2 \/.*Placed$/,
    }) as HTMLButtonElement;
    expect(placed.disabled).toBe(false);
    fireEvent.click(placed);
    expect(placed.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(view.getByRole("button", { name: "Store" }));
    expect(view.queryByText(/Store a piece to make room/)).toBeNull();
    expect(spare.disabled).toBe(false);
    fireEvent.click(spare);
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    const saved = onSave.mock.calls[1]![0];
    expect(saved.placements).toHaveLength(HOME_FURNITURE_MAX_PLACEMENTS);
    expect(saved.placements.some((piece) => piece.id === copies[1]!.id)).toBe(false);
    expect(saved.placements.some((piece) => piece.id === copies.at(-1)!.id)).toBe(true);
    expect(homeFurnitureSaveInputSchema.safeParse(saved).success).toBe(true);
  });

  it("retains surviving edits when furniture disappears and recovers through the saved layout", () => {
    const view = render(<HomeScene {...props} canDecorate />);
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    const garden = view.getByRole("button", { name: "Move Garden" });
    fireEvent.keyDown(garden, { key: "ArrowRight" });
    const edited = garden.style.left;
    const remaining = starterFurniture.filter((piece) => piece.id !== "owned-bed");
    const saved = props.layout.filter((placement) => placement.id !== "owned-bed");
    view.rerender(
      <HomeScene
        {...props}
        furniture={remaining}
        layout={saved}
        revision={1}
        canDecorate
      />,
    );
    expect(view.queryByRole("button", { name: "Move Bed" })).toBeNull();
    expect(garden.style.left).toBe(edited);
    expect(view.getByRole("alert").textContent).toContain(
      "no longer in your inventory",
    );
    expect(
      (view.getByRole("button", { name: "Save layout" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Undo changes" }));
    expect(view.queryByRole("alert")).toBeNull();
    expect(
      (view.getByRole("button", { name: "Save layout" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(view.queryByText(/no longer in your inventory/)).toBeNull();
    expect(garden.style.left).not.toBe(edited);
    view.rerender(<HomeScene {...props} revision={2} canDecorate />);
    fireEvent.click(view.getByRole("button", { name: "Undo changes" }));
    expect(view.queryByRole("alert")).toBeNull();
    expect(
      (view.getByRole("button", { name: "Save layout" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("blocks movement and saving after the home tier changes until the saved layout is reloaded", () => {
    const view = render(<HomeScene {...props} canDecorate />);
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    const bed = view.getByRole("button", { name: "Move Bed" });
    view.rerender(<HomeScene {...props} homeType="PALACE" canDecorate />);
    const position = furniturePosition(bed);
    fireEvent.keyDown(bed, { key: "ArrowRight" });
    expect(furniturePosition(bed)).toEqual(position);
    expect(
      (view.getByRole("button", { name: "Save layout" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Undo changes" }));
    expect(view.queryByRole("alert")).toBeNull();
    fireEvent.keyDown(bed, { key: "ArrowRight" });
    expect(furniturePosition(bed)).not.toEqual(position);
  });

  it("ends a captured decoration drag when storing it and permits another furniture drag", () => {
    const view = render(
      <HomeScene
        {...props}
        canDecorate
        furniture={[...starterFurniture, rugDefinition]}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    fireEvent.click(view.getByRole("button", { name: /Woven Rug.*Place$/ }));
    const rug = view.getByRole("button", { name: "Move Woven Rug" });
    rug.setPointerCapture = vi.fn();
    view.getByRole("group", { name: "Home scene" }).getBoundingClientRect = () =>
      new DOMRect(0, 0, 1000, 1000);
    firePointerEvent(rug, "pointerdown", 1);
    firePointerEvent(rug, "pointermove", 1, 140, 140);
    fireEvent.click(view.getByRole("button", { name: "Store" }));
    expect(view.queryByRole("button", { name: "Move Woven Rug" })).toBeNull();
    // Removing the capture target sends its capture loss and pointer release to the document.
    firePointerEvent(document, "lostpointercapture", 1);
    firePointerEvent(document, "pointerup", 1);

    const bed = view.getByRole("button", { name: "Move Bed" });
    bed.setPointerCapture = vi.fn();
    const origin = furniturePosition(bed);
    firePointerEvent(bed, "pointerdown", 2);
    firePointerEvent(bed, "pointermove", 2, 120, 120);
    expect(furniturePosition(bed)).not.toEqual(origin);
    expect(bed.setPointerCapture).toHaveBeenCalledWith(2);
    expect(view.getByRole("button", { name: /Woven Rug.*Place$/ })).toBeTruthy();
  });

  it.each([0, 3])(
    "keeps overlapping artwork placed when clicking or moving only %s pixels over the armory",
    async (displacement) => {
      const geometry = {
        aspectRatio: 4 / 3,
        visibleBounds: { x: 0, y: 0, width: 100, height: 100 },
        footprint: { x: 0, y: 85, width: 100, height: 15 },
      };
      const base = {
        itemId: "custom",
        name: "Bonsai",
        image: "/bonsai.webp",
        width: 20,
        groundAnchor: 100,
        geometry,
        action: null,
        isFloor: false,
        quantity: 1,
        views: {},
      } satisfies Omit<HomeFurniture, "id">;
      const furniture: HomeFurniture[] = [
        { ...base, id: "armory", name: "Armory", action: "storage" },
        { ...base, id: "bonsai" },
      ];
      const layout = [
        {
          id: "armory",
          ...unprojectHomePlacement({ x: 50, y: 55 }),
          rotation: 0 as const,
        },
        {
          id: "bonsai",
          ...unprojectHomePlacement({ x: 50, y: 62 }),
          rotation: 0 as const,
        },
      ];
      expect(homeLayoutPlacementError(layout, furniture, "NONE")).toBeNull();
      const onSave = vi
        .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
        .mockResolvedValue(false);
      const view = render(
        <HomeScene
          {...props}
          canDecorate
          furniture={furniture}
          layout={layout}
          onSave={onSave}
        />,
      );
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      const bonsai = view.getByRole("button", { name: "Move Bonsai" });
      const armory = view.getByRole("button", { name: "Move Armory" });
      expect(Number(bonsai.style.zIndex)).toBeGreaterThan(Number(armory.style.zIndex));
      bonsai.setPointerCapture = vi.fn();
      view.getByRole("group", { name: "Home scene" }).getBoundingClientRect = () =>
        new DOMRect(0, 0, 1000, 750);
      // Tall art may overlap the armory even when their occupied floor areas do not.
      firePointerEvent(bonsai, "pointerdown", 1, 500, 360);
      if (displacement)
        firePointerEvent(bonsai, "pointermove", 1, 500 + displacement, 360);
      firePointerEvent(bonsai, "pointerup", 1, 500 + displacement, 360);
      expect(view.getByRole("button", { name: "Move Bonsai" })).toBeTruthy();
      expect(armory.classList.contains("ring-4")).toBe(false);
      fireEvent.click(view.getByRole("button", { name: "Save layout" }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(
        onSave.mock.calls[0]![0].placements.some((piece) => piece.id === "bonsai"),
      ).toBe(true);
    },
  );

  it.each(["pointerup", "pointercancel"])(
    "%s on the armory stores a completed drop or restores a cancelled drag",
    async (type) => {
      const onSave = vi
        .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
        .mockResolvedValue(false);
      const view = render(<HomeScene {...props} canDecorate onSave={onSave} />);
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      const bed = view.getByRole("button", { name: "Move Bed" });
      const armory = view.getByRole("button", { name: "Move Armory" });
      expect(armory.getAttribute("aria-description")).toBe(
        "Drop furniture here to store it",
      );
      bed.setPointerCapture = vi.fn();
      view.getByRole("group", { name: "Home scene" }).getBoundingClientRect = () =>
        new DOMRect(0, 0, 1000, 750);
      const camera = getHomeOverviewCamera("NONE");
      const x =
        (camera.x +
          (Number.parseFloat(armory.style.left) +
            Number.parseFloat(armory.style.width) / 2) *
            camera.scale) *
        10;
      const y =
        (camera.y +
          (Number.parseFloat(armory.style.top) +
            Number.parseFloat(armory.style.height) / 2) *
            camera.scale) *
        7.5;
      const origin = furniturePosition(bed);
      firePointerEvent(bed, "pointerdown", 1);
      firePointerEvent(bed, "pointermove", 1, x, y);
      expect(armory.classList.contains("ring-4")).toBe(true);
      firePointerEvent(bed, type, 1, x, y);
      if (type === "pointerup") {
        expect(view.queryByRole("button", { name: "Move Bed" })).toBeNull();
        const bedCard = within(
          view.getByRole("group", { name: "Owned furniture" }),
        ).getByRole("button", { name: /^BedPlace$/ });
        expect(
          (view.getByRole("button", { name: "Save layout" }) as HTMLButtonElement)
            .disabled,
        ).toBe(false);
        expect(view.queryByRole("alert")).toBeNull();
        fireEvent.click(bedCard);
      } else {
        expect(furniturePosition(bed)).toEqual(origin);
      }
      expect(armory.classList.contains("ring-4")).toBe(false);
      fireEvent.click(view.getByRole("button", { name: "Save layout" }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(
        onSave.mock.calls[0]![0].placements.some((piece) => piece.id === "owned-bed"),
      ).toBe(true);
    },
  );
});

describe("multi-room home scene", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["Decorate", "Undo changes"])(
    "selects furniture in the active room on %s and saves that room's paint",
    async (action) => {
      const onSave = vi
        .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
        .mockResolvedValue(false);
      const bedroom = {
        room: "room-1" as const,
        paint: "sage" as const,
        floor: "slate" as const,
      };
      const main = {
        room: "main" as const,
        paint: "rose" as const,
        floor: "terracotta" as const,
      };
      const view = render(
        <HomeScene
          {...props}
          homeType="TOWN_HOUSE"
          canDecorate
          revision={7}
          furniture={[starterFurniture[0]!, rugDefinition]}
          layout={[
            { id: "owned-bed", room: "room-1", x: 50, y: 50, rotation: 0 },
            { id: rugDefinition.id, x: 50, y: 50, rotation: 0 },
          ]}
          styles={[bedroom, main]}
          onSave={onSave}
        />,
      );
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      if (action === "Undo changes") {
        fireEvent.click(view.getByRole("button", { name: "Move Bed" }));
        fireEvent.change(view.getByLabelText("Wall paint"), {
          target: { value: "indigo" },
        });
        fireEvent.click(view.getByRole("button", { name: "Decorate Main room" }));
        fireEvent.click(view.getByRole("button", { name: action }));
      }
      expect(
        view
          .getByRole("button", { name: "Move Woven Rug" })
          .getAttribute("aria-pressed"),
      ).toBe("true");
      expect(
        view.getByRole("button", { name: "Move Bed" }).getAttribute("aria-pressed"),
      ).toBe("false");
      expect((view.getByLabelText("Furniture room") as HTMLSelectElement).value).toBe(
        "main",
      );
      expect(
        view.getByText(`Main room · 1/${HOME_FURNITURE_MAX_PLACEMENTS} pieces`),
      ).toBeTruthy();
      expect((view.getByLabelText("Wall paint") as HTMLSelectElement).value).toBe(
        "rose",
      );
      fireEvent.change(view.getByLabelText("Wall paint"), {
        target: { value: "indigo" },
      });
      fireEvent.click(view.getByRole("button", { name: "Save layout" }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0]![0]).toMatchObject({
        revision: 7,
        styles: [bedroom, { ...main, paint: "indigo" }],
      });
    },
  );

  it.each(["Decorate", "Undo changes"])(
    "leaves an empty active room unselected on %s",
    (action) => {
      const view = render(
        <HomeScene
          {...props}
          homeType="TOWN_HOUSE"
          canDecorate
          furniture={[starterFurniture[0]!]}
          layout={[{ id: "owned-bed", room: "room-1", x: 50, y: 50, rotation: 0 }]}
        />,
      );
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      if (action === "Undo changes") {
        fireEvent.click(view.getByRole("button", { name: "Move Bed" }));
        fireEvent.click(view.getByRole("button", { name: "Decorate Main room" }));
        fireEvent.click(view.getByRole("button", { name: action }));
      }
      expect(view.queryByRole("group", { name: "Furniture controls" })).toBeNull();
      expect(view.queryByLabelText("Furniture room")).toBeNull();
      expect(
        view.getByRole("button", { name: "Move Bed" }).getAttribute("aria-pressed"),
      ).toBe("false");
      expect(
        view.getByText(`Main room · 0/${HOME_FURNITURE_MAX_PLACEMENTS} pieces`),
      ).toBeTruthy();
    },
  );

  it("selects an empty room's floor for finishes without moving the camera or retaining furniture controls", async () => {
    const onSave = vi
      .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
      .mockResolvedValue(false);
    const view = render(
      <HomeScene {...props} homeType="TOWN_HOUSE" canDecorate onSave={onSave} />,
    );
    expect(view.queryByRole("button", { name: "Decorate Room 2" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    const camera = view
      .getByRole("group", { name: "Home scene" })
      .querySelector("[data-home-camera]")!;
    const before = camera.getAttribute("style");
    const floor = view.getByRole("button", { name: "Decorate Room 2" });
    fireEvent.click(floor, { detail: 0 });
    expect(floor.getAttribute("aria-pressed")).toBe("true");
    expect(
      view.getByRole("button", { name: "Move Bed" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(view.queryByRole("group", { name: "Furniture controls" })).toBeNull();
    expect(view.queryByLabelText("Furniture room")).toBeNull();
    expect(camera.getAttribute("style")).toBe(before);
    expect(
      view.getByText(`Room 2 · 0/${HOME_FURNITURE_MAX_PLACEMENTS} pieces`),
    ).toBeTruthy();
    fireEvent.change(view.getByLabelText("Floor tiles"), {
      target: { value: "slate" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0].styles).toEqual([
      { room: "room-1", paint: "ivory", floor: "slate" },
    ]);
  });

  it.each(["pan", "pinch"])(
    "does not change the selected room when a %s ends over another floor",
    (gesture) => {
      const view = render(<HomeScene {...props} homeType="TOWN_HOUSE" canDecorate />);
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
      const scene = view.getByRole("group", { name: "Home scene" });
      scene.setPointerCapture = vi.fn();
      scene.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
      const floor = view.getByRole("button", { name: "Decorate Room 2" });
      floor.setPointerCapture = vi.fn();
      const camera = scene.querySelector("[data-home-camera]")!;
      const before = camera.getAttribute("style");
      firePointerEvent(floor, "pointerdown", 1, 200, 200);
      if (gesture === "pinch") {
        firePointerEvent(scene, "pointerdown", 2, 400, 200);
        firePointerEvent(scene, "pointermove", 2, 500, 200);
        firePointerEvent(scene, "pointerup", 2, 500, 200);
      } else firePointerEvent(floor, "pointermove", 1, 250, 220);
      firePointerEvent(floor, "pointerup", 1, 250, 220);
      fireEvent.click(floor, { detail: 1 });
      expect(camera.getAttribute("style")).not.toBe(before);
      expect(floor.getAttribute("aria-pressed")).toBe("false");
      expect(
        view.getByRole("button", { name: "Move Bed" }).getAttribute("aria-pressed"),
      ).toBe("true");
      firePointerEvent(floor, "pointerdown", 3, 200, 200);
      firePointerEvent(floor, "pointerup", 3, 200, 200);
      fireEvent.click(floor, { detail: 1 });
      expect(floor.getAttribute("aria-pressed")).toBe("true");
      expect(view.queryByRole("group", { name: "Furniture controls" })).toBeNull();
    },
  );

  it("keeps furniture and camera overlay gestures separate from dragging and panning", async () => {
    const onSave = vi
      .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
      .mockResolvedValue(false);
    const bedDefinition = {
      ...starterFurniture[0]!,
      views: { "180": { image: "/bed-180.webp" } },
    };
    const view = render(
      <HomeScene
        {...props}
        homeType="TOWN_HOUSE"
        furniture={[bedDefinition]}
        layout={[centeredEssentialsLayout[0]!]}
        canDecorate
        onSave={onSave}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
    const scene = view.getByRole("group", { name: "Home scene" });
    scene.setPointerCapture = vi.fn();
    scene.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    const bed = view.getByRole("button", { name: "Move Bed" });
    const before = furniturePosition(bed);
    const controls = view.getByRole("group", { name: "Furniture controls" });
    expect(scene.contains(controls)).toBe(true);
    expect(controls.closest("[data-home-camera]")).toBeNull();
    expect(controls.closest("button")).toBeNull();
    const anchor = [controls.style.left, controls.style.top];
    fireEvent.keyDown(bed, { key: "ArrowRight" });
    expect(controls.style.left).not.toBe(anchor[0]);
    fireEvent.keyDown(bed, { key: "ArrowLeft" });
    fireEvent.keyDown(bed, { key: "ArrowDown" });
    expect(controls.style.top).not.toBe(anchor[1]);
    fireEvent.keyDown(bed, { key: "ArrowUp" });
    expect(furniturePosition(bed)).toEqual(before);
    const [rotate, store] = within(controls).getAllByRole("button");
    expect(rotate?.getAttribute("aria-label")).toBe("Rotate clockwise");
    expect(store?.getAttribute("aria-label")).toBe("Store");
    const camera = scene.querySelector("[data-home-camera]")!;
    for (const name of [
      "Rotate clockwise",
      "Store",
      "Zoom in",
      "Zoom out",
      "Reset view",
    ]) {
      const control = view.getByRole("button", { name });
      const beforeCamera = camera.getAttribute("style");
      firePointerEvent(control, "pointerdown", 1, 400, 300);
      firePointerEvent(control, "pointermove", 1, 440, 340);
      firePointerEvent(control, "pointerup", 1, 440, 340);
      expect(camera.getAttribute("style")).toBe(beforeCamera);
      expect(furniturePosition(bed)).toEqual(before);
    }
    expect(scene.setPointerCapture).not.toHaveBeenCalled();
    fireEvent.click(rotate!);
    expect(rotate?.getAttribute("aria-description")).toBe("Current orientation: 180°");
    expect(Number.parseFloat(bed.style.left)).toBeCloseTo(
      Number.parseFloat(before[0]!),
      10,
    );
    expect(Number.parseFloat(bed.style.top)).toBeCloseTo(
      Number.parseFloat(before[1]!),
      10,
    );
    fireEvent.click(store!);
    expect(view.queryByRole("button", { name: "Move Bed" })).toBeNull();
    expect(view.queryByRole("group", { name: "Furniture controls" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0].placements).toEqual([]);
  });

  it("overlays compact camera controls and restores the full property without a room picker", () => {
    const view = render(<HomeScene {...props} homeType="TOWN_HOUSE" />);
    const scene = view.getByRole("group", { name: "Home scene" });
    const navigation = view.getByRole("group", { name: "Property navigation" });
    const zoom = view.getByLabelText("Camera zoom");
    const camera = scene.querySelector("[data-home-camera]")!;
    const overview = camera.getAttribute("style");
    expect(scene.contains(navigation)).toBe(true);
    expect(navigation.closest("[data-home-camera]")).toBeNull();
    expect(view.queryByLabelText("Jump to room")).toBeNull();
    const reset = within(navigation).getByRole("button", { name: "Reset view" });
    expect(reset.textContent).toBe("");
    fireEvent.click(within(navigation).getByRole("button", { name: "Zoom in" }));
    expect(zoom.textContent).toBe("120%");
    expect(camera.getAttribute("style")).not.toBe(overview);
    fireEvent.click(reset);
    expect(zoom.textContent).toBe("100%");
    expect(camera.getAttribute("style")).toBe(overview);
  });

  const cameraFurniture: HomeFurniture[] = [
    {
      ...starterFurniture[2]!,
      groundAnchor: 89.0625,
      geometry: {
        aspectRatio: 1.33333333,
        visibleBounds: { x: 12.6302, y: 22.7431, width: 79.1667, height: 66.3194 },
        footprint: { x: 14.2135, y: 54.5764, width: 76, height: 34.4861 },
      },
    },
    {
      ...starterFurniture[1]!,
      groundAnchor: 95.6597,
      geometry: {
        aspectRatio: 1.33333333,
        visibleBounds: { x: 11.4583, y: 28.4722, width: 77.2135, height: 67.1875 },
        footprint: { x: 12.2305, y: 55.3472, width: 75.6693, height: 40.3125 },
      },
    },
    {
      ...rugDefinition,
      name: "Folding Screen",
      isFloor: false,
      width: 24,
      groundAnchor: 86.4583,
      geometry: {
        aspectRatio: 1.33333333,
        visibleBounds: { x: 5.0781, y: 25.5208, width: 89.974, height: 60.9375 },
        footprint: { x: 6.8776, y: 71.224, width: 86.375, height: 15.2344 },
      },
    },
  ];

  it.each([
    {
      homeType: "MANSION",
      room: "room-1",
      x: 50,
      y: 22.877756813951144,
      piece: cameraFurniture[0]!,
    },
    {
      homeType: "PALACE",
      room: "room-1",
      x: 50,
      y: -15.554182605093189,
      piece: cameraFurniture[1]!,
    },
    {
      homeType: "PALACE",
      room: "room-5",
      x: -13.337866666666677,
      y: -88.16394223293703,
      piece: cameraFurniture[1]!,
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: "room-1",
      x: 50,
      y: -18.04602670472942,
      piece: cameraFurniture[1]!,
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: "room-1",
      x: 50.614231292517026,
      y: -38.19815175510973,
      piece: cameraFurniture[2]!,
    },
    {
      homeType: "MARSHMALLOWOPOLIS",
      room: "room-9",
      x: 110.01059455782314,
      y: -107.5730586472369,
      piece: cameraFurniture[2]!,
    },
  ] satisfies {
    homeType: HomeType;
    room: HomePlacement["room"];
    x: number;
    y: number;
    piece: HomeFurniture;
  }[])(
    "keeps $piece.name artwork visible when focusing $homeType $room near the back wall",
    ({ homeType, room, x, y, piece }) => {
      const placement: HomePlacement = { id: piece.id, room, x, y, rotation: 0 };
      expect(homeLayoutPlacementError([placement], [piece], homeType)).toBeNull();
      const view = render(
        <HomeScene
          {...props}
          homeType={homeType}
          furniture={[piece]}
          layout={[placement]}
          canDecorate
        />,
      );
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      fireEvent.click(
        within(view.getByRole("group", { name: "Owned furniture" })).getByRole(
          "button",
          { name: `${piece.name}Placed` },
        ),
      );
      const art = view.getByRole("button", { name: `Move ${piece.name}` });
      const camera = sceneCamera(view.getByRole("group", { name: "Home scene" }));
      for (const [offset, position, size] of [
        [camera.x, art.style.left, art.style.width],
        [camera.y, art.style.top, art.style.height],
      ] as const) {
        const start = offset + Number.parseFloat(position) * camera.scale;
        expect(start).toBeGreaterThanOrEqual(0);
        expect(start + Number.parseFloat(size) * camera.scale).toBeLessThanOrEqual(100);
      }
    },
  );

  it("keeps selected furniture actions clear of camera navigation near the bottom edge", () => {
    const garden = {
      ...starterFurniture[3]!,
      views: { "180": { image: "/garden-180.webp" } },
    };
    const placement: HomePlacement = {
      id: garden.id,
      room: "yard",
      x: 73.54497354497354,
      y: 67.58333333333333,
      rotation: 0,
    };
    expect(homeLayoutPlacementError([placement], [garden], "TOWN_HOUSE")).toBeNull();
    const view = render(
      <HomeScene
        {...props}
        homeType="TOWN_HOUSE"
        furniture={[garden]}
        layout={[placement]}
        canDecorate
      />,
    );
    const scene = view.getByRole("group", { name: "Home scene" });
    scene.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
    scene.setPointerCapture = vi.fn();
    const navigation = view.getByRole("group", { name: "Property navigation" });
    expect(navigation.classList.contains("bottom-2")).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    fireEvent.click(view.getByRole("button", { name: "Move Garden" }));
    for (let clicks = 0; clicks < 10; clicks++)
      fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
    const before = sceneCamera(scene);
    expect(before.scale).toBe(1.8);
    const x = 200 + (-271 - before.x) * 4;
    const y = 150 + (-340.3 - before.y) * 3;
    firePointerEvent(scene, "pointerdown", 1, 200, 150);
    firePointerEvent(scene, "pointermove", 1, x, y);
    firePointerEvent(scene, "pointerup", 1, x, y);
    expect(sceneCamera(scene).x).toBeCloseTo(-271);
    expect(sceneCamera(scene).y).toBeCloseTo(-340.3);
    const controls = view.getByRole("group", { name: "Furniture controls" });
    expect(controls.style.top).toContain("89%");
    expect(navigation.classList.contains("top-2")).toBe(true);
    expect(navigation.classList.contains("bottom-2")).toBe(false);
    fireEvent.click(within(controls).getByRole("button", { name: "Rotate clockwise" }));
    expect(
      view
        .getByRole("button", { name: "Rotate clockwise" })
        .getAttribute("aria-description"),
    ).toBe("Current orientation: 180°");
    fireEvent.click(within(controls).getByRole("button", { name: "Store" }));
    expect(view.queryByRole("button", { name: "Move Garden" })).toBeNull();
    expect(view.queryByRole("group", { name: "Furniture controls" })).toBeNull();
    expect(navigation.classList.contains("bottom-2")).toBe(true);
    fireEvent.click(within(navigation).getByRole("button", { name: "Reset view" }));
    expect(sceneCamera(scene)).toEqual(getHomeOverviewCamera("TOWN_HOUSE"));
  });

  it("drags a garden within its clearing and rejects an indoor drop", async () => {
    const onSave = vi
      .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
      .mockResolvedValue(false);
    const placement = gardenPlacement("TOWN_HOUSE");
    const view = render(
      <HomeScene
        {...props}
        homeType="TOWN_HOUSE"
        canDecorate
        layout={[placement]}
        onSave={onSave}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    fireEvent.click(
      within(view.getByRole("group", { name: "Owned furniture" })).getByRole("button", {
        name: /^GardenPlaced$/,
      }),
    );
    const garden = view.getByRole("button", { name: "Move Garden" });
    garden.setPointerCapture = vi.fn();
    const scene = view.getByRole("group", { name: "Home scene" });
    scene.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    const before = furniturePosition(garden);
    const camera = sceneCamera(scene);
    const yard = getHomeRooms("TOWN_HOUSE").find(({ isYard }) => isYard)!;
    const origin = worldAnchor("TOWN_HOUSE", placement);
    const indoors = worldAnchor("TOWN_HOUSE", {
      id: placement.id,
      x: 50,
      y: 50,
      rotation: 0,
    });
    const invalidX = 400 + (indoors.x - origin.x) * camera.scale * 8;
    const invalidY = 550 + (indoors.y - origin.y) * camera.scale * 6;

    firePointerEvent(garden, "pointerdown", 1, 400, 550);
    firePointerEvent(garden, "pointermove", 1, 360, 550);
    expect(
      ((Number.parseFloat(garden.style.left) - Number.parseFloat(before[0]!)) *
        800 *
        camera.scale) /
        100,
    ).toBeCloseTo(-40, 1);
    const moved = furniturePosition(garden);
    firePointerEvent(garden, "pointermove", 1, invalidX, invalidY);
    expect(furniturePosition(garden)).toEqual(moved);
    firePointerEvent(garden, "pointerup", 1, invalidX, invalidY);
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0].placements).toEqual([
      expect.objectContaining({
        ...placement,
        x: expect.closeTo(
          placement.x - 500 / camera.scale / yard.width / HOME_FLOOR_PROJECTION.scaleX,
          2,
        ),
      }),
    ]);
  });

  it.each([
    [0, 600],
    [800, 0],
    [0, 0],
  ])(
    "preserves the camera while the scene is %s by %s and resumes wheel zoom after resize",
    (width, height) => {
      const view = render(<HomeScene {...props} homeType="TOWN_HOUSE" />);
      fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
      const scene = view.getByRole("group", { name: "Home scene" });
      const camera = scene.querySelector("[data-home-camera]")!;
      const before = camera.getAttribute("style");
      const initial = sceneCamera(scene);
      scene.getBoundingClientRect = () => new DOMRect(40, 50, width, height);
      fireEvent.wheel(scene, { deltaY: -1, clientX: 240, clientY: 200 });
      expect(camera.getAttribute("style")).toBe(before);
      expect(view.getByLabelText("Camera zoom").textContent).toBe(
        cameraZoom("TOWN_HOUSE", initial.scale),
      );

      scene.getBoundingClientRect = () => new DOMRect(40, 50, 800, 600);
      fireEvent.wheel(scene, { deltaY: -1, clientX: 240, clientY: 200 });
      expect(view.getByLabelText("Camera zoom").textContent).toBe(
        cameraZoom("TOWN_HOUSE", Math.min(1.8, initial.scale * 1.1)),
      );
      expect(camera.getAttribute("style")).not.toMatch(/NaN|Infinity/);
    },
  );

  it.each([
    [0, 600],
    [800, 0],
    [0, 0],
  ])(
    "preserves the camera while pinching a %s by %s scene and resumes after resize",
    (width, height) => {
      const view = render(<HomeScene {...props} homeType="TOWN_HOUSE" />);
      fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
      const scene = view.getByRole("group", { name: "Home scene" });
      scene.setPointerCapture = vi.fn();
      scene.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
      const camera = scene.querySelector("[data-home-camera]")!;
      const before = camera.getAttribute("style");
      const initial = sceneCamera(scene);
      firePointerEvent(scene, "pointerdown", 1, 200, 240);
      firePointerEvent(scene, "pointerdown", 2, 400, 240);
      scene.getBoundingClientRect = () => new DOMRect(0, 0, width, height);
      firePointerEvent(scene, "pointermove", 2, 600, 240);
      expect(camera.getAttribute("style")).toBe(before);
      expect(view.getByLabelText("Camera zoom").textContent).toBe(
        cameraZoom("TOWN_HOUSE", initial.scale),
      );

      scene.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
      firePointerEvent(scene, "pointermove", 2, 500, 240);
      expect(view.getByLabelText("Camera zoom").textContent).toBe(
        cameraZoom("TOWN_HOUSE", Math.min(1.8, initial.scale * 1.5)),
      );
      const expected = boundHomeCamera(
        zoomHomeCamera(
          initial,
          Math.min(1.8, initial.scale * 1.5),
          { x: 37.5, y: 40 },
          { x: 43.75, y: 40 },
        ),
        "TOWN_HOUSE",
      );
      const resumed = sceneCamera(scene);
      expect(resumed.scale).toBeCloseTo(expected.scale, 10);
      expect(resumed.x).toBeCloseTo(expected.x, 10);
      expect(resumed.y).toBeCloseTo(expected.y, 10);
    },
  );

  it("preserves the camera while panning a zero-size scene and resumes after resize", () => {
    const view = render(<HomeScene {...props} homeType="TOWN_HOUSE" />);
    fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
    const scene = view.getByRole("group", { name: "Home scene" });
    scene.setPointerCapture = vi.fn();
    scene.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    const camera = scene.querySelector("[data-home-camera]")!;
    const before = camera.getAttribute("style");
    const initial = sceneCamera(scene);
    firePointerEvent(scene, "pointerdown", 1, 400, 300);
    scene.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    firePointerEvent(scene, "pointermove", 1, 320, 240);
    expect(camera.getAttribute("style")).toBe(before);

    scene.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    firePointerEvent(scene, "pointermove", 1, 240, 180);
    expect(sceneCamera(scene)).toEqual(
      boundHomeCamera(
        { ...initial, x: initial.x - 20, y: initial.y - 20 },
        "TOWN_HOUSE",
      ),
    );
  });

  it.each(["pointerup", "pointercancel"])(
    "keeps room finishes aligned with a cross-room drag ending in %s",
    async (ending) => {
      const onSave = vi
        .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
        .mockResolvedValue(false);
      const view = render(
        <HomeScene
          {...props}
          homeType="TOWN_HOUSE"
          layout={centeredEssentialsLayout}
          canDecorate
          onSave={onSave}
        />,
      );
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      fireEvent.click(view.getByRole("button", { name: "Zoom out" }));
      fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
      const scene = view.getByRole("group", { name: "Home scene" });
      scene.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
      const camera = scene.querySelector("[data-home-camera]")!;
      const beforeCamera = camera.getAttribute("style");
      const bed = view.getByRole("button", { name: "Move Bed" });
      bed.setPointerCapture = vi.fn();
      const origin = worldAnchor("TOWN_HOUSE", centeredEssentialsLayout[0]!);
      const target = worldAnchor("TOWN_HOUSE", {
        ...centeredEssentialsLayout[0]!,
        room: "room-1",
      });
      const scale = sceneCamera(scene).scale;
      const dropX = 200 + (target.x - origin.x) * scale * 8;
      const dropY = 200 + (target.y - origin.y) * scale * 6;
      firePointerEvent(bed, "pointerdown", 1, 200, 200);
      firePointerEvent(bed, "pointermove", 1, dropX, dropY);
      expect((view.getByLabelText("Furniture room") as HTMLSelectElement).value).toBe(
        "room-1",
      );
      firePointerEvent(bed, ending, 1, dropX, dropY);
      const room = ending === "pointerup" ? "room-1" : "main";
      expect((view.getByLabelText("Furniture room") as HTMLSelectElement).value).toBe(
        room,
      );
      expect(camera.getAttribute("style")).toBe(beforeCamera);
      fireEvent.change(view.getByLabelText("Wall paint"), {
        target: { value: "sage" },
      });
      fireEvent.click(view.getByRole("button", { name: "Save layout" }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0]![0].styles).toEqual([
        { room, paint: "sage", floor: "original" },
      ]);
    },
  );

  it.each(["activation", "arrow movement"])(
    "saves finishes for the furniture's room after keyboard %s",
    async (selection) => {
      const onSave = vi
        .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
        .mockResolvedValue(false);
      const mainStyle = {
        room: "main" as const,
        paint: "rose" as const,
        floor: "terracotta" as const,
      };
      const view = render(
        <HomeScene
          {...props}
          homeType="TOWN_HOUSE"
          canDecorate
          furniture={[...starterFurniture, rugDefinition]}
          layout={[
            ...props.layout,
            { id: rugDefinition.id, x: 50, y: 50, rotation: 0, room: "room-1" },
          ]}
          styles={[mainStyle]}
          onSave={onSave}
        />,
      );
      fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      expect(
        view.getByText(`Main room · 3/${HOME_FURNITURE_MAX_PLACEMENTS} pieces`),
      ).toBeTruthy();
      const rug = view.getByRole("button", { name: "Move Woven Rug" });
      const before = furniturePosition(rug);
      rug.focus();
      // Native Enter/Space activation dispatches a click with no pointer detail.
      if (selection === "activation") fireEvent.click(rug, { detail: 0 });
      else fireEvent.keyDown(rug, { key: "ArrowRight" });
      expect(rug.getAttribute("aria-pressed")).toBe("true");
      expect((view.getByLabelText("Furniture room") as HTMLSelectElement).value).toBe(
        "room-1",
      );
      expect(
        view.getByText(`Room 2 · 1/${HOME_FURNITURE_MAX_PLACEMENTS} pieces`),
      ).toBeTruthy();
      expect((view.getByLabelText("Wall paint") as HTMLSelectElement).value).toBe(
        "ivory",
      );
      if (selection === "activation") expect(furniturePosition(rug)).toEqual(before);
      else expect(furniturePosition(rug)).not.toEqual(before);
      fireEvent.change(view.getByLabelText("Wall paint"), {
        target: { value: "sage" },
      });
      fireEvent.change(view.getByLabelText("Floor tiles"), {
        target: { value: "slate" },
      });
      fireEvent.click(view.getByRole("button", { name: "Save layout" }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0]![0].styles).toEqual([
        mainStyle,
        { room: "room-1", paint: "sage", floor: "slate" },
      ]);
    },
  );

  it("keeps the source room active when a drop misses the decorative lawn", async () => {
    const onSave = vi
      .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
      .mockResolvedValue(false);
    const view = render(
      <HomeScene {...props} homeType="TOWN_HOUSE" canDecorate onSave={onSave} />,
    );
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    const bed = view.getByRole("button", { name: "Move Bed" });
    bed.setPointerCapture = vi.fn();
    view.getByRole("group", { name: "Home scene" }).getBoundingClientRect = () =>
      new DOMRect(0, 0, 800, 600);
    const before = furniturePosition(bed);
    firePointerEvent(bed, "pointerdown", 1, 200, 200);
    firePointerEvent(bed, "pointermove", 1, 200, 824);
    firePointerEvent(bed, "pointerup", 1, 200, 824);
    expect(furniturePosition(bed)).toEqual(before);
    expect((view.getByLabelText("Furniture room") as HTMLSelectElement).value).toBe(
      "main",
    );
    fireEvent.change(view.getByLabelText("Wall paint"), { target: { value: "sage" } });
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0].styles).toEqual([
      { room: "main", paint: "sage", floor: "original" },
    ]);
  });

  it.each(["background", "furniture", "editing furniture"])(
    "pinches from %s without invoking an action or moving furniture",
    async (start) => {
      const onSave = vi
        .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
        .mockResolvedValue(false);
      const view = render(
        <HomeScene {...props} homeType="TOWN_HOUSE" canDecorate onSave={onSave} />,
      );
      if (start === "editing furniture")
        fireEvent.click(view.getByRole("button", { name: "Decorate" }));
      fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
      const scene = view.getByRole("group", { name: "Home scene" });
      scene.setPointerCapture = vi.fn();
      scene.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
      const bed = view.getByRole("button", {
        name: start === "editing furniture" ? "Move Bed" : "Bed: Go to sleep",
      });
      bed.setPointerCapture = vi.fn();
      const before = furniturePosition(bed);
      const first = start === "background" ? scene : bed;
      firePointerEvent(first, "pointerdown", 1, 200, 200);
      if (start === "editing furniture") {
        firePointerEvent(bed, "pointermove", 1, 210, 205);
        expect(furniturePosition(bed)).not.toEqual(before);
      }
      const initialScale = sceneCamera(scene).scale;
      const firstX = start === "editing furniture" ? 210 : 200;
      const firstY = start === "editing furniture" ? 205 : 200;
      firePointerEvent(scene, "pointerdown", 2, 400, 200);
      firePointerEvent(scene, "pointermove", 2, 600, 200);
      expect(view.getByLabelText("Camera zoom").textContent).toBe(
        cameraZoom(
          "TOWN_HOUSE",
          Math.min(
            1.8,
            (initialScale * Math.hypot(600 - firstX, 200 - firstY)) /
              Math.hypot(400 - firstX, 200 - firstY),
          ),
        ),
      );
      firePointerEvent(scene, "pointerup", 2, 600, 200);
      firePointerEvent(bed, "pointermove", 1, 220, 200);
      firePointerEvent(first, "pointerup", 1, 220, 200);
      fireEvent.click(bed, { detail: 1 });
      expect(props.onSleep).not.toHaveBeenCalled();
      expect(furniturePosition(bed)).toEqual(before);
      if (start === "editing furniture") {
        fireEvent.click(view.getByRole("button", { name: "Save layout" }));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(
          onSave.mock.calls[0]![0].placements.find(({ id }) => id === "owned-bed")
            ?.room ?? "main",
        ).toBe("main");
      } else {
        const camera = scene.querySelector("[data-home-camera]")?.getAttribute("style");
        firePointerEvent(bed, "pointerdown", 3, 200, 200);
        firePointerEvent(bed, "pointermove", 3, 202, 201);
        firePointerEvent(bed, "pointerup", 3, 202, 201);
        fireEvent.click(bed, { detail: 1 });
        expect(props.onSleep).toHaveBeenCalledTimes(1);
        expect(scene.querySelector("[data-home-camera]")?.getAttribute("style")).toBe(
          camera,
        );
      }
    },
  );

  it("moves furniture between rooms and publishes the room's paint and tiles with one draft", async () => {
    const onSave = vi
      .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
      .mockResolvedValue(false);
    const view = render(
      <HomeScene {...props} homeType="TOWN_HOUSE" canDecorate onSave={onSave} />,
    );
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    fireEvent.change(view.getByLabelText("Furniture room"), {
      target: { value: "room-1" },
    });
    fireEvent.change(view.getByLabelText("Wall paint"), { target: { value: "sage" } });
    fireEvent.change(view.getByLabelText("Floor tiles"), {
      target: { value: "slate" },
    });
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(
      onSave.mock.calls[0]![0].placements.find(({ id }) => id === "owned-bed")?.room,
    ).toBe("room-1");
    expect(onSave.mock.calls[0]![0].styles).toEqual([
      { room: "room-1", paint: "sage", floor: "slate" },
    ]);
    const focused = getHomeRoomCamera("TOWN_HOUSE", "room-1");
    expect(
      view
        .getByRole("group", { name: "Home scene" })
        .querySelector("[data-home-camera]")
        ?.getAttribute("style"),
    ).toContain(`translate(${focused.x}%, ${focused.y}%) scale(${focused.scale})`);
  });

  it("keeps visitors from invoking home actions or decoration", () => {
    const view = render(<HomeScene {...props} homeType="TOWN_HOUSE" isVisiting />);
    expect(view.queryByRole("group", { name: "Home actions" })).toBeNull();
    const scene = within(view.getByRole("group", { name: "Home scene" }));
    expect(
      scene.queryByRole("button", { name: /Bed|Armory|Kitchen|Garden|Decorate/ }),
    ).toBeNull();
    expect(props.onSleep).not.toHaveBeenCalled();
    expect(view.container.textContent).not.toContain("You are awake");
    fireEvent.click(scene.getByRole("button", { name: "Zoom in" }));
    expect(view.getByLabelText("Camera zoom").textContent).toBe("120%");
  });

  it("names placed action furniture and decorations for visitors without exposing actions", () => {
    const view = render(
      <HomeScene
        {...props}
        homeType="TOWN_HOUSE"
        isVisiting
        furniture={[starterFurniture[0]!, rugDefinition]}
        layout={[
          { id: "owned-bed", room: "room-1", x: 50, y: 50, rotation: 0 },
          { id: rugDefinition.id, x: 50, y: 50, rotation: 0 },
        ]}
      />,
    );
    const scene = within(view.getByRole("group", { name: "Home scene" }));
    for (const name of ["Bed", "Woven Rug"]) {
      const image = scene.getByRole("img", { name });
      expect(image.querySelector("img")?.getAttribute("alt")).toBe("");
      expect(image.hasAttribute("tabindex")).toBe(false);
      fireEvent.click(image);
    }
    expect(scene.queryByRole("button", { name: /Bed|Woven Rug|Decorate/ })).toBeNull();
    expect(props.onSleep).not.toHaveBeenCalled();
    expect(props.onStorage).not.toHaveBeenCalled();
    expect(props.onKitchen).not.toHaveBeenCalled();
    expect(props.onFarm).not.toHaveBeenCalled();
  });

  it("accounts for camera scale when dragging furniture and resets to the full property", async () => {
    const onSave = vi
      .fn<NonNullable<ComponentProps<typeof HomeScene>["onSave"]>>()
      .mockResolvedValue(false);
    const view = render(
      <HomeScene
        {...props}
        homeType="TOWN_HOUSE"
        layout={centeredEssentialsLayout}
        canDecorate
        onSave={onSave}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Decorate" }));
    fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(view.getByRole("button", { name: "Zoom out" }));
    const scene = view.getByRole("group", { name: "Home scene" });
    const scale = sceneCamera(scene).scale;
    const room = getHomeRooms("TOWN_HOUSE")[0]!;
    const bed = view.getByRole("button", { name: "Move Bed" });
    bed.setPointerCapture = vi.fn();
    view.getByRole("group", { name: "Home scene" }).getBoundingClientRect = () =>
      new DOMRect(0, 0, 800, 600);
    firePointerEvent(bed, "pointerdown", 1, 300, 300);
    firePointerEvent(bed, "pointermove", 1, 320, 310);
    firePointerEvent(bed, "pointerup", 1, 320, 310);
    fireEvent.click(view.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]![0].placements.find(
      ({ id }) => id === "owned-bed",
    )!;
    expect(saved.x).toBeCloseTo(
      50 + ((20 / (800 * scale)) * 10000) / room.width / HOME_FLOOR_PROJECTION.scaleX,
    );
    expect(saved.y).toBeCloseTo(
      50 + ((10 / (600 * scale)) * 10000) / room.height / HOME_FLOOR_PROJECTION.scaleY,
    );
    fireEvent.click(view.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(view.getByRole("button", { name: "Reset view" }));
    expect(view.getByLabelText("Camera zoom").textContent).toBe("100%");
    const overview = getHomeOverviewCamera("TOWN_HOUSE");
    expect(
      view
        .getByRole("group", { name: "Home scene" })
        .querySelector("[data-home-camera]")
        ?.getAttribute("style"),
    ).toContain(`translate(${overview.x}%, ${overview.y}%)`);
  });
});

const furniturePosition = (target: HTMLElement) => [
  target.style.left,
  target.style.top,
];

const firePointerEvent = (
  target: HTMLElement | Document,
  type: string,
  pointerId: number,
  clientX = 100,
  clientY = 100,
) => {
  // jsdom has no PointerEvent constructor; dispatch its mouse coordinates with a pointer ID.
  const event = new window.MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX,
    clientY,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  fireEvent(target, event);
};

/** Center a cultivation fixture on the mapped planting clearing. */
const gardenPlacement = (homeType: HomeType): HomePlacement => {
  const room = getHomeRooms(homeType).find(({ isYard }) => isYard)!;
  return {
    id: "owned-garden",
    room: "yard",
    rotation: 0,
    ...unprojectHomePlacement({
      x: room.outdoor.reduce((sum, point) => sum + point.x, 0) / room.outdoor.length,
      y: room.outdoor.reduce((sum, point) => sum + point.y, 0) / room.outdoor.length,
    }),
  };
};

/** Recover the visible camera values used to convert a user's pixel gesture to world coordinates. */
const sceneCamera = (scene: HTMLElement): HomeCamera => {
  const transform =
    scene.querySelector<HTMLElement>("[data-home-camera]")!.style.transform;
  const values = transform.match(
    /translate\(([-\d.e]+)%, ([-\d.e]+)%\) scale\(([-\d.e]+)\)/,
  )!;
  return { x: Number(values[1]), y: Number(values[2]), scale: Number(values[3]) };
};

/** Turn a normalized saved floor anchor into the whole painting's coordinate space. */
const worldAnchor = (homeType: HomeType, placement: HomePlacement) => {
  const room = getHomeRooms(homeType).find(
    ({ id }) => id === getHomePlacementRoom(placement),
  )!;
  const anchor = projectHomePlacement(placement);
  return {
    x: room.x + (anchor.x * room.width) / 100,
    y: room.y + (anchor.y * room.height) / 100,
  };
};

/** Players see zoom relative to the complete property, independently of the tier's world dimensions. */
const cameraZoom = (homeType: HomeType, scale: number) =>
  `${Math.round((scale / getHomeOverviewCamera(homeType).scale) * 100)}%`;
