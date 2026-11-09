import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Container } from "pixi.js";
import * as lpcHooks from "@/hooks/lpc";
import { CharacterPreview } from "@/layout/CharacterPreview";
import * as character from "@/libs/rendering/primitives/character";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import * as runtime from "@/libs/rendering/runtime";
import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";
import { lpcCatalog } from "../setup/lpc";

const draw = vi.fn();
const visualEffects = { ...DEFAULT_VISUAL_EFFECTS };
const disposals: ReturnType<typeof vi.fn>[] = [];
const loadCatalog = async () => lpcCatalog;

let update: (frame: GameFrame) => void;
let createActor: Mock<typeof character.createLpcCharacter>;

beforeEach(() => {
  Object.assign(visualEffects, DEFAULT_VISUAL_EFFECTS);
  vi.spyOn(lpcHooks, "useLpcCatalogLoader").mockReturnValue(loadCatalog);
  draw.mockClear();
  disposals.length = 0;
  vi.spyOn(runtime, "createGameRenderer").mockImplementation(async ({ mount }) => {
    const canvas = document.createElement("canvas");
    mount.appendChild(canvas);
    const stage = new Container();
    const dispose = vi.fn(() => {
      canvas.remove();
      if (!stage.destroyed) stage.destroy({ children: true });
    });
    disposals.push(dispose);
    return {
      canvas,
      stage,
      visualEffects,
      dispose,
      setUpdate: (callback: (frame: GameFrame) => void) => {
        update = callback;
      },
    } as unknown as GameRenderer;
  });
  createActor = vi
    .spyOn(character, "createLpcCharacter")
    .mockImplementation(async () => ({
      sprite: new Container(),
      render: draw,
      durations: {},
      hasHeadgear: false,
      layers: [],
    }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("manual character preview rotation", () => {
  it("freezes preview sprites without mutating the source frame or rebuilding the renderer", async () => {
    const view = render(<CharacterPreview user={{}} />);
    await waitFor(() =>
      expect(
        (
          view.getByRole("button", {
            name: "Rotate character preview",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    const frame = { now: 1000, delta: 0.1, reducedMotion: false };
    visualEffects.spriteAnimations = false;
    update(frame);
    expect(draw.mock.lastCall?.[0]).toEqual({ ...frame, reducedMotion: true });
    expect(frame.reducedMotion).toBe(false);
    visualEffects.spriteAnimations = true;
    update(frame);
    expect(draw.mock.lastCall?.[0]).toBe(frame);
    expect(runtime.createGameRenderer).toHaveBeenCalledTimes(1);
  });
  it("holds its facing over time and turns through four views without reloading or submitting a form", async () => {
    const submit = vi.fn();
    const view = render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <CharacterPreview user={{}} />
      </form>,
    );
    const button = view.getByRole("button", { name: "Rotate character preview" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));

    update({ now: 100, delta: 0, reducedMotion: false });
    expect(draw.mock.lastCall?.[2]).toBe(2);
    update({ now: 10000, delta: 0.1, reducedMotion: false });
    expect(draw.mock.lastCall?.[2]).toBe(2);
    for (const direction of [3, 0, 1, 2]) {
      fireEvent.click(button);
      update({ now: 11000, delta: 0.1, reducedMotion: true });
      expect(draw.mock.lastCall?.[2]).toBe(direction);
    }
    expect(submit).not.toHaveBeenCalled();
    expect(runtime.createGameRenderer).toHaveBeenCalledTimes(1);
    expect(character.createLpcCharacter).toHaveBeenCalledTimes(1);
  });

  it("returns to the front when appearance changes and uses the selected body", async () => {
    const view = render(<CharacterPreview user={{ gender: "Female" }} />);
    const button = view.getByRole("button", { name: "Rotate character preview" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(createActor.mock.lastCall?.[1].body).toBe("female");
    fireEvent.click(button);
    update({ now: 100, delta: 0, reducedMotion: false });
    expect(draw.mock.lastCall?.[2]).toBe(3);

    view.rerender(
      <CharacterPreview
        user={{ gender: "Female", spriteBodyStyle: "male", attributes: ["Glasses"] }}
      />,
    );
    await waitFor(() => expect(character.createLpcCharacter).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(createActor.mock.lastCall?.[1].body).toBe("male");
    expect(disposals[0]).toHaveBeenCalledTimes(1);
    update({ now: 20000, delta: 0, reducedMotion: false });
    expect(draw.mock.lastCall?.[2]).toBe(2);
  });

  it("leaves a failed preview recoverable through the surrounding form with rotation disabled", async () => {
    createActor.mockRejectedValueOnce(new Error("Atlas unavailable"));
    const view = render(<CharacterPreview user={{}} />);
    await waitFor(() =>
      expect(view.getByRole("status").textContent).toContain(
        "You can continue editing",
      ),
    );
    expect(
      (
        view.getByRole("button", {
          name: "Rotate character preview",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(disposals[0]).toHaveBeenCalledTimes(1);
  });
});
