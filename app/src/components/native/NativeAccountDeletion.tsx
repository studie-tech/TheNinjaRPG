"use client";

import { useClerk, useReverification, useUser } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { AlertTriangle, CreditCard, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  NativeExternalLink,
  NativeFeatureCard,
} from "@/components/native/NativeFeatureCard";
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
import Link from "@/layout/Link";
import { STORE_SUBSCRIPTION_URLS } from "@/libs/legalLinks";
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
  const requestDeletion = api.accountDeletion.request.useMutation();
  const submitVerified = useReverification(requestDeletion.mutateAsync);
  const canSubmit =
    !!user &&
    user.id === confirmationOwner &&
    permanent &&
    subscriptions &&
    confirmation.trim() === ACCOUNT_DELETION_CONFIRMATION;

  const resetConfirmation = () => {
    setConfirmation("");
    setPermanent(false);
    setSubscriptions(false);
  };

  useEffect(() => {
    // The shared game frame can preserve scroll past the deletion warnings.
    if (native && isLoaded && user?.id) {
      document.getElementById("account-deletion")?.scrollIntoView({ block: "start" });
    }
  }, [native, isLoaded, user?.id]);

  const submit = async () => {
    if (!user || !canSubmit || submitting.current) return;
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
      const result = await submitVerified({
        expectedUserId: user.id,
        appleAuthorizationCode,
        confirmation: ACCOUNT_DELETION_CONFIRMATION,
        understandsPermanentLoss: permanent,
        understandsSubscriptions: subscriptions,
      });
      if (!result) return; // Dismissing Clerk verification never confirms deletion.
      if (!result.success) {
        setError(result.message || "Unable to request deletion. Please try again.");
        return;
      }
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
        cause && isReverificationCancelledError(cause)
          ? "Verification cancelled. Your account has not been deleted."
          : cause instanceof Error
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
        <p className="mb-4">Sign in to verify ownership of your account.</p>
        <Button asChild className="min-h-[44px]">
          <Link href="/login">Sign in</Link>
        </Button>
      </ContentBox>
    );
  return (
    <ContentBox
      id="account-deletion"
      title="Delete account permanently"
      subtitle="Applies to the app and website"
    >
      <div className="space-y-4 [&_p]:text-pretty">
        <NativeFeatureCard
          title="Before you leave"
          icon={AlertTriangle}
          description="Permanent deletion cannot be undone."
        >
          <p className="text-[14px] leading-relaxed">
            This permanently removes your login account, character, progress, items and
            personal game content. You cannot recover the deleted character.
          </p>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            Purchase records needed to prevent duplicate rewards and meet legal
            obligations may be retained. If the account has an active ban or silence, a
            minimal record (the account identifier, hashed sign-in identifiers, the
            sanction type, its end date and a reference to the moderation case) is kept
            until the sanction ends, so a new account serves the remaining time. Backups
            and third-party retention follow our privacy policy.
          </p>
        </NativeFeatureCard>
        <NativeFeatureCard
          title="Check your subscriptions"
          icon={CreditCard}
          description="Account deletion does not cancel billing or request a refund."
        >
          <p className="text-[14px]">Cancel subscriptions where you bought them.</p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-2">
            <NativeExternalLink href={STORE_SUBSCRIPTION_URLS.ios}>
              Apple subscriptions
            </NativeExternalLink>
            <NativeExternalLink href={STORE_SUBSCRIPTION_URLS.android}>
              Google Play subscriptions
            </NativeExternalLink>
            <NativeExternalLink href="https://www.paypal.com/myaccount/autopay/">
              PayPal payments
            </NativeExternalLink>
          </div>
        </NativeFeatureCard>
        <NativeFeatureCard
          title="Confirm your account"
          icon={ShieldCheck}
          description="Review, confirm, then verify your identity if asked."
        >
          <p className="break-words rounded-md bg-primary/5 p-3 text-[14px]">
            <span className="block text-[12px] text-muted-foreground">
              Account to delete
            </span>
            <strong>
              {user.primaryEmailAddress?.emailAddress ?? user.username ?? user.id}
            </strong>
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="outline"
              asChild={!pending}
              disabled={pending}
              className="min-h-[44px] flex-1 text-[14px]"
            >
              {pending ? (
                "Keep my account"
              ) : (
                <Link href="/profile">Keep my account</Link>
              )}
            </Button>
            <Button
              variant="destructive"
              className="h-[44px] min-h-[44px] flex-1 whitespace-nowrap text-[14px]"
              disabled={pending}
              onClick={() => {
                setOpen(true);
                setConfirmationOwner(user.id);
                setError("");
              }}
            >
              {pending ? "Verifying…" : "Continue"}
            </Button>
          </div>
        </NativeFeatureCard>
      </div>
      <Dialog
        // Clerk renders verification outside this dialog's focus and pointer trap.
        open={open && !pending}
        onOpenChange={(value) => {
          if (!pending) {
            setOpen(value);
            if (!value) resetConfirmation();
          }
        }}
      >
        <DialogContent
          closeDisabled={pending}
          className="max-h-[85dvh] max-w-[calc(100%-2rem)] overflow-y-auto rounded-lg border-primary/30 md:max-w-lg [&>button]:top-1 [&>button]:right-1 [&>button]:flex [&>button]:size-[44px] [&>button]:items-center [&>button]:justify-center"
        >
          <DialogHeader className="pr-6 text-left">
            <DialogTitle className="text-[18px] leading-snug">
              Final confirmation: delete your entire account?
            </DialogTitle>
            <DialogDescription className="text-[14px] leading-relaxed">
              This deletes your account across iPhone, Android and the website. It is
              not a character restart.
            </DialogDescription>
          </DialogHeader>
          <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border border-primary/20 bg-primary/5 p-3 text-[14px] leading-relaxed">
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-primary"
              checked={permanent}
              disabled={pending}
              onChange={(event) => setPermanent(event.target.checked)}
            />
            I understand that my account and progress cannot be recovered.
          </label>
          <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border border-primary/20 bg-primary/5 p-3 text-[14px] leading-relaxed">
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-primary"
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
            className="h-[44px] min-h-[44px] text-[16px]"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={confirmation}
            disabled={pending}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <p className="text-sm">
            If asked, verify by email code, password or two-factor authentication.
            Cancelling verification keeps your account.
          </p>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="flex-col gap-3 sm:flex-col sm:space-x-0">
            <Button
              variant="outline"
              className="min-h-[44px] w-full text-[14px]"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                resetConfirmation();
              }}
            >
              Keep my account
            </Button>
            <Button
              variant="destructive"
              className="h-[44px] min-h-[44px] w-full whitespace-nowrap text-[14px]"
              disabled={pending || !canSubmit}
              onClick={() => void submit()}
            >
              {pending ? "Verifying…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ContentBox>
  );
};
