import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IMG_KESSEN_PACKS } from "@/drizzle/constants";
import * as mediaQuery from "@/hooks/useMediaQuery";
import { CardFace, kessenCardLabel } from "@/layout/kessen/CardFace";
import { CardTile, kessenTileLabel } from "@/layout/kessen/CardTile";
import { WaxSealGlyph } from "@/layout/kessen/glyphs";
import { KeywordText } from "@/layout/kessen/KeywordText";
import {
  isKessenToken,
  type KessenCardDisplay,
  kessenArtUrl,
  kessenFocalPosition,
  kessenMedallionCrop,
  kessenPackArt,
  kessenRarityTier,
  kessenRenditionWidth,
} from "@/layout/kessen/kessenArt";
import { LeaderMedallion, LeaderPlate } from "@/layout/kessen/LeaderPlate";
import { RarityGem } from "@/layout/kessen/RarityGem";
import { KESSEN_DECK_FACTIONS } from "@/libs/kessen/deck";
import { KESSEN_PACK_IDS } from "@/libs/kessen/packs";
import {
  KESSEN_FORBIDDEN,
  KESSEN_TOKEN,
  seedCardByName,
} from "../../libs/kessen/fixtures/catalog";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

const ART = "https://uploadthing.b-cdn.net/f/kessen-art.webp";

const display = (card: KessenCardDisplay): KessenCardDisplay => ({
  ...card,
  artUrl: ART,
  focalX: 40,
  focalY: 20,
  flavor: "A line of flavor.",
});

beforeEach(() => {
  installBrowserGlobals();
  vi.spyOn(mediaQuery, "useMediaQuery").mockImplementation(() => false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("Kessen card art helpers", () => {
  it("snaps renditions to the shared widths without upscaling the source", () => {
    expect(kessenRenditionWidth(60)).toBe(160);
    expect(kessenRenditionWidth(300)).toBe(768);
    expect(kessenRenditionWidth(2000)).toBe(1024);
    expect(kessenArtUrl(ART, 100)).toBe(`${ART}?width=160`);
  });

  it("maps pack ids to their artwork", () => {
    expect(kessenPackArt("kessen-pack-paper")).toBe(IMG_KESSEN_PACKS.paper);
  });

  it("gives the Lacquer Case a cut-out distinct from its item icon", () => {
    const art = kessenPackArt(KESSEN_PACK_IDS.lacquer);
    expect(art).toStartWith("https://uploadthing.b-cdn.net/f/");
    expect(art).toEndWith(".webp");
    expect(Object.values(IMG_KESSEN_PACKS)).not.toContain(art);
  });

  it("gives the First Bundle artwork distinct from the Paper Bundle", () => {
    const art = kessenPackArt(KESSEN_PACK_IDS.first);
    expect(art).toStartWith("https://uploadthing.b-cdn.net/f/");
    expect(art).not.toBe(IMG_KESSEN_PACKS.paper);
    expect(Object.values(IMG_KESSEN_PACKS)).not.toContain(art);
  });

  it("gives every Village Bundle its own artwork", () => {
    const art = KESSEN_DECK_FACTIONS.map((faction) =>
      kessenPackArt(KESSEN_PACK_IDS.village(faction)),
    );
    expect(new Set(art).size).toBe(KESSEN_DECK_FACTIONS.length);
    expect(art).not.toContain(IMG_KESSEN_PACKS.village);
    for (const url of art) expect(url).toStartWith("https://uploadthing.b-cdn.net/f/");
    expect(kessenPackArt("kessen-pack-village-unknown")).toBe(IMG_KESSEN_PACKS.village);
  });

  it("derives the visual tier, token flag and focal position", () => {
    const forbidden = KESSEN_FORBIDDEN[0];
    if (!forbidden) throw new Error("missing Forbidden fixture");
    expect(kessenRarityTier(forbidden)).toBe("FORBIDDEN");
    expect(kessenRarityTier(seedCardByName("Moonprowler"))).toBe("COMMON");
    expect(isKessenToken(KESSEN_TOKEN)).toBe(true);
    expect(isKessenToken(seedCardByName("Moonprowler"))).toBe(false);
    expect(kessenFocalPosition({ focalX: 140, focalY: null })).toBe("100% 35%");
  });
});

describe("CardFace", () => {
  it("labels a unit with power, row, ability text and rarity", () => {
    const card = display(seedCardByName("Moonprowler"));
    render(<CardFace card={card} motion={false} copies={{ owned: 2, max: 3 }} />);
    const face = screen.getByRole("article");
    expect(face.getAttribute("data-tier")).toBe("COMMON");
    expect(face.getAttribute("aria-label")).toBe(
      kessenCardLabel(card, { copies: { owned: 2, max: 3 } }),
    );
    expect(face.getAttribute("aria-label")).toContain("Moonprowler, power ");
    expect(face.getAttribute("aria-label")).toContain("2 of 3 copies");
    expect(face.querySelectorAll(".kc-pip[data-on]")).toHaveLength(2);
    expect(face.querySelector(".kc-panel .kc-pips")).not.toBeNull();
  });

  it("keeps the copy count in the label when the pips are hidden", () => {
    const card = display(seedCardByName("Moonprowler"));
    render(
      <CardFace
        card={card}
        motion={false}
        copies={{ owned: 1, max: 3 }}
        showCopyPips={false}
      />,
    );
    const face = screen.getByRole("article");
    expect(face.querySelector(".kc-pips")).toBeNull();
    expect(face.getAttribute("aria-label")).toContain("1 of 3 copies");
  });

  it("shows the provision bonus on a leader", () => {
    const leader = display(seedCardByName("Hisame, Dune Warden"));
    render(<CardFace card={leader} motion={false} />);
    const face = screen.getByRole("article");
    expect(face.querySelector(".kc-power")?.textContent).toBe(`+${leader.leaderBonus}`);
    expect(face.querySelector(".kc-prov")).toBeNull();
    expect(face.getAttribute("aria-label")).toContain(
      `provision bonus ${leader.leaderBonus}`,
    );
  });

  it("titles a leader's ability on the card and the plate", () => {
    const leader = {
      ...display(seedCardByName("Hisame, Dune Warden")),
      abilityName: "Sunflare",
    };
    render(<CardFace card={leader} motion={false} />);
    const face = screen.getByRole("article");
    expect(face.querySelector(".kc-ability-name")?.textContent).toBe("Sunflare");
    expect(face.getAttribute("aria-label")).toContain("ability Sunflare");
    cleanup();
    render(<LeaderPlate leader={leader} used />);
    expect(document.querySelector(".kessen-plate-ability-name")?.textContent).toBe(
      "Sunflare · used",
    );
  });

  it("marks Forbidden variants, tokens, loans and new cards", () => {
    const forbidden = KESSEN_FORBIDDEN[0];
    if (!forbidden) throw new Error("missing Forbidden fixture");
    const { unmount } = render(
      <CardFace card={display(forbidden)} motion={false} loan isNew />,
    );
    const face = screen.getByRole("article");
    expect(face.getAttribute("data-tier")).toBe("FORBIDDEN");
    expect(face.querySelectorAll(".kc-ofuda")).toHaveLength(2);
    expect(face.textContent).toContain("LOAN");
    expect(face.textContent).toContain("NEW");
    unmount();
    render(<CardFace card={display(KESSEN_TOKEN)} motion={false} />);
    const token = screen.getByRole("article");
    expect(token.hasAttribute("data-token")).toBe(true);
    expect(token.textContent).toContain("Token");
  });
});

describe("CardFace keyword strip", () => {
  it("lists keyword names with their values for mid-size cards", () => {
    const card = display({
      ...seedCardByName("Moonprowler"),
      abilities: [
        { k: "meditate", x: 1 },
        { k: "rally", x: 1 },
      ],
    } as KessenCardDisplay);
    render(<CardFace card={card} motion={false} />);
    const strip = screen.getByRole("article").querySelector(".kc-kw-strip");
    expect(strip?.textContent).toBe("Meditate 1 · Rally 1");
    expect(strip?.getAttribute("aria-hidden")).toBe("true");
  });

  it("counts a repeated keyword and leaves vanilla cards without a strip", () => {
    const twice = display({
      ...seedCardByName("Moonprowler"),
      abilities: [
        { k: "strike", x: 2, mode: "single" },
        { k: "strike", x: 2, mode: "single" },
      ],
    } as KessenCardDisplay);
    const { unmount } = render(<CardFace card={twice} motion={false} />);
    expect(screen.getByRole("article").querySelector(".kc-kw-strip")?.textContent).toBe(
      "Strike 2 ×2",
    );
    unmount();
    render(
      <CardFace
        card={display({ ...seedCardByName("Moonprowler"), abilities: [] })}
        motion={false}
      />,
    );
    expect(screen.getByRole("article").querySelector(".kc-kw-strip")).toBeNull();
  });

  it("prints every keyword whole: groups dropped, a Terrain row as its glyph", () => {
    const card = display({
      ...seedCardByName("Moonprowler"),
      abilities: [
        { k: "unyielding" },
        { k: "bond", group: "Moon Pack" },
        { k: "summon", group: "Crew" },
        { k: "terrain", row: "RANGED" },
      ],
    } as KessenCardDisplay);
    render(<CardFace card={card} motion={false} />);
    const strip = screen.getByRole("article").querySelector(".kc-kw-strip");
    expect(strip?.textContent).toBe("Unyielding · Bond · Summon · Terrain");
    const items = strip?.querySelectorAll(".kc-kw-item") ?? [];
    expect(items).toHaveLength(4);
    expect(items[3]?.querySelector("svg.kc-kw-row")).not.toBeNull();
    expect(screen.getByRole("article").getAttribute("aria-label")).toContain(
      "Bond (Moon Pack)",
    );
  });

  it("keeps the provision hex on collection cards and hides it on the board", () => {
    const card = display(seedCardByName("Moonprowler"));
    const { unmount } = render(<CardFace card={card} motion={false} />);
    expect(screen.getByRole("article").querySelector(".kc-prov")?.textContent).toBe(
      String(card.provision),
    );
    unmount();
    render(<CardFace card={card} motion={false} showProvision={false} />);
    expect(screen.getByRole("article").querySelector(".kc-prov")).toBeNull();
  });

  it("hands over from the strip to the full text at one size, with no clamped preview", () => {
    const css = readFileSync(
      join(import.meta.dirname, "../../../src/layout/kessen/kessen.css"),
      "utf8",
    );
    const showsAt = (pattern: RegExp) =>
      [
        ...css.matchAll(
          /@container kessen-card \(min-width: (\d+)px\) \{([\s\S]*?)\n\}/g,
        ),
      ]
        .filter(([, , body]) => pattern.test(body ?? ""))
        .map(([, width]) => Number(width));
    const bodyShown = showsAt(/\.kc-body \{\s*display: block;/);
    const stripHidden = showsAt(/\.kc-kw-strip \{\s*display: none;/);
    expect(bodyShown).toEqual([220]);
    expect(stripHidden).toEqual(bodyShown);
  });
});

describe("KeywordText", () => {
  it("opens the glossary above the card panel inside a card face", async () => {
    const card = display({
      ...seedCardByName("Moonprowler"),
      abilities: [{ k: "rally", x: 2 }],
    } as KessenCardDisplay);
    render(<CardFace card={card} motion={false} interactiveKeywords />);
    const face = screen.getByRole("article");
    expect(face.hasAttribute("data-interactive")).toBe(true);
    expect(
      face.querySelector(".kc-panel")?.hasAttribute("data-kessen-glossary-anchor"),
    ).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Rally 2\./ }));
    });
    const glossary = await screen.findByText(/^: /);
    expect(glossary.closest("[data-side]")?.getAttribute("data-side")).toBe("top");
  });

  it("opens the glossary below the keyword outside a card", async () => {
    render(<KeywordText abilities={[{ k: "rally", x: 2 }]} interactive />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Rally 2\./ }));
    });
    const glossary = await screen.findByText(/^: /);
    expect(glossary.closest("[data-side]")?.getAttribute("data-side")).toBe("bottom");
  });
});

describe("CardTile", () => {
  it("colours power against the printed value and draws one status glyph", () => {
    const card = display(seedCardByName("Moonprowler"));
    const { rerender } = render(
      <CardTile
        card={card}
        power={card.power + 2}
        status={{ sealed: true, resilient: true }}
        motion={false}
      />,
    );
    let tile = screen.getByRole("img", { name: /Moonprowler/ });
    expect(tile.getAttribute("data-delta")).toBe("up");
    expect(tile.querySelectorAll(".kt-status")).toHaveLength(1);
    expect(tile.getAttribute("aria-label")).toBe(
      kessenTileLabel(card, {
        power: card.power + 2,
        status: { sealed: true, resilient: true },
      }),
    );
    rerender(<CardTile card={card} power={card.power - 1} terrain motion={false} />);
    tile = screen.getByRole("img", { name: /Moonprowler/ });
    expect(tile.getAttribute("data-delta")).toBe("down");
    expect(tile.getAttribute("aria-label")).toContain("under Terrain");
  });
});

describe("kessenMedallionCrop", () => {
  it("centres the face and keeps the zoomed art covering the disc", () => {
    expect(kessenMedallionCrop({ id: "x", focalX: 50, focalY: 20 })).toEqual({
      width: "220%",
      height: "330%",
      left: "-60%",
      top: "-16%",
    });
    const corner = kessenMedallionCrop({ id: "x", focalX: 0, focalY: 100 });
    expect(corner.left).toBe("0%");
    expect(corner.top).toBe("-230%");
  });

  it("uses a leader's own face position where its focal point frames the figure", () => {
    const placed = kessenMedallionCrop({
      id: "kessen-leader-kaze-no-seirei",
      focalX: 47,
      focalY: 18,
    });
    expect(placed.width).toBe("260%");
    expect(placed).not.toEqual(
      kessenMedallionCrop({ id: "x", focalX: 47, focalY: 18 }),
    );
  });
});

describe("LeaderMedallion", () => {
  it("presses a wax seal on a used leader instead of hiding the portrait", () => {
    const leader = display(seedCardByName("Hisame, Dune Warden"));
    const { rerender } = render(
      <LeaderMedallion leader={leader} ready motion={false} />,
    );
    let medallion = screen.getByRole("img", { name: /leader ability ready/ });
    expect(medallion.hasAttribute("data-ready")).toBe(true);
    expect(medallion.querySelector(".kessen-medallion-spent")).toBeNull();
    rerender(<LeaderMedallion leader={leader} used ready motion={false} />);
    medallion = screen.getByRole("img", { name: /leader ability used/ });
    expect(medallion.hasAttribute("data-ready")).toBe(false);
    // The portrait stays, cropped like a ready medallion; the crop is read from the
    // helper because other suites replace the image component with a bare stub.
    expect(medallion.querySelector(".kessen-medallion-art img")).not.toBeNull();
    expect(kessenMedallionCrop(leader)).toMatchObject({ width: "220%" });
    expect(
      medallion.querySelector(".kessen-medallion-spent svg")?.getAttribute("data-mark"),
    ).toBe("seal");
  });
});

describe("WaxSealGlyph", () => {
  it("stamps the seal kanji by default and a check for a beaten opponent", () => {
    const { container } = render(
      <>
        <WaxSealGlyph />
        <WaxSealGlyph mark="won" />
      </>,
    );
    const marks = [...container.querySelectorAll("svg")].map((svg) =>
      svg.getAttribute("data-mark"),
    );
    expect(marks).toEqual(["seal", "won"]);
    expect(container.querySelectorAll("svg[aria-hidden]")).toHaveLength(2);
  });
});

describe("RarityGem", () => {
  it("names every tier for assistive technology", () => {
    render(
      <>
        {(["COMMON", "RARE", "EPIC", "LEGENDARY", "FORBIDDEN"] as const).map((tier) => (
          <RarityGem key={tier} tier={tier} />
        ))}
      </>,
    );
    for (const name of ["Common", "Rare", "Epic", "Legendary", "Forbidden"]) {
      expect(screen.getByRole("img", { name: `${name} rarity` })).toBeTruthy();
    }
  });
});
