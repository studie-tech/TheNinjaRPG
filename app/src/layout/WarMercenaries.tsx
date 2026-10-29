"use client";
import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput, validateNumberInputs } from "@/components/ui/number-input";
import {
  WAR_MERCENARY_LIMIT,
  WAR_MERCENARY_MAX_TOKENS,
  WAR_MERCENARY_RYO_PER_TOKEN,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { useRequiredUserData } from "@/utils/UserContext";
import type { UserSearchResult } from "@/validators/register";
import type { UserDeltaResponse } from "@/validators/userCache";

/** Private hiring controls: identities are returned only to the employing Kage and the player. */
export const WarMercenaries = ({ warId }: { warId: string }) => {
  const [tokens, setTokens] = useState(1);
  const controlsRef = useRef<HTMLDetailsElement>(null);
  const { feedback, refresh, onError, onMutate } = useMercenaryFeedback();
  const roster = api.war.getMercenaries.useQuery({ warId }, { refetchInterval: 10000 });
  const form = useForm<{ username: string; users: UserSearchResult[] }>({
    defaultValues: { username: "", users: [] },
  });
  const selected = useWatch({ control: form.control, name: "users" })?.[0];
  const invite = api.war.inviteMercenary.useMutation({
    onSuccess: refresh,
    onError,
    onMutate,
  });
  const leave = api.war.leaveMercenary.useMutation({
    onSuccess: refresh,
    onError,
    onMutate,
  });
  const busy = invite.isPending || leave.isPending;
  return (
    <details
      ref={controlsRef}
      className="space-y-3 rounded-lg border bg-popover p-3"
      aria-label="War mercenaries"
    >
      <summary className="cursor-pointer font-semibold">
        Mercenaries · {roster.data?.roster.length ?? 0}/{WAR_MERCENARY_LIMIT}
      </summary>
      <p className="text-muted-foreground text-sm">
        Contracts last for this war. Mercenaries fight anonymously, can run war
        missions, and use ANBU war damage and recovery values. Either party can end a
        contract at any time. Payments are not refunded.
      </p>
      {roster.isPending && <p role="status">Loading mercenaries...</p>}
      {roster.error && (
        <Alert variant="destructive">
          <AlertDescription>
            Unable to load mercenaries.{" "}
            <Button variant="outline" onClick={() => void roster.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {roster.data?.roster.map((entry) => (
        <div
          key={entry.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
        >
          <div>
            <p className="font-medium">
              {entry.user.username} ·{" "}
              {entry.acceptedAt ? "Serving" : "Invitation pending"}
            </p>
            <p className="text-sm">
              {entry.tokens.toLocaleString()} tokens →{" "}
              {(entry.tokens * WAR_MERCENARY_RYO_PER_TOKEN).toLocaleString()} Ryo
            </p>
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => leave.mutate({ contractId: entry.id })}
          >
            {roster.data.canHire
              ? entry.acceptedAt
                ? "Dismiss"
                : "Cancel invitation"
              : "Resign"}
          </Button>
        </div>
      ))}
      {roster.data?.canHire && roster.data.roster.length < WAR_MERCENARY_LIMIT && (
        <div className="space-y-3">
          <UserSearchSelect
            useFormMethods={form}
            label="Choose mercenary"
            showYourself={false}
            showAi={false}
            inline
            maxUsers={1}
          />
          <div className="space-y-1">
            <Label htmlFor={`mercenary-tokens-${warId}`}>Village token payment</Label>
            <NumberInput
              id={`mercenary-tokens-${warId}`}
              min={1}
              max={WAR_MERCENARY_MAX_TOKENS}
              step={1}
              value={tokens}
              onValueChange={setTokens}
            />
          </div>
          <p className="text-sm">
            1 token = {WAR_MERCENARY_RYO_PER_TOKEN.toLocaleString()} Ryo. The player
            receives{" "}
            <strong>
              {Number.isFinite(tokens)
                ? (tokens * WAR_MERCENARY_RYO_PER_TOKEN).toLocaleString()
                : "—"}{" "}
              Ryo
            </strong>{" "}
            when they accept. Pending invitations reserve a slot; tokens are charged on
            acceptance.
          </p>
          <Button
            disabled={busy || !selected || !Number.isInteger(tokens) || tokens < 1}
            onClick={() =>
              selected &&
              validateNumberInputs(controlsRef.current) &&
              invite.mutate({ warId, userId: selected.userId, tokens })
            }
          >
            {invite.isPending ? "Inviting..." : "Invite mercenary"}
          </Button>
        </div>
      )}
      {feedback && (
        <Alert
          variant={feedback.success ? "default" : "destructive"}
          role={feedback.success ? "status" : "alert"}
        >
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      )}
    </details>
  );
};

/** Invitations and the player's active contract remain accessible from the dashboard. */
export const MercenaryOffers = () => {
  const offers = api.war.getMercenaryOffers.useQuery(undefined, {
    // Invitations can come from another village, including while our own is at peace.
    refetchInterval: 60000,
  });
  const { feedback, refresh, onError, onMutate } = useMercenaryFeedback();
  const accept = api.war.acceptMercenary.useMutation({
    onSuccess: refresh,
    onError,
    onMutate,
  });
  const leave = api.war.leaveMercenary.useMutation({
    onSuccess: refresh,
    onError,
    onMutate,
  });
  const busy = accept.isPending || leave.isPending;
  if (!offers.data?.length && !offers.error && !feedback) return null;
  return (
    <div className="mb-4">
      <ContentBox title="Mercenary contracts" alreadyHasH1>
        <div className="space-y-3">
          {offers.error && (
            <Alert variant="destructive">
              <AlertDescription>
                Unable to load contracts.{" "}
                <Button variant="outline" onClick={() => void offers.refetch()}>
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {offers.data?.map((offer) => (
            <div key={offer.id} className="space-y-3 rounded-lg border bg-popover p-3">
              <h3 className="font-semibold">
                {offer.village.name} ·{" "}
                {offer.acceptedAt ? "Serving as a mercenary" : "Mercenary invitation"}
              </h3>
              <p className="text-sm">
                {offer.war.attackerVillage.name} vs {offer.war.defenderVillage.name}
              </p>
              <p className="text-sm">
                {offer.tokens.toLocaleString()} tokens →{" "}
                <strong>
                  {(offer.tokens * WAR_MERCENARY_RYO_PER_TOKEN).toLocaleString()} Ryo
                </strong>
                . 1 token = {WAR_MERCENARY_RYO_PER_TOKEN.toLocaleString()} Ryo.
              </p>
              <p className="text-muted-foreground text-sm">
                Serve anonymously in this war only, with ANBU war damage and recovery.
                Camps, shrines, espionage and sabotage are available. You or the Kage
                may end the contract at any time; payment is final.
              </p>
              <div className="flex flex-wrap gap-2">
                {!offer.acceptedAt && (
                  <Button
                    disabled={busy}
                    onClick={() => accept.mutate({ contractId: offer.id })}
                  >
                    {accept.isPending ? "Accepting..." : "Accept contract"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => leave.mutate({ contractId: offer.id })}
                >
                  {offer.acceptedAt ? "Resign" : "Decline"}
                </Button>
                {offer.acceptedAt && (
                  <Button variant="outline" asChild>
                    <Link href="/travel">Go to war activities</Link>
                  </Button>
                )}
              </div>
            </div>
          ))}
          {feedback && (
            <Alert
              variant={feedback.success ? "default" : "destructive"}
              role={feedback.success ? "status" : "alert"}
            >
              <AlertDescription>{feedback.message}</AlertDescription>
            </Alert>
          )}
        </div>
      </ContentBox>
    </div>
  );
};

/** Show local mutation feedback and refresh dependent contracts, allegiance and activity. */
const useMercenaryFeedback = () => {
  const [feedback, setFeedback] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const utils = api.useUtils();
  const { updateUser, prepareUserUpdate } = useRequiredUserData();
  const refresh = async (
    result: UserDeltaResponse,
    _variables: unknown,
    revision: number | undefined,
  ) => {
    if (result.success || result.userPatch)
      await updateUser(result.userPatch, {
        revision,
        ...(result.userDelta ? { delta: result.userDelta } : {}),
      });
    setFeedback(result);
    void Promise.all([
      utils.war.getMercenaries.invalidate(),
      utils.war.getMercenaryOffers.invalidate(),
      utils.war.getActiveWars.invalidate(),
      utils.war.getObjectiveWarInfo.invalidate(),
      utils.war.getWarCampNotices.invalidate(),
      utils.travel.getSectorData.invalidate(),
    ]);
  };
  return {
    feedback,
    onMutate: prepareUserUpdate,
    refresh,
    onError: (error: { message: string }) =>
      setFeedback({ success: false, message: error.message }),
  };
};
