"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { canEditCannedResponses } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";
import Modal2 from "@/layout/Modal2";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Edit2, Plus, Trash2, Copy } from "lucide-react";
import { showMutationToast } from "@/libs/toast";
import { toast } from "sonner";
import Loader from "@/layout/Loader";
import type { CannedResponse } from "@/drizzle/schema";

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

  const deleteMutation = api.support.deleteCannedResponse.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      void refetch();
      onResponsesChange?.();
    },
  });

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

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this canned response?")) {
      deleteMutation.mutate({ id });
    }
  };

  const handleCopy = (description: string) => {
    void navigator.clipboard
      .writeText(description)
      .then(() => {
        toast.success("Canned response copied to clipboard!");
      })
      .catch(() => {
        toast.error("Failed to copy to clipboard");
      });
  };

  const closeModal = () => {
    setIsCreateModalOpen(false);
    setEditingResponse(null);
    setFormData({ title: "", description: "" });
  };

  return (
    <>
      <Modal2 isOpen={isOpen} setIsOpen={setIsOpen} title="Manage Canned Responses">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-600">
              Manage pre-written responses for support tickets
            </p>
            <Button onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Response
            </Button>
          </div>

          {isLoading ? (
            <Loader explanation="Loading canned responses..." />
          ) : (
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {cannedResponses?.map((response) => (
                <Card key={response.id} className="relative">
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
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(response.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">
                      {response.description}
                    </p>
                    <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
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
              ))}
              {cannedResponses?.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No canned responses yet. Create your first one!
                </div>
              )}
            </div>
          )}
        </div>
      </Modal2>

      <Modal2
        isOpen={isCreateModalOpen || !!editingResponse}
        setIsOpen={closeModal}
        title={editingResponse ? "Edit Canned Response" : "Create Canned Response"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="title" className="block text-sm font-medium mb-1">
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
            <label htmlFor="description" className="block text-sm font-medium mb-1">
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
      </Modal2>
    </>
  );
}
