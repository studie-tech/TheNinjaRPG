import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as hooks from "@/hooks/useResourceSilos";
import * as contentBox from "@/layout/ContentBox";
import * as countdown from "@/layout/Countdown";
import { ResourceSilo } from "@/layout/ResourceSilo";
import { WarTornRevival } from "@/layout/WarTornRevival";
import * as userContext from "@/utils/UserContext";

type Status = RouterOutputs["resourceSilos"]["getStatus"];
let data: Status;
let claimData: { success: boolean; message: string } | undefined;
let isPending: boolean;
let error: Error | undefined;
let user: { status: string; money: number; warTornRespawn: boolean };
const claim = vi.fn(); const respawn = vi.fn(); const retry = vi.fn();

beforeEach(() => {
  const now = new Date();
  data = { window: { active: true, id: "spawn", start: now, end: now, next: now }, points: 59, claimed: false, configured: true };
  claimData = undefined; isPending = false; error = undefined;
  user = { status: "AWAKE", money: 50000, warTornRespawn: false };
  vi.spyOn(userContext, "useRequiredUserData").mockImplementation(() => ({ data: user, timeDiff: 0 }) as never);
  vi.spyOn(contentBox, "default").mockImplementation(({ title, children }) => <section><h1>{title}</h1>{children}</section>);
  vi.spyOn(countdown, "default").mockReturnValue(<span>1 minute</span>);
  vi.spyOn(hooks, "useResourceSilo").mockImplementation(() => ({ status: { data, isPending: false, isError: !!error, refetch: retry }, claim: { mutate: claim, isPending, data: claimData, error } }) as never);
  vi.spyOn(hooks, "useWarTornRevival").mockImplementation(() => ({ mutate: respawn, isPending, data: claimData, error }) as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("Resource Silo", () => {
  it("requires the threshold and disables an already-claimed spawn", () => {
    const view = render(<ResourceSilo />);
    expect(view.getByRole("button", { name: "Unlock Resource Silo" }).hasAttribute("disabled")).toBe(true);
    data = { ...data, points: 60 }; view.rerender(<ResourceSilo />);
    fireEvent.click(view.getByRole("button", { name: "Unlock Resource Silo" })); expect(claim).toHaveBeenCalledTimes(1);
    data = { ...data, claimed: true }; view.rerender(<ResourceSilo />);
    expect(view.getByRole("button", { name: "Claimed this spawn" }).hasAttribute("disabled")).toBe(true);
  });
  it("keeps failed claims recoverable and shows the server message beside the action", () => {
    data.points = 60; claimData = { success: false, message: "Your character changed" };
    const view = render(<ResourceSilo />);
    expect(view.getByRole("alert").textContent).toBe("Your character changed");
    expect(view.getByRole("button", { name: "Unlock Resource Silo" }).hasAttribute("disabled")).toBe(false);
    isPending = true; view.rerender(<ResourceSilo />);
    expect(view.getByRole("button", { name: "Unlocking…" }).hasAttribute("disabled")).toBe(true);
  });
  it("shows the next UTC spawn when closed and a retry for loading errors", () => {
    data.window.active = false; error = new Error("offline");
    const view = render(<ResourceSilo />);
    expect(view.queryByRole("button", { name: "Unlock Resource Silo" })).toBeNull();
    expect(view.getByText(/Next silo opens/).textContent).toContain("GMT");
    fireEvent.click(view.getByRole("button", { name: "Retry" })); expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("War-Torn revival", () => {
  it("keeps ordinary tutorial hospitalization controls free of a revival offer", () => {
    user.status = "HOSPITALIZED";
    expect(render(<WarTornRevival />).container.textContent).toBe("");
  });
  it("offers village treatment when shrine revival is unaffordable", () => {
    user = { status: "HOSPITALIZED", money: 39999, warTornRespawn: true };
    const view = render(<WarTornRevival />);
    expect(view.getByRole("button", { name: /Revive at Shrine/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Return to Village" })); expect(respawn).toHaveBeenCalledWith({ destination: "village" });
    user.money = 40000; view.rerender(<WarTornRevival />);
    fireEvent.click(view.getByRole("button", { name: /Revive at Shrine/ })); expect(respawn).toHaveBeenCalledWith({ destination: "shrine" });
  });
});
