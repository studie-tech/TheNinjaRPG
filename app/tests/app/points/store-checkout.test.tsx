import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as paypal from "@paypal/react-paypal-js";
import { act, cleanup, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { StoreCheckout } from "@/app/[shell]/points/StoreCheckout";
import * as UserContext from "@/utils/UserContext";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

type ButtonProps = {
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
  onCancel: () => void;
  onError: () => void;
};

let buttons: ButtonProps;
let release: ReturnType<typeof vi.fn>;
let prepare: ReturnType<typeof vi.fn>;
let capture: ReturnType<typeof vi.fn>;
const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

beforeEach(() => {
  installBrowserGlobals();
  process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID = "test";
  release = vi.fn(async () => ({ success: true, message: "Checkout released" }));
  prepare = vi.fn(async () => ({
    success: true,
    message: "Checkout ready",
    orderId: "PAYPALORDER123456",
    checkoutId: "snapshot-1",
  }));
  capture = vi.fn(async () => ({ success: true, message: "Delivered" }));
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      client: { paypal: { releaseStoreOrder: { mutate: release } } },
    }),
    paypal: {
      createStoreOrder: {
        useMutation: () => ({ mutateAsync: prepare, isPending: false }),
      },
      captureStoreOrder: {
        useMutation: () => ({ mutateAsync: capture, isPending: false }),
      },
    },
  });
  vi.spyOn(UserContext, "useRequiredUserInfo").mockReturnValue({
    prepareUserUpdate: vi.fn(),
    updateUser: vi.fn(),
  } as never);
  vi.spyOn(paypal, "usePayPalScriptReducer").mockReturnValue([
    { isResolved: true, isRejected: false },
  ] as never);
  vi.spyOn(paypal, "PayPalButtons").mockImplementation(((props: ButtonProps) => {
    buttons = props;
    return <button type="button">PayPal</button>;
  }) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
  process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID = clientId;
});

const renderCheckout = () => {
  const pending: boolean[] = [];
  const view = render(
    <StoreCheckout
      selection={{ type: "bundle", bundleId: "welcome" }}
      recipientId="buyer"
      onPendingChange={(value) => pending.push(value)}
    />,
  );
  return { view, pending };
};

it("keeps the dialog pending while the PayPal window is open and releases a cancelled checkout", async () => {
  const { view, pending } = renderCheckout();
  await act(async () => {
    expect(await buttons.createOrder()).toBe("PAYPALORDER123456");
  });
  expect(pending.at(-1)).toBe(true);
  expect(view.getByText(/Finish paying in the PayPal window/)).toBeTruthy();
  act(() => buttons.onCancel());
  expect(release).toHaveBeenCalledWith({ checkoutId: "snapshot-1" });
  expect(pending.at(-1)).toBe(false);
  expect(view.getByText(/you can try again right away/)).toBeTruthy();
  // A second cancel or error for the same window does not release again.
  act(() => buttons.onError());
  expect(release).toHaveBeenCalledTimes(1);
});

it("releases an open checkout when the dialog unmounts the buttons", async () => {
  const { view } = renderCheckout();
  await act(async () => {
    await buttons.createOrder();
  });
  view.unmount();
  expect(release).toHaveBeenCalledWith({ checkoutId: "snapshot-1" });
});

it("keeps an approved checkout reserved for capture", async () => {
  const { view, pending } = renderCheckout();
  await act(async () => {
    await buttons.createOrder();
    await buttons.onApprove({ orderID: "PAYPALORDER123456" });
  });
  expect(capture).toHaveBeenCalledWith({ orderId: "PAYPALORDER123456" });
  act(() => buttons.onError());
  view.unmount();
  expect(release).not.toHaveBeenCalled();
  expect(pending.at(-1)).toBe(false);
});

it("clears the pending state when the server refuses the checkout", async () => {
  prepare.mockResolvedValueOnce({ success: false, message: "Limit reached" });
  const { view, pending } = renderCheckout();
  await act(async () => {
    await expect(buttons.createOrder()).rejects.toThrow("Limit reached");
  });
  expect(pending.at(-1)).toBe(false);
  expect(view.getByText("Limit reached")).toBeTruthy();
  view.unmount();
  expect(release).not.toHaveBeenCalled();
});
