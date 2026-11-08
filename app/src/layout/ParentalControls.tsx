"use client";

import { useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  PARENTAL_MAX_APPROVED_PLAYERS,
  PARENTAL_PIN_MAX_ATTEMPTS,
  PARENTAL_PIN_WINDOW_MINUTES,
} from "@/drizzle/constants";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { QueryError } from "@/layout/QueryError";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { showMutationToast } from "@/libs/toast";
import { useUserPicker } from "@/utils/search";
import { parentalSettingsSchema } from "@/validators/parentalControls";

/** Loads account settings and resets the form from the saved policy after saving or reloading. */
export function ParentalControls() {
  const [generation, setGeneration] = useState(0);
  const { data, isPending, error, refetch } = api.parentalControls.get.useQuery();
  if (isPending) return <Loader explanation="Loading parental controls" />;
  if (error || !data)
    return (
      <QueryError
        message="Could not load parental controls."
        onRetry={() => void refetch()}
      />
    );
  return (
    <ParentalSettingsForm
      key={`${data.version}-${generation}`}
      settings={data}
      onSaved={async () => {
        await refetch();
        // Reload must also discard local drafts and PINs when the saved version is unchanged.
        setGeneration((value) => value + 1);
      }}
    />
  );
}

/** Edits a saved policy snapshot with PIN fields held in local component state. */
function ParentalSettingsForm({
  settings,
  onSaved,
}: {
  settings: RouterOutputs["parentalControls"]["get"];
  onSaved: () => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [tavernDisabled, setTavernDisabled] = useState(
    settings.hasPin ? settings.tavernDisabled : true,
  );
  const [privateMessages, setPrivateMessages] = useState(
    settings.hasPin ? settings.privateMessages : ("APPROVED" as const),
  );
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [message, setMessage] = useState<{ success: boolean; message: string } | null>(
    null,
  );
  const { methods: searchForm, users } = useUserPicker(
    PARENTAL_MAX_APPROVED_PLAYERS,
    settings.approvedPlayers,
  );
  const utils = api.useUtils();
  const save = api.parentalControls.save.useMutation({
    onSuccess: async (result) => {
      setMessage(result);
      showMutationToast(result);
      setPin("");
      if (result.success) {
        setNewPin("");
        setConfirmPin("");
        await Promise.all([
          onSaved(),
          utils.comments.getUserConversations.invalidate(),
          utils.comments.getTavernIds.invalidate(),
          utils.comments.getConversationComments.invalidate(),
        ]);
      }
    },
    onError: () =>
      setMessage({
        success: false,
        message: "Could not save parental controls. Please try again.",
      }),
  });
  const creatingPin = !settings.hasPin && enabled;
  const changingPin = settings.hasPin && enabled && newPin !== "";
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (save.isPending) return;
    if ((creatingPin || changingPin) && confirmPin !== (creatingPin ? pin : newPin)) {
      setMessage({ success: false, message: "The PINs do not match." });
      return;
    }
    const parsed = parentalSettingsSchema.safeParse({
      enabled,
      tavernDisabled,
      privateMessages,
      approvedUserIds: users.map((u) => u.userId),
      pin,
      newPin: changingPin ? newPin : undefined,
      version: settings.version,
    });
    if (!parsed.success) {
      setMessage({
        success: false,
        message: parsed.error.issues[0]?.message ?? "Check your settings",
      });
      return;
    }
    save.mutate(parsed.data);
  };
  return (
    <form onSubmit={submit} className="space-y-5 p-3" aria-busy={save.isPending}>
      <p className="text-sm">
        Set up these controls together on the child's account. Changes, including
        turning controls off, require the parent PIN. Keep it private.
      </p>
      <p className="text-muted-foreground text-sm">
        These controls cover taverns and private conversations, including raid chat.
        Forums, profiles and other player-created content remain visible. Support
        tickets remain available.
      </p>
      <fieldset disabled={save.isPending} className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="parental-enabled">Enable parental controls</Label>
          <Switch
            id="parental-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>
        {enabled && (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="parental-tavern">Disable tavern access</Label>
                <p className="text-muted-foreground text-xs">
                  Hide all taverns and prevent posting or reacting.
                </p>
              </div>
              <Switch
                id="parental-tavern"
                checked={tavernDisabled}
                onCheckedChange={setTavernDisabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="parental-messages">Private messages</Label>
              <Select
                value={privateMessages}
                onValueChange={(value) =>
                  setPrivateMessages(value as typeof privateMessages)
                }
              >
                <SelectTrigger id="parental-messages">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EVERYONE">Everyone</SelectItem>
                  <SelectItem value="APPROVED">Approved players only</SelectItem>
                  <SelectItem value="NONE">No private messages</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Applies to sending, receiving and opening existing conversations. Every
                other player in a group must be approved.
              </p>
            </div>
            {privateMessages === "APPROVED" && (
              <div className="space-y-2">
                <Label>Approved players</Label>
                <UserSearchSelect
                  useFormMethods={searchForm}
                  label="Search players to approve"
                  showYourself={false}
                  showAi={false}
                  maxUsers={PARENTAL_MAX_APPROVED_PLAYERS}
                />
                <p className="text-muted-foreground text-xs">
                  Only approve people you know. An empty list blocks all private
                  messages.
                </p>
              </div>
            )}
          </>
        )}
        {(settings.hasPin || enabled) && (
          <div className="space-y-3 border-t pt-4">
            <PinField
              id="parental-pin"
              label={settings.hasPin ? "Parent PIN" : "Create a parent PIN"}
              value={pin}
              onChange={setPin}
              placeholder="Six digits"
            />
            {settings.hasPin && enabled && (
              <PinField
                id="parental-new-pin"
                label="New PIN (optional)"
                value={newPin}
                onChange={setNewPin}
                placeholder="Leave empty to keep your PIN"
              />
            )}
            {(creatingPin || changingPin) && (
              <PinField
                id="parental-confirm-pin"
                label="Confirm PIN"
                value={confirmPin}
                onChange={setConfirmPin}
              />
            )}
            <p className="text-muted-foreground text-xs">
              {PARENTAL_PIN_MAX_ATTEMPTS} PIN attempts are allowed every{" "}
              {PARENTAL_PIN_WINDOW_MINUTES} minutes. Forgot the PIN?{" "}
              <Link href="/support" className="underline">
                Contact support
              </Link>
              .
            </p>
          </div>
        )}
      </fieldset>
      {message && (
        <p
          role={message.success ? "status" : "alert"}
          className={
            message.success ? "text-green-600 text-sm" : "text-destructive text-sm"
          }
        >
          {message.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={save.isPending || (!settings.hasPin && !enabled)}
        >
          {save.isPending ? "Saving..." : "Save parental controls"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={save.isPending}
          onClick={onSaved}
        >
          Reload saved settings
        </Button>
      </div>
    </form>
  );
}

/** Collect a controlled, masked PIN without enabling browser credential autofill. */
const PinField: React.FC<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}> = ({ id, label, value, onChange, placeholder }) => (
  <div className="space-y-1">
    <Label htmlFor={id}>{label}</Label>
    <Input
      id={id}
      type="password"
      inputMode="numeric"
      autoComplete="off"
      maxLength={6}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  </div>
);
