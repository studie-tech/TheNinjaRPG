import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StatusBar from "@/layout/StatusBar";
import { ensureDom } from "../setup-dom.mjs";

beforeEach(() => {
  ensureDom();
  vi.spyOn(Date, "now").mockReturnValue(new Date().getTime());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StatusBar capacity changes", () => {
  it.each([2800, 2600])("updates a full bar when capacity falls and current is %s", (current) => {
    const regenAt = new Date();
    const view = render(<StatusBar title="EP" color="bg-violet-500" showText status="AWAKE" regen={20} lastRegenAt={regenAt} current={2800} total={2800} />);
    expect(view.getByText("EP (2800 / 2800)")).toBeTruthy();
    view.rerender(<StatusBar title="EP" color="bg-violet-500" showText status="AWAKE" regen={20} lastRegenAt={regenAt} current={current} total={2600} />);
    expect(view.getByText("EP (2600 / 2600)")).toBeTruthy();
  });

  it("keeps elapsed regeneration when capacity changes", () => {
    const regenAt = new Date(Date.now() - 120_000);
    const view = render(<StatusBar title="EP" color="bg-violet-500" showText status="AWAKE" regen={200} lastRegenAt={regenAt} current={2000} total={2800} />);
    expect(view.getByText("EP (2400 / 2800) (60s)")).toBeTruthy();
    view.rerender(<StatusBar title="EP" color="bg-violet-500" showText status="AWAKE" regen={200} lastRegenAt={regenAt} current={2000} total={3000} />);
    expect(view.getByText("EP (2400 / 3000) (60s)")).toBeTruthy();
  });
});
