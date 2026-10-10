import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as storage from "@/hooks/localstorage";
import NavTabs from "@/layout/NavTabs";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ensureDom } from "../setup-dom.mjs";

const animationFrameDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "requestAnimationFrame",
);
const cancelAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "cancelAnimationFrame",
);
beforeEach(() => {
  ensureDom();
  Object.defineProperties(globalThis, {
    requestAnimationFrame: {
      configurable: true,
      value: (callback: FrameRequestCallback) =>
        Number(setTimeout(() => callback(Date.now()), 0)),
    },
    cancelAnimationFrame: {
      configurable: true,
      value: (id: number) => clearTimeout(id),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (animationFrameDescriptor)
    Object.defineProperty(
      globalThis,
      "requestAnimationFrame",
      animationFrameDescriptor,
    );
  else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
  if (cancelAnimationFrameDescriptor)
    Object.defineProperty(
      globalThis,
      "cancelAnimationFrame",
      cancelAnimationFrameDescriptor,
    );
  else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
});
const options = ["Dashboard", "Character", "Achievements"];

describe("optional tab remembering", () => {
  it("ignores a saved tab and does not write clicks when remembering is off", () => {
    const read = vi
      .spyOn(storage, "safeLocalStorageGetItem")
      .mockReturnValue("Character");
    const write = vi.spyOn(storage, "safeLocalStorageSetItem").mockReturnValue(true);
    const onChange = vi.fn();
    const view = render(
      <NavTabs
        id="profileTab:user"
        current={null}
        options={options}
        remember={false}
        onChange={onChange}
      />,
    );
    expect(onChange).toHaveBeenCalledWith("Dashboard");
    expect(view.queryByRole("tablist")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Character" }));
    expect(onChange).toHaveBeenLastCalledWith("Character");
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
  it("restores and saves tabs when opted in", () => {
    vi.spyOn(storage, "safeLocalStorageGetItem").mockReturnValue("Character");
    const write = vi.spyOn(storage, "safeLocalStorageSetItem").mockReturnValue(true);
    const onChange = vi.fn();
    const view = render(
      <NavTabs
        id="profileTab:user"
        current={null}
        options={options}
        remember
        onChange={onChange}
      />,
    );
    expect(onChange).toHaveBeenCalledWith("Character");
    fireEvent.click(view.getByRole("button", { name: "Achievements" }));
    expect(write).toHaveBeenLastCalledWith("profileTab:user", "Achievements");
  });
  it("falls back to the first visible tab for obsolete or tutorial-hidden saved tabs", () => {
    vi.spyOn(storage, "safeLocalStorageGetItem").mockReturnValue("Dashboard");
    vi.spyOn(storage, "safeLocalStorageSetItem").mockReturnValue(true);
    const onChange = vi.fn();
    render(
      <NavTabs
        id="profileTab:user"
        current={null}
        options={["Character", "Achievements"]}
        remember
        onChange={onChange}
      />,
    );
    expect(onChange).toHaveBeenCalledWith("Character");
  });
  it("reopens the tab a saved tab was merged into", () => {
    vi.spyOn(storage, "safeLocalStorageGetItem").mockReturnValue("Sensei");
    const write = vi.spyOn(storage, "safeLocalStorageSetItem").mockReturnValue(true);
    const onChange = vi.fn();
    render(
      <NavTabs
        id="trainingTab:user"
        current={null}
        options={["Stats", "Covert & Sensei"]}
        aliases={{ Covert: "Covert & Sensei", Sensei: "Covert & Sensei" }}
        onChange={onChange}
      />,
    );
    expect(onChange).toHaveBeenCalledWith("Covert & Sensei");
    expect(write).toHaveBeenCalledWith("trainingTab:user", "Covert & Sensei");
  });
});

const trainingTabKey = "trainingTab:user";

/** Mirrors the training grounds wiring: a remembered section that tutorial steps may override. */
const AccessibleTrainingTabs = ({ forcedSection }: { forcedSection?: string }) => {
  const [section, setSection] = useState<string | null>(null);
  const activeSection = forcedSection ?? section;
  const selectSection = (value: string) => {
    storage.safeLocalStorageSetItem(trainingTabKey, value);
    setSection(value);
  };
  return (
    <Tabs value={activeSection ?? ""} onValueChange={selectSection}>
      <NavTabs
        id={trainingTabKey}
        accessibleTabs
        label="Training activities"
        current={activeSection}
        onChange={setSection}
        options={["Stats", "Masteries", "Jutsu"]}
        icons={{ Stats: <span aria-hidden="true">★</span> }}
        className="whitespace-nowrap"
      />
      <TabsContent value={activeSection ?? ""}>{activeSection} training</TabsContent>
    </Tabs>
  );
};

describe("accessible training tabs", () => {
  let read: ReturnType<typeof vi.spyOn>;
  let write: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    read = vi.spyOn(storage, "safeLocalStorageGetItem").mockReturnValue(null);
    write = vi.spyOn(storage, "safeLocalStorageSetItem").mockReturnValue(true);
  });

  it("reopens the last visited section", async () => {
    read.mockReturnValue("Masteries");
    const view = render(<AccessibleTrainingTabs />);
    await waitFor(() =>
      expect(
        view.getByRole("tab", { name: "Masteries" }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
    expect(view.getByRole("tabpanel", { name: "Masteries" }).textContent).toBe(
      "Masteries training",
    );
    expect(read).toHaveBeenCalledWith(trainingTabKey);
  });

  it("remembers sections chosen by pointer or keyboard", async () => {
    const view = render(<AccessibleTrainingTabs />);
    fireEvent.mouseDown(view.getByRole("tab", { name: "Jutsu" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(write).toHaveBeenLastCalledWith(trainingTabKey, "Jutsu");
    const jutsu = view.getByRole("tab", { name: "Jutsu" });
    jutsu.focus();
    fireEvent.keyDown(jutsu, { key: "Home" });
    await waitFor(() => expect(write).toHaveBeenLastCalledWith(trainingTabKey, "Stats"));
  });

  it("does not overwrite the remembered section while a tutorial forces one", () => {
    render(<AccessibleTrainingTabs forcedSection="Jutsu" />);
    expect(write).not.toHaveBeenCalled();
  });

  it("announces selection and associates the panel with its tab", () => {
    const view = render(<AccessibleTrainingTabs />);
    const tab = view.getByRole("tab", { name: "Stats" });
    const panel = view.getByRole("tabpanel", { name: "Stats" });
    expect(view.getByRole("tablist", { name: "Training activities" })).toBeTruthy();
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    expect(tab.closest("li")?.id).toBe("tutorial-Stats");
    expect(tab.className).toContain("whitespace-nowrap");
    fireEvent.mouseDown(view.getByRole("tab", { name: "Jutsu" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(view.getByRole("tabpanel", { name: "Jutsu" }).textContent).toBe(
      "Jutsu training",
    );
    expect(view.getByRole("tab", { name: "Jutsu" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("moves focus and selection with arrows, Home and End", async () => {
    const view = render(<AccessibleTrainingTabs />);
    const stats = view.getByRole("tab", { name: "Stats" });
    stats.focus();
    fireEvent.keyDown(stats, { key: "ArrowRight" });
    await waitFor(() =>
      expect(
        view.getByRole("tab", { name: "Masteries" }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
    expect(document.activeElement).toBe(view.getByRole("tab", { name: "Masteries" }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    await waitFor(() =>
      expect(
        view.getByRole("tab", { name: "Jutsu" }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    await waitFor(() => expect(stats.getAttribute("aria-selected")).toBe("true"));
    expect(document.activeElement).toBe(stats);
  });

  it("keeps tutorial-selected content and announcements in sync", () => {
    const view = render(<AccessibleTrainingTabs forcedSection="Jutsu" />);
    expect(view.getByRole("tab", { name: "Jutsu" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(view.getByRole("tabpanel", { name: "Jutsu" })).toBeTruthy();
    view.rerender(<AccessibleTrainingTabs forcedSection="Stats" />);
    expect(view.getByRole("tabpanel", { name: "Stats" })).toBeTruthy();
    expect(view.getByRole("tab", { name: "Jutsu" }).getAttribute("aria-selected")).toBe(
      "false",
    );
  });
});
