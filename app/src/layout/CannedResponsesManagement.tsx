"use client";

import { Copy, Edit2, Loader2, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CannedResponse } from "@/drizzle/schema";
import Confirm from "@/layout/Confirm";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { showMutationToast } from "@/libs/toast";
import { canEditCannedResponses } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

interface CannedResponsesManagementProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onResponsesChange?: () => void;
}

export default function CannedResponsesManagement({
  isOpen,
  setIsOpen,
  onResponsesChange,
}: CannedResponsesManagementProps) {
  const { data: userData } = useUserData();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingResponse, setEditingResponse] = useState<CannedResponse | null>(null);
  const [formData, setFormData] = useState({ title: "", description: "" });
  const [deletingResponseIds, setDeletingResponseIds] = useState<Set<string>>(
    () => new Set(),
  );
  const deletingResponseIdsRef = useRef(new Set<string>());
  const deletedResponseIdsRef = useRef(new Set<string>());
  const utils = api.useUtils();

  const {
    data: cannedResponses,
    isLoading,
    refetch,
  } = api.support.getCannedResponses.useQuery(undefined, {
    enabled: isOpen,
  });

  const createMutation = api.support.createCannedResponse.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      void refetch();
      onResponsesChange?.();
      setIsCreateModalOpen(false);
      setFormData({ title: "", description: "" });
    },
  });

  const updateMutation = api.support.updateCannedResponse.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      void refetch();
      onResponsesChange?.();
      setEditingResponse(null);
      setFormData({ title: "", description: "" });
    },
  });

  const deleteMutation = api.support.deleteCannedResponse.useMutation();

  if (!userData || !canEditCannedResponses(userData.role)) {
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingResponse) {
      updateMutation.mutate({
        id: editingResponse.id,
        title: formData.title,
        description: formData.description,
      });
    } else {
      createMutation.mutate({
        title: formData.title,
        description: formData.description,
      });
    }
  };

  const handleEdit = (response: CannedResponse) => {
    setEditingResponse(response);
    setFormData({ title: response.title, description: response.description });
  };

  const handleDelete = async (id: string) => {
    if (
      deletingResponseIdsRef.current.has(id) ||
      deletedResponseIdsRef.current.has(id)
    ) {
      return;
    }

    deletingResponseIdsRef.current.add(id);
    setDeletingResponseIds(new Set(deletingResponseIdsRef.current));

    try {
      const result = await deleteMutation.mutateAsync({ id });
      showMutationToast(result);
      if (!result.success) return;

      deletedResponseIdsRef.current.add(id);
      utils.support.getCannedResponses.setData(undefined, (responses) =>
        responses?.filter((response) => response.id !== id),
      );
      onResponsesChange?.();
      void refetch().catch(() => undefined);
    } catch {
      toast.error("Failed to delete canned response");
    } finally {
      deletingResponseIdsRef.current.delete(id);
      setDeletingResponseIds(new Set(deletingResponseIdsRef.current));
    }
  };

  const handleCopy = (description: string) => {
    void navigator.clipboard
      .writeText(description)
      .then(() => {
        showMutationToast({
          success: true,
          message: "Canned response copied to clipboard!",
        });
      })
      .catch(() => {
        showMutationToast({ success: false, message: "Failed to copy to clipboard" });
      });
  };

  const closeModal = () => {
    setIsCreateModalOpen(false);
    setEditingResponse(null);
    setFormData({ title: "", description: "" });
  };

  return (
    <>
      <Modal isOpen={isOpen} setIsOpen={setIsOpen} title="Manage Canned Responses">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-gray-600 text-sm">
              Manage pre-written responses for support tickets
            </p>
            <Button onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Response
            </Button>
          </div>

          {isLoading ? (
            <Loader explanation="Loading canned responses..." />
          ) : (
            <div className="max-h-96 space-y-4 overflow-y-auto">
              {cannedResponses?.map((response) => {
                const isDeleting = deletingResponseIds.has(response.id);
                return (
                  <Card key={response.id} className="relative" aria-busy={isDeleting}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{response.title}</CardTitle>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(response.description)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(response)}
                            disabled={isDeleting}
                            aria-label={`Edit ${response.title}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Confirm
                            title={`Delete “${response.title}”?`}
                            button={
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isDeleting}
                                aria-busy={isDeleting}
                                aria-label={
                                  isDeleting
                                    ? `Deleting ${response.title}`
                                    : `Delete ${response.title}`
                                }
                              >
                                {isDeleting ? (
                                  <>
                                    <Loader2
                                      className="mr-2 h-4 w-4 animate-spin"
                                      aria-hidden
                                    />
                                    Deleting
                                  </>
                                ) : (
                                  <Trash2 className="h-4 w-4 text-red-500" />
                                )}
                              </Button>
                            }
                            proceed_label="Delete"
                            proceed_loading_label="Deleting"
                            confirmClassName="bg-red-600 text-white hover:bg-red-700"
                            isLoading={isDeleting}
                            keepOpenOnAccept
                            disabled={isDeleting}
                            onAccept={() => void handleDelete(response.id)}
                          >
                            This permanently deletes the canned response. This action
                            cannot be undone.
                          </Confirm>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="whitespace-pre-wrap text-gray-600 text-sm">
                        {response.description}
                      </p>
                      <div className="mt-3 flex items-center gap-2 text-gray-500 text-xs">
                        <Badge variant="outline">
                          Created: {new Date(response.createdAt).toLocaleDateString()}
                        </Badge>
                        {response.updatedAt !== response.createdAt && (
                          <Badge variant="outline">
                            Updated: {new Date(response.updatedAt).toLocaleDateString()}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {cannedResponses?.length === 0 && (
                <div className="py-8 text-center text-gray-500">
                  No canned responses yet. Create your first one!
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={isCreateModalOpen || !!editingResponse}
        setIsOpen={closeModal}
        title={editingResponse ? "Edit Canned Response" : "Create Canned Response"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="title" className="mb-1 block font-medium text-sm">
              Title
            </label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Enter response title"
              required
            />
          </div>
          <div>
            <label htmlFor="description" className="mb-1 block font-medium text-sm">
              Response
            </label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="Enter response content"
              rows={6}
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingResponse ? "Update" : "Create"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
