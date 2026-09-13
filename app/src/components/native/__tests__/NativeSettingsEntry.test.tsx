import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ native: true, signedIn: true }));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ isSignedIn: state.signedIn }) }));
vi.mock("@/hooks/useNativeShell", () => ({ useNativeShell: () => state.native }));
vi.mock("next/link", () => ({
  default: ({
    href,
    onClick,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NativeSettingsEntry } from "../NativeSettingsEntry";

const SettingsOverlay = () => {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger>Settings</PopoverTrigger>
      <PopoverContent>
        <NativeSettingsEntry onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  state.native = true;
  state.signedIn = true;
  vi.stubGlobal("React", React);
});
describe("native settings navigation", () => {
  it.each(["App settings", "Delete account"])(
    "dismisses the settings overlay when opening %s",
    async (name) => {
      render(<SettingsOverlay />);
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
      fireEvent.click(await screen.findByRole("link", { name }));
      await waitFor(() => expect(screen.queryByRole("link", { name })).toBeNull());
      expect(
        screen.getByRole("button", { name: "Settings" }).getAttribute("aria-expanded"),
      ).toBe("false");
    },
  );
  it("does not expose native account controls on the website or signed out", () => {
    state.native = false;
    const view = render(<NativeSettingsEntry />);
    expect(screen.queryByRole("link")).toBeNull();
    state.native = true;
    state.signedIn = false;
    view.rerender(<NativeSettingsEntry />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
