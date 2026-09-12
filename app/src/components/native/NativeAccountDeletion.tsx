"use client";

import { useClerk, useReverification, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useNativeShell } from "@/hooks/useNativeShell";
import ContentBox from "@/layout/ContentBox";
import { appleAuth } from "@/libs/native";
import { ACCOUNT_DELETION_CONFIRMATION } from "@/validators/accountDeletion";

export const NativeAccountDeletion = () => {
  const native = useNativeShell();
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const [confirmationOwner, setConfirmationOwner] = useState<string>();
  const [confirmation, setConfirmation] = useState("");
  const [permanent, setPermanent] = useState(false);
  const [subscriptions, setSubscriptions] = useState(false);
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const submitVerified = useReverification((body: string) =>
    fetch("/api/native/account-deletion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).then(
      (response) =>
        response.json() as Promise<{
          success?: boolean;
          message?: string;
          clerk_error?: unknown;
        }>,
    ),
  );

  const submit = async () => {
    if (!user || submitting.current) return;
    if (user.id !== confirmationOwner) {
      setError("Your signed-in account changed. Close this dialog and start again.");
      return;
    }
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const appleAccount = user.externalAccounts.some(
        (account) => account.provider === "apple",
      );
      const appleAuthorizationCode =
        appleAccount && appleAuth.isSupported()
          ? (await appleAuth.authorize()).authorizationCode
          : undefined;
      const result = await submitVerified(
        JSON.stringify({
          expectedUserId: user.id,
          appleAuthorizationCode,
          confirmation,
          understandsPermanentLoss: permanent,
          understandsSubscriptions: subscriptions,
        }),
      );
      if (!result) return; // Dismissing Clerk verification never confirms deletion.
      if (!result.success)
        throw new Error(
          result.message ?? "Unable to request deletion. Please try again.",
        );
      setAccepted(true);
      setOpen(false);
      // NativeBridge observes sign-out and clears widgets, push binding, purchases and
      // Live Activities in its existing ordered cleanup, including queued widget writes.
      await signOut().catch(() =>
        setError(
          "Your request is saved. Please close the app; automatic sign-out will follow when processing begins.",
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to request deletion. Please try again.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  if (!native || !isLoaded) return null;
  if (accepted)
    return (
      <ContentBox title="Deletion requested" subtitle="Your request has been saved">
        <p>
          Your account is scheduled for permanent deletion. Sign-in access and game data
          are removed in the background. Do not create a replacement account until
          processing finishes.
        </p>
        <p className="mt-3">
          Remember to cancel any recurring subscriptions with Apple, Google Play or
          PayPal. Account deletion does not automatically cancel billing.
        </p>
        {error && (
          <p role="alert" className="mt-3">
            {error}
          </p>
        )}
      </ContentBox>
    );
  if (!user)
    return (
      <ContentBox title="Delete account" subtitle="Sign-in required">
        <Link href="/login">Sign in to verify ownership of your account.</Link>
      </ContentBox>
    );
  return (
    <ContentBox
      title="Delete account permanently"
      subtitle="This affects your account on every device, including the website"
    >
      <p>
        This permanently removes your login account, character, progress, items and
        personal game content. You cannot undo this or recover the deleted character.
      </p>
      <p className="mt-3">
        Purchase records needed to prevent duplicate rewards and meet legal obligations
        may be retained. Backups and third-party retention follow our privacy policy.
      </p>
      <p className="mt-3">
        Cancel recurring subscriptions before continuing. Deleting your account does not
        cancel them or request a refund.
      </p>
      <div className="my-4 flex flex-col gap-2 underline">
        <a
          href="https://apps.apple.com/account/subscriptions"
          target="_blank"
          rel="noreferrer"
        >
          Manage Apple subscriptions
        </a>
        <a
          href="https://play.google.com/store/account/subscriptions"
          target="_blank"
          rel="noreferrer"
        >
          Manage Google Play subscriptions
        </a>
        <a
          href="https://www.paypal.com/myaccount/autopay/"
          target="_blank"
          rel="noreferrer"
        >
          Manage PayPal automatic payments
        </a>
      </div>
      <p>
        Account:{" "}
        <strong>
          {user.primaryEmailAddress?.emailAddress ?? user.username ?? user.id}
        </strong>
      </p>
      <div className="mt-4 flex gap-3">
        <Button variant="outline" asChild>
          <Link href="/">Keep my account</Link>
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            setOpen(true);
            setConfirmationOwner(user.id);
            setError("");
          }}
        >
          Continue to permanent deletion
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) {
            setOpen(value);
            if (!value) {
              setConfirmation("");
              setPermanent(false);
              setSubscriptions(false);
            }
          }
        }}
      >
        <DialogContent
          closeDisabled={pending}
          className="max-h-[90dvh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Final confirmation: delete your entire account?</DialogTitle>
            <DialogDescription>
              This deletes your account across iPhone, Android and the website. It is
              not a character restart.
            </DialogDescription>
          </DialogHeader>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={permanent}
              disabled={pending}
              onChange={(event) => setPermanent(event.target.checked)}
            />
            I understand that my account and progress cannot be recovered.
          </label>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={subscriptions}
              disabled={pending}
              onChange={(event) => setSubscriptions(event.target.checked)}
            />
            I understand that recurring subscriptions must be cancelled separately.
          </label>
          <label htmlFor="delete-confirmation">
            Type <strong>{ACCOUNT_DELETION_CONFIRMATION}</strong> to confirm.
          </label>
          <Input
            id="delete-confirmation"
            autoComplete="off"
            value={confirmation}
            disabled={pending}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <p className="text-sm">
            You may be asked to verify your identity again using your account’s email
            code, password or two-factor method. Cancelling verification keeps your
            account.
          </p>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setConfirmation("");
                setPermanent(false);
                setSubscriptions(false);
              }}
            >
              Keep my account
            </Button>
            <Button
              variant="destructive"
              disabled={
                pending ||
                !permanent ||
                !subscriptions ||
                confirmationOwner !== user.id ||
                confirmation !== ACCOUNT_DELETION_CONFIRMATION
              }
              onClick={() => void submit()}
            >
              {pending
                ? "Verifying and saving…"
                : "Verify and permanently delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ContentBox>
  );
};
