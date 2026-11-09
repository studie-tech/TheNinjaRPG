import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { ReactElement } from "react";
import * as uiToast from "@/components/ui/use-toast";
import { actualShowMutationToast } from "../setup/preload";

type ActionProps = {
  altText: string;
  className: string;
  children: ReactElement<{ className: string }>;
  onClick: () => void;
};

const toastCalls = () => {
  const spy = uiToast.toast as unknown as ReturnType<typeof vi.fn>;
  return spy.mock.calls.map(([options]) => options as Record<string, unknown>);
};

beforeEach(() => {
  vi.spyOn(uiToast, "toast").mockImplementation(
    (() => "id") as unknown as typeof uiToast.toast,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("showMutationToast", () => {
  it("skips empty and OK messages", () => {
    actualShowMutationToast({ success: true, message: "OK" });
    actualShowMutationToast({ success: false, message: "" });
    expect(toastCalls()).toEqual([]);
  });

  it("confirms a success with a green check", () => {
    actualShowMutationToast({ success: true, message: "Saved", duration: 5 });
    const options = toastCalls()[0]!;
    expect(options).toMatchObject({
      title: "Success",
      description: "Saved",
      duration: 5,
      id: undefined,
      variant: "default",
    });
    const action = (options.action as ReactElement<ActionProps>).props;
    expect(action.altText).toBe("OK");
    expect(action.className).toBe("h-5 bg-green-600 md:h-10");
    expect(action.children.props.className).toBe(
      "my-4 h-4 w-4 text-white md:h-6 md:w-6",
    );
  });

  it("reports a failure with a red mark and no stable id of its own", () => {
    actualShowMutationToast({ success: false, message: "Nope" });
    const options = toastCalls()[0]!;
    expect(options).toMatchObject({
      title: "Error",
      description: "Nope",
      variant: "default",
    });
    const action = (options.action as ReactElement<ActionProps>).props;
    expect(action.className).toBe("h-5 bg-red-600 md:h-10");
  });

  it("prefers the caller's title, id, variant and action", () => {
    const action = <button type="button">Act</button>;
    for (const success of [true, false]) {
      actualShowMutationToast({
        success,
        message: "Custom",
        title: "Title",
        id: "stable",
        variant: "destructive",
        action: action as never,
      });
    }
    for (const options of toastCalls()) {
      expect(options).toMatchObject({
        title: "Title",
        id: "stable",
        variant: "destructive",
      });
      expect(options.action).toBe(action);
    }
  });
});
