"use client";

import { useState } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ContentBox from "@/layout/ContentBox";
import { FORM_LABEL_MAP } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { RewardFormWrapper } from "@/layout/RewardEditor";
import { getRewardPreview } from "@/libs/objectives";
import { canManageRewards, isStaffRole } from "@/utils/permissions";
import { useRequiredUserDataSelector } from "@/utils/UserContext";
import {
  RewardNodeValidator,
  RewardPackageValidator,
} from "@/validators/rewardPackages";
import {
  ObjectiveReward,
  type ObjectiveRewardType,
  rewardFields,
} from "@/validators/rewards";

/** Staff catalog browsing and permitted editing through the shared reward form. */
export default function RewardsPage() {
  const { data: user } = useRequiredUserDataSelector((profile) => ({
    role: profile.role,
  }));
  const { data, isPending, isError, refetch } = api.rewardPackages.getCatalog.useQuery(
    undefined,
    { enabled: isStaffRole(user?.role) },
  );
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<"package" | "node" | null>(null);
  const [id, setId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rewards, setRewards] = useState<ObjectiveRewardType[]>([
    ObjectiveReward.parse({}),
  ]);
  const [fields, setFields] = useState<(keyof ObjectiveRewardType)[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{
    type: "package" | "node";
    id: string;
    name: string;
  } | null>(null);
  const utils = api.useUtils();
  /** Close successful edits and refresh the catalog; keep rejected drafts recoverable. */
  const onSuccess = async (result: { success: boolean; message: string }) => {
    setMessage(result.message);
    if (result.success) {
      setEditing(null);
      setDeleting(null);
      await utils.rewardPackages.getCatalog.invalidate();
    }
  };
  /** Show transport failures beside the current action without discarding its draft. */
  const onError = (error: { message: string }) => setMessage(error.message);
  const savePackage = api.rewardPackages.savePackage.useMutation({
    onSuccess,
    onError,
  });
  const saveNode = api.rewardPackages.saveNode.useMutation({ onSuccess, onError });
  const deletePackage = api.rewardPackages.deletePackage.useMutation({
    onSuccess,
    onError,
  });
  const deleteNode = api.rewardPackages.deleteNode.useMutation({ onSuccess, onError });
  const isSaving = savePackage.isPending || saveNode.isPending;
  const canManage = canManageRewards(user?.role ?? "USER");
  /** Reset editor state so a new entry cannot inherit another entry's identity or payload. */
  const startNew = (type: "package" | "node") => {
    setEditing(type);
    setId(undefined);
    setName("");
    setDescription("");
    setFields([]);
    setRewards([ObjectiveReward.parse({})]);
    setMessage(null);
  };
  /** Load a package into the editor, as a new package named after it when copying. */
  const openPackage = (pack: CatalogPackage, asCopy: boolean) => {
    setEditing("package");
    setId(asCopy ? undefined : pack.id);
    setName(asCopy ? `${pack.name} copy` : pack.name);
    setDescription(pack.description);
    setRewards([structuredClone(pack.rewards)]);
    setMessage(null);
  };
  /** Validate the draft before dispatch; server validators own stored normalization and access. */
  const save = () => {
    const parsed =
      editing === "package"
        ? RewardPackageValidator.safeParse({ name, description, rewards: rewards[0] })
        : RewardNodeValidator.safeParse({ name, fields });
    if (!parsed.success) {
      setMessage(parsed.error.issues.map((issue) => issue.message).join(". "));
      return;
    }
    if (editing === "package")
      savePackage.mutate({
        id,
        data: { name, description, rewards: rewards[0] ?? ObjectiveReward.parse({}) },
      });
    else saveNode.mutate({ id, data: { name, fields } });
  };
  if (!user) return <Loader explanation="Loading staff access" />;
  if (!isStaffRole(user.role))
    return (
      <ContentBox title="Rewards">
        <p>Rewards are only available to staff.</p>
      </ContentBox>
    );
  return (
    <ContentBox
      title="Rewards"
      subtitle="Reusable reward packages and custom reward nodes"
      defaultBackHref="/manual"
    >
      {message && (
        <p role="status" className="mb-3 rounded border p-2">
          {message}
        </p>
      )}
      {isError && (
        <p role="alert">
          Could not load rewards. <Button onClick={() => void refetch()}>Retry</Button>
        </p>
      )}
      {isPending && <Loader explanation="Loading rewards" />}
      {editing ? (
        <div className="space-y-3">
          <h2 className="font-bold">
            {id ? "Edit" : "Create"} Reward {editing === "package" ? "Package" : "Node"}
          </h2>
          <label className="block" htmlFor="reward-name">
            Name
            <Input
              id="reward-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={isSaving}
            />
          </label>
          {editing === "package" ? (
            <>
              <label className="block" htmlFor="reward-description">
                Description
                <Textarea
                  id="reward-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={isSaving}
                />
              </label>
              <div className={isSaving ? "pointer-events-none opacity-60" : ""}>
                <RewardFormWrapper
                  idx={0}
                  reward={rewards[0] ?? ObjectiveReward.parse({})}
                  rewards={rewards}
                  setRewards={setRewards}
                  grouped
                />
              </div>
            </>
          ) : (
            <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <legend>Reward fields in this node</legend>
              {(Object.keys(rewardFields) as (keyof ObjectiveRewardType)[]).map(
                (field) => (
                  <label key={field} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={fields.includes(field)}
                      disabled={isSaving}
                      onChange={(event) =>
                        setFields(
                          event.target.checked
                            ? [...fields, field]
                            : fields.filter((value) => value !== field),
                        )
                      }
                    />
                    {FORM_LABEL_MAP[field] ??
                      field.replace("reward_", "").replaceAll("_", " ")}
                  </label>
                ),
              )}
            </fieldset>
          )}
          <div className="flex gap-2">
            <Button onClick={save} disabled={isSaving}>
              {isSaving ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="outline"
              disabled={isSaving}
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {canManage && (
            <div className="flex gap-2">
              <Button onClick={() => startNew("package")}>Create Package</Button>
              <Button variant="outline" onClick={() => startNew("node")}>
                Create Node
              </Button>
            </div>
          )}
          <Input
            aria-label="Search rewards"
            placeholder="Search rewards"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <h2 className="font-bold">Reward Packages</h2>
          {data?.packages
            .filter((pack) => pack.name.toLowerCase().includes(search.toLowerCase()))
            .map((pack) => (
              <div key={pack.id} className="space-y-2 rounded border p-3">
                <h3 className="font-semibold">{pack.name}</h3>
                <p className="text-sm">{pack.description}</p>
                <p className="text-sm">{getRewardPreview(pack.rewards)}</p>
                {canManage && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openPackage(pack, false)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openPackage(pack, true)}
                    >
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setDeleting({ type: "package", id: pack.id, name: pack.name })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            ))}
          {data?.packages.length === 0 && <p>No reward packages yet.</p>}
          <h2 className="font-bold">Custom Reward Nodes</h2>
          <p className="text-muted-foreground text-sm">
            Nodes group existing fields. Existing rewards remain available when a node
            changes or is removed.
          </p>
          {data?.nodes
            .filter((node) => node.name.toLowerCase().includes(search.toLowerCase()))
            .map((node) => (
              <div key={node.id} className="rounded border p-3">
                <h3 className="font-semibold">{node.name}</h3>
                <p className="my-2 text-sm">
                  {node.fields
                    .map((field) => FORM_LABEL_MAP[field] ?? field)
                    .join(", ")}
                </p>
                {canManage && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing("node");
                        setId(node.id);
                        setName(node.name);
                        setFields(node.fields);
                        setMessage(null);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setDeleting({ type: "node", id: node.id, name: node.name })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            ))}
          {data?.nodes.length === 0 && (
            <p>No custom reward nodes yet. Editors include standard reward groups.</p>
          )}
        </div>
      )}
      {deleting && (
        <Modal
          title={`Delete ${deleting.name}?`}
          isOpen
          setIsOpen={(open) => {
            if (!open) setDeleting(null);
          }}
          keepOpenOnAccept
          isLoading={deletePackage.isPending || deleteNode.isPending}
          proceed_label="Delete"
          onAccept={() =>
            (deleting.type === "package" ? deletePackage : deleteNode).mutate({
              id: deleting.id,
            })
          }
        >
          <p>
            Delete this {deleting.type}? Quest reward snapshots keep their contents.
            Packages used by active quests cannot be deleted.
          </p>
        </Modal>
      )}
    </ContentBox>
  );
}

type CatalogPackage = RouterOutputs["rewardPackages"]["getCatalog"]["packages"][number];
