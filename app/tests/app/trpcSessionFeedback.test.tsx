import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRPCClientError } from "@trpc/client";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { type ToastT, toast as sonnerToast } from "sonner";
import * as clientModule from "@/app/_trpc/client";
import { toast as uiToast } from "@/components/ui/use-toast";
import * as toast from "@/libs/toast";
import * as sessionModule from "@/libs/trpcSession";
import { actualShowMutationToast } from "../setup/preload";

const notices = () =>
  sonnerToast.getToasts().filter((notice): notice is ToastT => "title" in notice);
const messages = () => notices().map((notice) => notice.description ?? notice.title);

const callbacks = [
  { file: "support/[ticketId]", path: "support.updateTicket" },
  { file: "points", path: "paypal.resolveSubscription", subscription: true },
  { file: "points", path: "paypal.upgradeSubscription", subscription: true },
  { file: "points", path: "paypal.subscribeWithReps", subscription: true },
] as const;

// Run the pages' actual callback expressions.
// Taking them from source makes a bypass in any one callback fail the feedback check.
const pageOnError = (source: (typeof callbacks)[number]) => {
  const file = join(
    import.meta.dirname,
    "../../src/app/[shell]",
    source.file,
    "page.tsx",
  );
  const expression = readFileSync(file, "utf8")
    .split(`api.${source.path}.useMutation`)[1]
    ?.match(/onError:\s*(\(error\) => \{[\s\S]*?\n\s*\}),/)?.[1];
  if (!expression) throw new Error(`${source.path} onError callback was not found`);
  return new Function(
    "toast",
    "onError",
    "getSessionErrorToastId",
    "showMutationToast",
    `return (${expression});`,
  )(
    uiToast,
    clientModule.onError,
    sessionModule.getSessionErrorToastId,
    toast.showMutationToast,
  ) as (error: { message: string }) => void;
};

beforeEach(() => {
  sonnerToast.dismiss();
  vi.spyOn(toast, "showMutationToast").mockImplementation(actualShowMutationToast);
});

afterEach(() => {
  sonnerToast.dismiss();
  vi.restoreAllMocks();
});

for (const source of callbacks) {
  for (const message of [
    sessionModule.SESSION_CHANGED_MESSAGE,
    sessionModule.SESSION_EXPIRED_MESSAGE,
  ]) {
    it.each([true, false])(
      `${source.path} renders ${message} once when shared feedback arrives first=%s`,
      (sharedFirst) => {
        const shared = () => toast.showMutationToast({ success: false, message });
        const local = () =>
          pageOnError(source)(TRPCClientError.from(new Error(message)));
        for (const notify of sharedFirst ? [shared, local] : [local, shared]) notify();
        expect(notices()).toHaveLength(1);
        expect(
          [notices()[0]?.title, notices()[0]?.description].filter(
            (value) => value === message,
          ),
        ).toHaveLength(1);
        // The app's toaster hides titles on mobile; the recovery message must stay visible.
        expect(notices()[0]?.description).toBe(message);
      },
    );
  }

  it(`${source.path} keeps equal ordinary failures separate with their existing presentation`, () => {
    const message = "This action is unavailable.";
    const callback = pageOnError(source);
    const error = TRPCClientError.from({
      error: {
        message,
        code: -32600,
        data: { code: "BAD_REQUEST" },
      },
    });
    for (let i = 0; i < 2; i++) callback(error);
    expect(messages()).toEqual([message, message]);
    expect(notices().map((notice) => notice.title)).toEqual(
      Array(2).fill("subscription" in source ? "BAD_REQUEST" : "Error"),
    );
    expect(notices().every((notice) => notice.type === "error")).toBe(true);
  });
}

it("preserves generic subscription error feedback and ignores unsupported thrown values", () => {
  for (const error of [null, undefined, "failed", { message: "failed" }])
    clientModule.onError(error);
  expect(notices()).toEqual([]);
  for (let i = 0; i < 2; i++) clientModule.onError(new Error("Ordinary failure"));
  expect(messages()).toEqual(["Ordinary failure", "Ordinary failure"]);
  expect(
    notices().every((notice) => notice.title === "Error" && notice.type === "error"),
  ).toBe(true);
});

it.each([sessionModule.SESSION_CHANGED_MESSAGE, sessionModule.SESSION_EXPIRED_MESSAGE])(
  "coalesces generic subscription Errors for %s with shared feedback",
  (message) => {
    clientModule.onError(new Error(message));
    toast.showMutationToast({ success: false, message });
    expect(messages()).toEqual([message]);
  },
);

it("preserves the support callback's empty-message fallback", () => {
  pageOnError(callbacks[0])(new Error(""));
  expect(messages()).toEqual(["Could not update the ticket. Please try again."]);
  expect(notices()[0]?.type).toBe("error");
});
