import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as navigation from "next/navigation";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

const push = vi.fn();

beforeEach(() => {
  installBrowserGlobals();
  vi.clearAllMocks();
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push } as never);
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  restoreBrowserGlobals();
  vi.restoreAllMocks();
});

describe("useUnsavedChangesGuard", () => {
  const Editor = (props: {
    isDirty: boolean;
    onBack: () => void;
    onNew: () => void;
  }) => {
    const guard = useUnsavedChangesGuard(props.isDirty);
    return (
      <div>
        {guard.dialog}
        <a href="/manual/jutsu">Jutsu list</a>
        <a href="https://example.com/docs">External</a>
        <button type="button" data-content-box-back onClick={props.onBack}>
          Back
        </button>
        <button type="button" onClick={() => guard.confirmDiscard(props.onNew)}>
          New
        </button>
      </div>
    );
  };

  it("lets clean editors navigate and swap drafts without asking", () => {
    const onBack = vi.fn();
    const onNew = vi.fn();
    const view = render(<Editor isDirty={false} onBack={onBack} onNew={onNew} />);
    fireEvent.click(view.getByText("Back"));
    fireEvent.click(view.getByText("New"));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(view.queryByText("Discard unsaved changes?")).toBeNull();
  });

  it("asks before an internal link leaves a dirty editor", () => {
    const view = render(<Editor isDirty onBack={vi.fn()} onNew={vi.fn()} />);
    fireEvent.click(view.getByText("Jutsu list"));
    expect(push).not.toHaveBeenCalled();
    expect(view.getByText("Discard unsaved changes?")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Discard changes" }));
    expect(push).toHaveBeenCalledWith("/manual/jutsu");
  });

  it("replays a confirmed back click and leaves external links alone", () => {
    const onBack = vi.fn();
    const view = render(<Editor isDirty onBack={onBack} onNew={vi.fn()} />);
    const external = view.getByText("External");
    const click = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    external.dispatchEvent(click);
    expect(view.queryByText("Discard unsaved changes?")).toBeNull();

    fireEvent.click(view.getByText("Back"));
    expect(onBack).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Discard changes" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("runs an in-page draft swap only after confirmation", () => {
    const onNew = vi.fn();
    const view = render(<Editor isDirty onBack={vi.fn()} onNew={onNew} />);
    fireEvent.click(view.getByText("New"));
    expect(onNew).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Discard changes" }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("asks the browser before unloading a dirty editor", () => {
    const view = render(<Editor isDirty onBack={vi.fn()} onNew={vi.fn()} />);
    const event = new window.Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    view.rerender(<Editor isDirty={false} onBack={vi.fn()} onNew={vi.fn()} />);
    const clean = new window.Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  });
});
