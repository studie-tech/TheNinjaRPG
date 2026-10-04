import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storage from "@/hooks/localstorage";
import NavTabs from "@/layout/NavTabs";
import { ensureDom } from "../setup-dom.mjs";

beforeEach(() => ensureDom());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const options = ["Dashboard", "Character", "Achievements"];

describe("optional tab remembering", () => {
  it("ignores a saved tab and does not write clicks when remembering is off", () => {
    const read = vi.spyOn(storage, "safeLocalStorageGetItem").mockReturnValue("Character");
    const write = vi.spyOn(storage, "safeLocalStorageSetItem").mockReturnValue(true);
    const onChange = vi.fn();
    const view = render(<NavTabs id="profileTab:user" current={null} options={options} remember={false} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith("Dashboard");
    fireEvent.click(view.getByRole("button", { name: "Character" }));
    expect(onChange).toHaveBeenLastCalledWith("Character");
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
  it("restores and saves tabs when opted in", () => {
    vi.spyOn(storage, "safeLocalStorageGetItem").mockReturnValue("Character");
    const write = vi.spyOn(storage, "safeLocalStorageSetItem").mockReturnValue(true);
    const onChange = vi.fn();
    const view = render(<NavTabs id="profileTab:user" current={null} options={options} remember onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith("Character");
    fireEvent.click(view.getByRole("button", { name: "Achievements" }));
    expect(write).toHaveBeenLastCalledWith("profileTab:user", "Achievements");
  });
  it("falls back to the first visible tab for obsolete or tutorial-hidden saved tabs", () => {
    vi.spyOn(storage, "safeLocalStorageGetItem").mockReturnValue("Dashboard");
    vi.spyOn(storage, "safeLocalStorageSetItem").mockReturnValue(true);
    const onChange = vi.fn();
    render(<NavTabs id="profileTab:user" current={null} options={["Character", "Achievements"]} remember onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith("Character");
  });
});
