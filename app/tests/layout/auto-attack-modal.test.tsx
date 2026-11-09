import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AUTO_ATTACK_SETTINGS, readAutoAttackSetting } from "@/hooks/autoAttack";
import AutoAttackModal from "@/layout/AutoAttackModal";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { stubDialog } from "../setup/dialog";

let restoreDialog: () => void;
beforeEach(() => {
  restoreDialog = stubDialog();
});
afterEach(() => {
  restoreDialog();
  restoreBrowserGlobals();
  localStorage.removeItem("autoAttackMinLevel");
  localStorage.removeItem("autoAttackDelay");
});

describe("AutoAttackModal", () => {
  afterEach(cleanup);

  it("keeps invalid auto-attack drafts out of storage and commits before enabling", () => {
    installBrowserGlobals({ events: ["CustomEvent"] });
    localStorage.setItem("autoAttackMinLevel", "1");
    localStorage.setItem("autoAttackDelay", "5");
    const enabled = vi.fn(() => {
      expect(localStorage.getItem("autoAttackMinLevel")).toBe("3");
      expect(localStorage.getItem("autoAttackDelay")).toBe("2");
    });
    const { getByRole } = render(
      <AutoAttackModal isOpen setIsOpen={vi.fn()} onEnable={enabled} />,
    );
    fireEvent.input(getByRole("spinbutton", { name: "Minimum Level to Attack" }), {
      target: { value: "" },
    });
    expect(localStorage.getItem("autoAttackMinLevel")).toBe("1");
    expect(
      (getByRole("button", { name: "Enable Auto Attack" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.input(getByRole("spinbutton", { name: "Minimum Level to Attack" }), {
      target: { value: "3" },
    });
    fireEvent.input(getByRole("spinbutton", { name: "Attack Delay (seconds)" }), {
      target: { value: "2" },
    });
    fireEvent.click(getByRole("button", { name: "Enable Auto Attack" }));
    expect(enabled).toHaveBeenCalledTimes(1);
  });

  it("reads saved auto-attack settings and falls back to their defaults", () => {
    localStorage.removeItem("autoAttackDelay");
    expect(readAutoAttackSetting(AUTO_ATTACK_SETTINGS.delay)).toBe(5);
    localStorage.setItem("autoAttackDelay", "12");
    expect(readAutoAttackSetting(AUTO_ATTACK_SETTINGS.delay)).toBe(12);
  });
});
