import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { directionIndex, useChakraStormSteering } from "@/hooks/useChakraStormSteering";

const EAST = directionIndex(1, 0);
const NORTH = directionIndex(0, 1);

/** The playfield's joystick layer, which leaves while a level-up draft is open. */
const Field = (props: {
  steering: boolean;
  setMove: (direction: number) => void;
  setPaused?: (paused: boolean) => void;
}) => {
  const { stickView, handlers } = useChakraStormSteering({
    playing: true,
    steering: props.steering,
    paused: false,
    setMove: props.setMove,
    setPaused: props.setPaused ?? (() => {}),
  });
  return (
    <>
      {props.steering && (
        <div data-testid="field" {...handlers}>
          {stickView && <span data-testid="stick" />}
        </div>
      )}
    </>
  );
};

const pointer = (pointerId: number, clientX: number, clientY: number) => ({
  pointerId,
  pointerType: "touch",
  button: 0,
  clientX,
  clientY,
});

/** Drag from the middle of the field the given way, without letting go. */
const drag = (field: HTMLElement, pointerId: number, dx: number, dy: number) => {
  fireEvent.pointerDown(field, pointer(pointerId, 100, 100));
  fireEvent.pointerMove(field, pointer(pointerId, 100 + dx, 100 + dy));
};

describe("Chakra Storm steering", () => {
  let setMove: ReturnType<typeof vi.fn<(direction: number) => void>>;
  beforeEach(() => {
    setMove = vi.fn<(direction: number) => void>();
  });
  afterEach(() => {
    cleanup();
  });

  it("stops walking when a level-up draft opens mid-drag, and steers again after the pick", () => {
    const view = render(<Field steering setMove={setMove} />);
    drag(view.getByTestId("field"), 1, 60, 0);
    expect(setMove).toHaveBeenLastCalledWith(EAST);

    // The draft opens while the finger is still down; its release never reaches the field.
    view.rerender(<Field steering={false} setMove={setMove} />);
    expect(setMove).toHaveBeenLastCalledWith(-1);

    // After the pick, a new drag steers the hero.
    view.rerender(<Field steering setMove={setMove} />);
    expect(view.queryByTestId("stick")).toBeNull();
    drag(view.getByTestId("field"), 2, 0, -60);
    expect(setMove).toHaveBeenLastCalledWith(NORTH);
    expect(view.getByTestId("stick")).toBeTruthy();
    fireEvent.pointerUp(view.getByTestId("field"), pointer(2, 100, 40));
    expect(setMove).toHaveBeenLastCalledWith(-1);
  });

  it("lets the keys steer after a draft ends a drag", () => {
    const view = render(<Field steering setMove={setMove} />);
    drag(view.getByTestId("field"), 1, 60, 0);
    view.rerender(<Field steering={false} setMove={setMove} />);
    view.rerender(<Field steering setMove={setMove} />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    });
    expect(setMove).toHaveBeenLastCalledWith(NORTH);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
    });
    expect(setMove).toHaveBeenLastCalledWith(-1);
  });

  it("drops a drag when the window loses focus", () => {
    const view = render(<Field steering setMove={setMove} />);
    drag(view.getByTestId("field"), 1, 60, 0);
    act(() => {
      window.dispatchEvent(new window.Event("blur"));
    });
    expect(setMove).toHaveBeenLastCalledWith(-1);
    expect(view.queryByTestId("stick")).toBeNull();
    drag(view.getByTestId("field"), 2, 0, -60);
    expect(setMove).toHaveBeenLastCalledWith(NORTH);
  });

  it("ends a drag when its pointer is cancelled", () => {
    const view = render(<Field steering setMove={setMove} />);
    drag(view.getByTestId("field"), 1, 60, 0);
    fireEvent.pointerCancel(view.getByTestId("field"), pointer(1, 160, 100));
    expect(setMove).toHaveBeenLastCalledWith(-1);
    expect(view.queryByTestId("stick")).toBeNull();
  });

  /** Pointer capture on the field, which JSDOM does not track. */
  const mockCapture = (field: HTMLElement) => {
    const captured = new Set<number>();
    Object.assign(field, {
      setPointerCapture: (id: number) => captured.add(id),
      releasePointerCapture: (id: number) => captured.delete(id),
      hasPointerCapture: (id: number) => captured.has(id),
    });
    return captured;
  };

  it("keeps a live drag when a second finger touches the field", () => {
    const view = render(<Field steering setMove={setMove} />);
    const field = view.getByTestId("field");
    mockCapture(field);
    drag(field, 1, 60, 0);
    drag(field, 2, 0, -60);
    expect(setMove).toHaveBeenLastCalledWith(EAST);
    fireEvent.pointerUp(field, pointer(2, 100, 40));
    expect(setMove).toHaveBeenLastCalledWith(EAST);
  });

  it("lets a new drag replace one whose pointer capture is gone", () => {
    const view = render(<Field steering setMove={setMove} />);
    const field = view.getByTestId("field");
    const captured = mockCapture(field);
    drag(field, 1, 60, 0);
    captured.delete(1);
    drag(field, 2, 0, -60);
    expect(setMove).toHaveBeenLastCalledWith(NORTH);
    // Late events from the old pointer do not stop the new drag.
    fireEvent.pointerMove(field, pointer(1, 200, 100));
    fireEvent.pointerUp(field, pointer(1, 200, 100));
    expect(setMove).toHaveBeenLastCalledWith(NORTH);
    expect(view.getByTestId("stick")).toBeTruthy();
  });
});
