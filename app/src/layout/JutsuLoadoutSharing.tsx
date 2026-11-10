"use client";

import type { RefObject } from "react";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { JutsuLoadout } from "@/drizzle/schema";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { modalScrollableBodyClassName, modalViewportClassName } from "@/layout/Modal";
import type { computeJutsuLoadoutPreview } from "@/libs/jutsu";
import { exportJutsuLoadout } from "@/libs/loadout";
import { fedJutsuLoadouts } from "@/utils/paypal";
import { useRequiredUserData } from "@/utils/UserContext";
import { LOADOUT_SHARE_MAX_LENGTH } from "@/validators/loadout";

/** Connect sharing controls to authenticated tRPC and refresh slots/equipment after import. */
export const JutsuLoadoutSharing = (props: SharingControls) => {
  const { data: user, prepareUserUpdate, updateUser } = useRequiredUserData();
  const utils = api.useUtils();
  const loadouts = api.jutsu.getLoadouts.useQuery(undefined, {
    enabled: !!user && fedJutsuLoadouts(user) > 0,
  });
  const preview = api.jutsu.previewJutsuLoadout.useMutation();
  const replace = api.jutsu.importJutsuLoadout.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: (result, _variables, revision) =>
      result.success ? updateUser(result, { revision }) : undefined,
  });

  return props.mode ? (
    <JutsuLoadoutSharingDialog
      {...props}
      loadouts={loadouts.data ?? []}
      activeId={user?.jutsuLoadout ?? null}
      isLoading={loadouts.isPending}
      loadError={loadouts.error?.message}
      onPreview={(input) => preview.mutateAsync(input)}
      onReplace={(input) => replace.mutateAsync(input)}
      onImported={async () => {
        await Promise.all([
          utils.jutsu.getLoadouts.invalidate(),
          utils.jutsu.getUserJutsus.invalidate(),
        ]);
      }}
    />
  ) : null;
};

/** Manage export, editable previews and explicit replacement of one existing loadout. */
export const JutsuLoadoutSharingDialog = (props: SharingProps) => {
  const { mode, onClose, returnFocusRef } = props;
  const [loadoutId, setLoadoutId] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const importFlight = useSingleFlight();
  const isPending = importFlight.isPending;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectedId =
    loadoutId ||
    props.loadouts.find((entry) => entry.id === props.activeId)?.id ||
    props.loadouts[0]?.id ||
    "";
  const selected = props.loadouts.find((entry) => entry.id === selectedId);
  const exportText = selected ? exportJutsuLoadout(selected.jutsuIds) : "";

  /**
   * Preview the draft or confirm its server fingerprint. Keep dismissal blocked
   * through cache refresh; a rejected replacement must be previewed again.
   */
  const runImportAction = async (replace: boolean) => {
    if (importFlight.current() || !selected || (replace && !preview)) return;
    importFlight.claim();
    setError("");
    if (!replace) setPreview(null);
    try {
      const input = { loadoutId: selectedId, text };
      if (replace && preview) {
        const result = await props.onReplace({ ...input, previewToken: preview.token });
        if (!result.success) {
          setError(result.message);
          setPreview(null);
          return;
        }
        await props.onImported();
        onClose();
      } else {
        const result = await props.onPreview(input);
        if (result.success) setPreview(result.preview);
        else setError(result.message);
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to import. Please try again.",
      );
      setPreview(null);
    } finally {
      importFlight.release();
    }
  };

  /** Fall back to selecting the intact payload when clipboard access is unavailable. */
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopyMessage("Copied");
    } catch {
      textareaRef.current?.focus();
      textareaRef.current?.select();
      setCopyMessage("Clipboard unavailable. Select the text and copy it manually.");
    }
  };

  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen && !importFlight.current()) onClose();
      }}
    >
      <DialogContent
        className={modalViewportClassName}
        closeDisabled={isPending}
        onCloseAutoFocus={(event) => {
          // The menu item unmounts on selection; restore focus to the menu button.
          if (returnFocusRef.current?.isConnected) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {mode === "export" ? "Export jutsu loadout" : "Import jutsu loadout"}
          </DialogTitle>
          <DialogDescription>
            {mode === "export"
              ? "Share this text to copy one ordinary jutsu loadout in order."
              : "Only jutsu you own and can equip will be saved. Your destination name is kept. An active destination is equipped immediately."}
          </DialogDescription>
        </DialogHeader>
        <div className={modalScrollableBodyClassName}>
          {props.isLoading && <p role="status">Loading loadouts…</p>}
          {props.loadError && <p role="alert">{props.loadError}</p>}
          <Label htmlFor="sharing-loadout">
            {mode === "export" ? "Loadout" : "Destination loadout"}
          </Label>
          <Select
            value={selectedId}
            disabled={isPending || !props.loadouts.length}
            onValueChange={(id) => {
              setLoadoutId(id);
              setPreview(null);
              setError("");
              setCopyMessage("");
            }}
          >
            <SelectTrigger id="sharing-loadout">
              <SelectValue placeholder="Select loadout" />
            </SelectTrigger>
            <SelectContent>
              {props.loadouts.map((entry, index) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name || `Loadout ${index + 1}`}
                  {entry.id === props.activeId ? " (active)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label htmlFor="sharing-text">Loadout text</Label>
          <Textarea
            id="sharing-text"
            ref={textareaRef}
            rows={5}
            readOnly={mode === "export"}
            disabled={isPending}
            maxLength={LOADOUT_SHARE_MAX_LENGTH}
            value={mode === "export" ? exportText : text}
            onFocus={(event) => {
              if (mode === "export") event.currentTarget.select();
            }}
            onChange={(event) => {
              setText(event.target.value);
              setPreview(null);
              setError("");
            }}
          />
          {mode === "export" && (
            <>
              <Button disabled={!selected} onClick={() => void copy()}>
                Copy
              </Button>
              {copyMessage && <p role="status">{copyMessage}</p>}
            </>
          )}
          {mode === "import" && preview && (
            <div>
              <p>{preview.jutsuIds.length} jutsu ready to import.</p>
              <ol className="list-inside list-decimal space-y-1">
                {preview.entries.map((entry) => (
                  <li key={entry.jutsuId}>
                    <span className="font-semibold">{entry.name}</span>: {entry.message}
                  </li>
                ))}
              </ol>
              {preview.jutsuIds.length === 0 && (
                <p>No usable jutsu. The destination will stay unchanged.</p>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="gap-y-2">
          <Button variant="outline" disabled={isPending} onClick={onClose}>
            Cancel
          </Button>
          {mode === "import" && (
            <>
              <Button
                disabled={isPending || !text.trim() || !selected}
                onClick={() => void runImportAction(false)}
              >
                {isPending ? "Please wait…" : "Preview"}
              </Button>
              <Button
                variant="destructive"
                disabled={isPending || !preview?.jutsuIds.length}
                onClick={() => void runImportAction(true)}
              >
                Replace loadout
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** Server-derived preview plus the fingerprint required to confirm that exact result. */
type ImportPreview = ReturnType<typeof computeJutsuLoadoutPreview> & { token: string };
/** Destination ID plus untrusted pasted share text. */
type ImportInput = { loadoutId: string; text: string };
/** Preview is read-only; successful replacement is followed by an awaited cache refresh. */
type SharingControls = {
  mode: "export" | "import" | null;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
};

type SharingProps = SharingControls & {
  loadouts: Pick<JutsuLoadout, "id" | "name" | "jutsuIds">[];
  activeId: string | null;
  loadError?: string;
  isLoading?: boolean;
  onPreview: (
    input: ImportInput,
  ) => Promise<
    { success: true; preview: ImportPreview } | { success: false; message: string }
  >;
  onReplace: (
    input: ImportInput & { previewToken: string },
  ) => Promise<{ success: boolean; message: string }>;
  onImported: () => Promise<void>;
};
