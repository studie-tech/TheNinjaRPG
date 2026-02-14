"use client";

import {
  ChevronDown,
  ChevronUp,
  EyeOff,
  FilePlus,
  Folder,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { nanoid } from "nanoid";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { SkillTreeFolder } from "@/drizzle/schema";
import ContentBox from "@/layout/ContentBox";
import ContentImageSelector from "@/layout/ContentImageSelector";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";

/** Increment used when assigning order to new folders */
const FOLDER_ORDER_INCREMENT = 10;

export default function ManualSkillTreeFolder() {
  const router = useRouter();
  const { data: userData } = useRequiredUserData();
  const utils = api.useUtils();

  // Modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editFolder, setEditFolder] = useState<SkillTreeFolder | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<SkillTreeFolder | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formImage, setFormImage] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formHidden, setFormHidden] = useState(false);

  // Generate a temporary ID for new folders (for image upload)
  const [tempFolderId, setTempFolderId] = useState(() => nanoid());

  // Queries
  const { data: folders, isPending: foldersLoading } =
    api.skillTree.getAllFolders.useQuery(
      { includeHidden: true },
      { enabled: !!userData && canChangeContent(userData.role) },
    );

  const { data: allSkills } = api.skillTree.getAll.useQuery(
    { limit: 500, hidden: undefined },
    { enabled: !!userData && canChangeContent(userData.role) },
  );

  // Mutations
  const { mutate: createFolder, isPending: createLoading } =
    api.skillTree.createFolder.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.skillTree.getAllFolders.invalidate();
          setIsCreateOpen(false);
          resetForm();
        }
      },
    });

  const { mutate: updateFolder, isPending: updateLoading } =
    api.skillTree.updateFolder.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.skillTree.getAllFolders.invalidate();
          setEditFolder(null);
          resetForm();
        }
      },
    });

  const { mutate: deleteFolderMutation, isPending: deleteLoading } =
    api.skillTree.deleteFolder.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.skillTree.getAllFolders.invalidate();
          setDeleteFolder(null);
        }
      },
    });

  const { mutate: reorderFolders, isPending: reorderLoading } =
    api.skillTree.reorderFolders.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.skillTree.getAllFolders.invalidate();
        }
      },
    });

  // Reset form
  const resetForm = () => {
    setFormName("");
    setFormImage("");
    setFormDescription("");
    setFormHidden(false);
  };

  // Load form data when editing
  useEffect(() => {
    if (editFolder) {
      setFormName(editFolder.name);
      setFormImage(editFolder.image);
      setFormDescription(editFolder.description || "");
      setFormHidden(editFolder.hidden);
    }
  }, [editFolder]);

  // Handle create
  const handleCreate = () => {
    createFolder({
      name: formName,
      image: formImage || undefined,
      description: formDescription || undefined,
      hidden: formHidden,
      order: (folders?.length || 0) * FOLDER_ORDER_INCREMENT,
    });
  };

  // Handle update
  const handleUpdate = () => {
    if (!editFolder) return;
    updateFolder({
      id: editFolder.id,
      data: {
        name: formName,
        image: formImage || undefined,
        description: formDescription || undefined,
        hidden: formHidden,
        order: editFolder.order,
      },
    });
  };

  // Handle delete
  const handleDelete = () => {
    if (!deleteFolder) return;
    deleteFolderMutation({ id: deleteFolder.id });
  };

  // Handle reorder
  const handleMoveUp = (index: number) => {
    if (!folders || index === 0) return;
    const newOrders = folders.map((f, i) => ({
      id: f.id,
      order: i === index ? (folders[index - 1]?.order ?? 0) - 1 : f.order,
    }));
    reorderFolders({ folderOrders: newOrders });
  };

  const handleMoveDown = (index: number) => {
    if (!folders || index === folders.length - 1) return;
    const newOrders = folders.map((f, i) => ({
      id: f.id,
      order: i === index ? (folders[index + 1]?.order ?? 0) + 1 : f.order,
    }));
    reorderFolders({ folderOrders: newOrders });
  };

  // Get skill count for a folder
  const getSkillCount = (folderId: string) => {
    return allSkills?.data?.filter((s) => s.folderId === folderId).length || 0;
  };

  // Redirect if not authorized
  useEffect(() => {
    if (userData && !canChangeContent(userData.role)) {
      router.push("/manual");
    }
  }, [userData, router]);

  if (!userData || !canChangeContent(userData.role)) {
    return <Loader explanation="Checking permissions..." />;
  }

  return (
    <>
      <ContentBox
        title="Skill Tree Folders"
        subtitle="Organize skills into categories"
        defaultBackHref="/manual/skillTree"
        topRightContent={
          <Button
            onClick={() => {
              resetForm();
              setTempFolderId(nanoid());
              setIsCreateOpen(true);
            }}
          >
            <FilePlus className="mr-2 h-4 w-4" />
            New Folder
          </Button>
        }
      >
        <p className="mb-4">
          Manage skill tree folders to organize skills into logical categories. Users
          will see skills grouped by folder in the skill tree view.
        </p>

        {foldersLoading && <Loader explanation="Loading..." />}

        {!foldersLoading && folders && (
          <div className="space-y-2">
            {folders.map((folder, index) => (
              <div
                key={folder.id}
                className={`flex items-center gap-4 rounded-lg border p-4 ${folder.hidden ? "bg-muted opacity-60" : "bg-card"}`}
              >
                {/* Folder image */}
                <div className="shrink-0">
                  {folder.image ? (
                    <div className="relative h-12 w-12 overflow-hidden rounded-lg">
                      <Image
                        src={folder.image}
                        alt={folder.name}
                        fill
                        className="object-cover"
                        sizes="48px"
                      />
                    </div>
                  ) : (
                    <Folder className="h-12 w-12 text-muted-foreground" />
                  )}
                </div>

                {/* Folder info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-semibold">{folder.name}</h3>
                    {folder.hidden && (
                      <Badge variant="secondary" className="text-xs">
                        <EyeOff className="mr-1 h-3 w-3" />
                        Hidden
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-muted-foreground text-sm">
                    {folder.description || "No description"}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {getSkillCount(folder.id)} skill(s)
                  </p>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0 || reorderLoading}
                  >
                    {reorderLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ChevronUp className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleMoveDown(index)}
                    disabled={index === folders.length - 1 || reorderLoading}
                  >
                    {reorderLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      resetForm();
                      setEditFolder(folder);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteFolder(folder)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}

            {folders.length === 0 && (
              <div className="py-8 text-center text-muted-foreground">
                No folders created yet. Create one to start organizing skills.
              </div>
            )}
          </div>
        )}
      </ContentBox>

      {/* Create Modal */}
      <Modal2
        title="Create New Folder"
        isOpen={isCreateOpen}
        setIsOpen={setIsCreateOpen}
        proceed_label={createLoading ? "Creating..." : "Create"}
        onAccept={handleCreate}
        onClose={() => {
          setIsCreateOpen(false);
          resetForm();
        }}
      >
        <FolderForm
          folderId={tempFolderId}
          name={formName}
          setName={setFormName}
          image={formImage}
          setImage={setFormImage}
          description={formDescription}
          setDescription={setFormDescription}
          hidden={formHidden}
          setHidden={setFormHidden}
        />
      </Modal2>

      {/* Edit Modal */}
      <Modal2
        title="Edit Folder"
        isOpen={!!editFolder}
        setIsOpen={(open) => {
          if (!open) {
            setEditFolder(null);
            resetForm();
          }
        }}
        proceed_label={updateLoading ? "Saving..." : "Save"}
        onAccept={handleUpdate}
        onClose={() => {
          setEditFolder(null);
          resetForm();
        }}
      >
        <FolderForm
          folderId={editFolder?.id || tempFolderId}
          name={formName}
          setName={setFormName}
          image={formImage}
          setImage={setFormImage}
          description={formDescription}
          setDescription={setFormDescription}
          hidden={formHidden}
          setHidden={setFormHidden}
        />
      </Modal2>

      {/* Delete Confirmation Modal */}
      <Modal2
        title="Delete Folder"
        isOpen={!!deleteFolder}
        setIsOpen={(open) => {
          if (!open) setDeleteFolder(null);
        }}
        proceed_label={deleteLoading ? "Deleting..." : "Delete"}
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onAccept={handleDelete}
        onClose={() => setDeleteFolder(null)}
      >
        <div className="space-y-4">
          <p>
            Are you sure you want to delete the folder{" "}
            <strong>{deleteFolder?.name}</strong>?
          </p>
          {deleteFolder && getSkillCount(deleteFolder.id) > 0 && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3">
              <p className="text-destructive text-sm">
                Warning: This folder contains {getSkillCount(deleteFolder.id)} skill(s).
                You must move or delete these skills before deleting the folder.
              </p>
            </div>
          )}
        </div>
      </Modal2>
    </>
  );
}

// Form Component
interface FolderFormProps {
  folderId: string;
  name: string;
  setName: (name: string) => void;
  image: string;
  setImage: (image: string) => void;
  description: string;
  setDescription: (description: string) => void;
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}

const FolderForm: React.FC<FolderFormProps> = ({
  folderId,
  name,
  setName,
  image,
  setImage,
  description,
  setDescription,
  hidden,
  setHidden,
}) => {
  // Generate image prompt based on folder name and description
  const imagePrompt = `A skill tree folder icon for "${name || "skill category"}". ${description || "A ninja skill category icon."} Style: 32-bit pixel art, square icon, centered composition, suitable for a skill tree folder.`;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Folder name"
        />
      </div>

      <div className="space-y-2">
        <ContentImageSelector
          label="Folder Image"
          imageUrl={image || null}
          id={folderId}
          prompt={imagePrompt}
          allowImageUpload={true}
          type="skillTree"
          onUploadComplete={setImage}
          size="square"
          maxDim={256}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description..."
          rows={3}
        />
      </div>

      <div className="flex items-center space-x-2">
        <Switch id="hidden" checked={hidden} onCheckedChange={setHidden} />
        <Label htmlFor="hidden">Hidden (only visible to admins)</Label>
      </div>
    </div>
  );
};
