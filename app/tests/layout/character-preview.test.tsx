import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Container } from "pixi.js";
import * as lpcHooks from "@/hooks/lpc";
import { CharacterPreview } from "@/layout/CharacterPreview";
import type { LpcCharacter } from "@/libs/rendering/primitives/character";
import * as character from "@/libs/rendering/primitives/character";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import * as runtime from "@/libs/rendering/runtime";
import * as telemetry from "@/libs/rendering/telemetry";
import { DEFAULT_VISUAL_EFFECTS } from "@/libs/visualEffects";
import { deferred } from "../setup/deferred";
import { lpcCatalog } from "../setup/lpc";

const draw = vi.fn((..._input: Parameters<LpcCharacter["render"]>): boolean => true);
const visualEffects = { ...DEFAULT_VISUAL_EFFECTS };
const disposals: ReturnType<typeof vi.fn>[] = [];
const loadCatalog = async () => lpcCatalog;

let update: (frame: GameFrame) => boolean | undefined;
let createActor: Mock<typeof character.createLpcCharacter>;
let invalidate: ReturnType<typeof vi.fn>;
let setAnimating: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.assign(visualEffects, DEFAULT_VISUAL_EFFECTS);
  vi.spyOn(lpcHooks, "useLpcCatalogLoader").mockReturnValue(loadCatalog);
  vi.spyOn(telemetry, "reportRendererFailure").mockImplementation(() => {});
  draw.mockClear();
  draw.mockImplementation(() => true);
  disposals.length = 0;
  invalidate = vi.fn();
  setAnimating = vi.fn();
  vi.spyOn(runtime, "createGameRenderer").mockImplementation(async ({ mount }) => {
    const canvas = document.createElement("canvas");
    mount.appendChild(canvas);
    const stage = new Container();
    const cleanups = new Set<() => void>();
    let disposed = false;
    const dispose = vi.fn(() => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
      canvas.remove();
      if (!stage.destroyed) stage.destroy({ children: true });
    });
    disposals.push(dispose);
    return {
      canvas,
      stage,
      visualEffects,
      dispose,
      invalidate,
      setAnimating,
      lpcCatalog,
      isDisposed: () => disposed,
      own: (cleanup: () => void) => cleanups.add(cleanup),
      disown: (cleanup: () => void) => cleanups.delete(cleanup),
      setUpdate: (callback: typeof update) => {
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

const rotateButton = (view: ReturnType<typeof render>) =>
  view.getByRole("button", { name: "Rotate character preview" }) as HTMLButtonElement;

describe("character preview", () => {
  it("freezes preview sprites without mutating the source frame or rebuilding the renderer", async () => {
    const view = render(<CharacterPreview user={{}} />);
    await waitFor(() => expect(rotateButton(view).disabled).toBe(false));
    const frame = { now: 1000, delta: 0.1, reducedMotion: false };
    visualEffects.spriteAnimations = false;
    update(frame);
    expect(draw.mock.lastCall?.[0]).toEqual({ ...frame, reducedMotion: true });
    expect(frame.reducedMotion).toBe(false);
    // A frozen figure renders only when invalidated.
    expect(setAnimating).toHaveBeenLastCalledWith(false);
    visualEffects.spriteAnimations = true;
    update(frame);
    expect(draw.mock.lastCall?.[0]).toBe(frame);
    expect(setAnimating).toHaveBeenLastCalledWith(true);
    expect(runtime.createGameRenderer).toHaveBeenCalledTimes(1);
  });

  it("skips presenting frames whose pose did not change", async () => {
    const view = render(<CharacterPreview user={{}} />);
    await waitFor(() => expect(rotateButton(view).disabled).toBe(false));
    draw.mockImplementation(() => false);
    expect(update({ now: 100, delta: 0.016, reducedMotion: false })).toBe(false);
    draw.mockImplementation(() => true);
    expect(update({ now: 300, delta: 0.016, reducedMotion: false })).toBe(true);
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
    const button = rotateButton(view);
    expect(button.disabled).toBe(true);
    await waitFor(() => expect(button.disabled).toBe(false));

    update({ now: 100, delta: 0, reducedMotion: false });
    expect(draw.mock.lastCall?.[2]).toBe(2);
    update({ now: 10000, delta: 0.1, reducedMotion: false });
    expect(draw.mock.lastCall?.[2]).toBe(2);
    for (const direction of [3, 0, 1, 2] as const) {
      invalidate.mockClear();
      fireEvent.click(button);
      // A turn presents even when the figure is otherwise frozen.
      expect(invalidate).toHaveBeenCalled();
      update({ now: 11000, delta: 0.1, reducedMotion: true });
      expect(draw.mock.lastCall?.[2]).toBe(direction);
    }
    expect(submit).not.toHaveBeenCalled();
    expect(runtime.createGameRenderer).toHaveBeenCalledTimes(1);
    expect(character.createLpcCharacter).toHaveBeenCalledTimes(1);
  });

  it("keeps one renderer across appearance changes and returns to the front", async () => {
    const view = render(<CharacterPreview user={{ gender: "Female" }} />);
    const button = rotateButton(view);
    await waitFor(() => expect(button.disabled).toBe(false));
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
    expect(createActor.mock.lastCall?.[1].body).toBe("male");
    // The previous figure keeps the preview usable while the next one loads.
    expect(view.getByRole("status").textContent).toBe("Your ninja");
    await waitFor(() => {
      update({ now: 20000, delta: 0, reducedMotion: false });
      expect(draw.mock.lastCall?.[2]).toBe(2);
    });
    expect(runtime.createGameRenderer).toHaveBeenCalledTimes(1);
    expect(disposals[0]).not.toHaveBeenCalled();
    view.unmount();
    expect(disposals[0]).toHaveBeenCalledTimes(1);
  });

  it("shows only the latest appearance when an earlier one finishes loading last", async () => {
    let finishFirst = () => {};
    const first = { sprite: new Container(), render: vi.fn(() => true) };
    const second = { sprite: new Container(), render: vi.fn(() => true) };
    createActor
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = () =>
              resolve({ ...first, durations: {}, hasHeadgear: false, layers: [] });
          }),
      )
      .mockImplementationOnce(async () => ({
        ...second,
        durations: {},
        hasHeadgear: false,
        layers: [],
      }));
    const view = render(<CharacterPreview user={{}} />);
    await waitFor(() => expect(character.createLpcCharacter).toHaveBeenCalledTimes(1));
    view.rerender(<CharacterPreview user={{ attributes: ["Glasses"] }} />);
    await waitFor(() => expect(rotateButton(view).disabled).toBe(false));
    finishFirst();
    await Promise.resolve();
    update({ now: 100, delta: 0, reducedMotion: false });
    expect(second.render).toHaveBeenCalled();
    expect(first.render).not.toHaveBeenCalled();
    expect(first.sprite.parent).toBeNull();
    expect(second.sprite.parent).not.toBeNull();
  });

  it("leaves a failed preview recoverable through the surrounding form with rotation disabled", async () => {
    createActor.mockRejectedValueOnce(new Error("Atlas unavailable"));
    const view = render(<CharacterPreview user={{}} />);
    await waitFor(() =>
      expect(view.getByRole("status").textContent).toContain(
        "You can continue editing",
      ),
    );
    expect(rotateButton(view).disabled).toBe(true);
    expect(telemetry.reportRendererFailure).toHaveBeenCalledTimes(1);
    // The renderer stays for the next appearance, which recovers the preview.
    expect(disposals[0]).not.toHaveBeenCalled();
    view.rerender(<CharacterPreview user={{ attributes: ["Glasses"] }} />);
    await waitFor(() => expect(rotateButton(view).disabled).toBe(false));
    expect(view.getByRole("status").textContent).toBe("Your ninja");
  });

  it("retries failed catalog loading after an appearance edit without rebuilding the renderer", async () => {
    const load = vi
      .fn(loadCatalog)
      .mockRejectedValueOnce(new Error("Catalog unavailable"));
    vi.spyOn(lpcHooks, "useLpcCatalogLoader").mockReturnValue(load);
    const view = render(<CharacterPreview user={{}} />);
    await waitFor(() =>
      expect(view.getByRole("status").textContent).toContain(
        "You can continue editing",
      ),
    );
    expect(rotateButton(view).disabled).toBe(true);
    view.rerender(<CharacterPreview user={{ attributes: ["Glasses"] }} />);
    await waitFor(() => expect(rotateButton(view).disabled).toBe(false));
    expect(load).toHaveBeenCalledTimes(2);
    expect(runtime.createGameRenderer).toHaveBeenCalledTimes(1);
    expect(disposals[0]).not.toHaveBeenCalled();
  });

  it("ignores a catalog that finishes loading for an obsolete appearance", async () => {
    const held = deferred<typeof lpcCatalog>();
    const load = vi.fn(loadCatalog).mockImplementationOnce(() => held.promise);
    vi.spyOn(lpcHooks, "useLpcCatalogLoader").mockReturnValue(load);
    const view = render(<CharacterPreview user={{ gender: "Male" }} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    view.rerender(<CharacterPreview user={{ gender: "Female" }} />);
    await waitFor(() => expect(rotateButton(view).disabled).toBe(false));
    held.resolve(lpcCatalog);
    await Promise.resolve();
    expect(createActor).toHaveBeenCalledTimes(1);
    expect(createActor.mock.lastCall?.[1].body).toBe("female");
  });
});
