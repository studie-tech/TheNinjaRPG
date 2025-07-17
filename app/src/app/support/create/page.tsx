"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import RichInput from "@/layout/RichInput";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SUPPORT_TICKET_CATEGORY_DESCRIPTIONS,
  SUPPORT_TICKET_PRIORITY_DESCRIPTIONS,
} from "@/drizzle/constants";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, X, Plus, Info, CheckCircle, Tag } from "lucide-react";
import { showMutationToast } from "@/libs/toast";
import { api } from "@/app/_trpc/client";
import { useRequiredUserData } from "@/utils/UserContext";
import { createSupportTicketSchema } from "@/validators/support";
import {
  type SupportTicketCategory,
  type SupportTicketPriority,
  SupportTicketCategories,
  SupportTicketPriorities,
  SUPPORT_TICKET_COLORS,
  SUPPORT_TICKET_LIMITS,
} from "@/drizzle/constants";
import type { z } from "zod";

type CreateTicketFormData = z.infer<typeof createSupportTicketSchema>;

export default function CreateSupportTicket() {
  const router = useRouter();
  const { data: userData } = useRequiredUserData();
  const [currentTag, setCurrentTag] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    control,
  } = useForm<CreateTicketFormData>({
    resolver: zodResolver(createSupportTicketSchema),
    defaultValues: {
      priority: "MEDIUM",
      isPublic: false,
      tags: [],
    },
  });

  const watchedTitle = useWatch({ control, name: "title" });
  const watchedDescription = useWatch({ control, name: "description" });
  const watchedIsPublic = useWatch({ control, name: "isPublic" });
  const watchedTags = useWatch({ control, name: "tags" });

  // Create ticket mutation
  const createTicket = api.support.createTicket.useMutation({
    onSuccess: (data) => {
      showMutationToast({
        success: true,
        message: "Support ticket created successfully!",
      });
      if (data.data?.ticketId) {
        router.push(`/support/${data.data.ticketId}`);
      } else {
        router.push("/support");
      }
    },
  });

  const onSubmit = (data: CreateTicketFormData) => {
    createTicket.mutate({ ...data });
  };

  const addTag = () => {
    if (
      currentTag.trim() &&
      !watchedTags.includes(currentTag.trim()) &&
      watchedTags.length < SUPPORT_TICKET_LIMITS.MAX_TAGS
    ) {
      const newTags = [...watchedTags, currentTag.trim()];
      setValue("tags", newTags);
      setCurrentTag("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    setValue(
      "tags",
      watchedTags.filter((tag) => tag !== tagToRemove),
    );
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  };

  if (!userData) return <Loader explanation="Loading userdata" />;

  return (
    <ContentBox
      title="Create Support Ticket"
      subtitle="Get help with your questions or report issues"
      back_href="/support"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Basic Information
            </CardTitle>
            <CardDescription>
              Provide a clear title and description of your issue or question.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                {...register("title")}
                placeholder="Brief description of your issue or question"
                className={errors.title ? "border-red-500" : ""}
              />
              {errors.title && (
                <p className="text-sm text-red-500">{errors.title.message}</p>
              )}
              <p className="text-xs text-gray-500">
                {watchedTitle?.length || 0} / {SUPPORT_TICKET_LIMITS.TITLE_MAX_LENGTH}{" "}
                characters
              </p>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <RichInput
                id="description"
                control={control}
                label="Description *"
                height="min-h-[120px]"
                placeholder="Detailed description of your issue or question. Include steps to reproduce if reporting a bug."
                error={errors.description?.message}
                allowClipboardPaste={true}
              />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <p>
                  {watchedDescription?.length || 0} /{" "}
                  {SUPPORT_TICKET_LIMITS.DESCRIPTION_MAX_LENGTH} characters
                </p>
                <div>
                  <span className="font-medium">Tip:</span> Copy-pasting is enabled in
                  this field.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Categorization */}
        <Card>
          <CardHeader>
            <CardTitle>Categorization</CardTitle>
            <CardDescription>
              Help us route your ticket to the right team.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Category */}
            <div className="space-y-2">
              <Label htmlFor="category">Category *</Label>
              <Select
                onValueChange={(value) =>
                  setValue("category", value as SupportTicketCategory)
                }
              >
                <SelectTrigger className={errors.category ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {SupportTicketCategories.map((category) => (
                    <SelectItem key={category} value={category}>
                      <div className="flex items-center gap-2">
                        <Badge className={SUPPORT_TICKET_COLORS.CATEGORY[category]}>
                          {category.replace("_", " ")}
                        </Badge>
                        <span className="text-sm text-gray-600">
                          {SUPPORT_TICKET_CATEGORY_DESCRIPTIONS[category]}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.category && (
                <p className="text-sm text-red-500">{errors.category.message}</p>
              )}
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select
                onValueChange={(value) =>
                  setValue("priority", value as SupportTicketPriority)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  {SupportTicketPriorities.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      <div className="flex items-center gap-2">
                        <Badge className={SUPPORT_TICKET_COLORS.PRIORITY[priority]}>
                          {priority}
                        </Badge>
                        <span className="text-sm text-gray-600">
                          {SUPPORT_TICKET_PRIORITY_DESCRIPTIONS[priority]}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label htmlFor="tags">Tags (Optional)</Label>
              <div className="flex gap-2">
                <Input
                  value={currentTag}
                  onChange={(e) => setCurrentTag(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Add a tag"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addTag}
                  disabled={
                    !currentTag.trim() || watchedTags.includes(currentTag.trim())
                  }
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {watchedTags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {watchedTags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="flex items-center gap-1"
                    >
                      <Tag className="h-3 w-3" />
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="ml-1 hover:text-red-500"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-500">
                {watchedTags.length} / {SUPPORT_TICKET_LIMITS.MAX_TAGS} tags
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>Configure how your ticket is handled.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Public Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Make ticket public</Label>
                <p className="text-sm text-gray-500">
                  Allow other users to see this ticket
                </p>
              </div>
              <Switch
                checked={watchedIsPublic}
                onCheckedChange={(checked) => setValue("isPublic", checked)}
              />
            </div>

            {watchedIsPublic && (
              <Alert variant="info">
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Public tickets will be visible to all users once resolved and may be
                  used to help other users with similar issues.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-4">
          <Button type="submit" disabled={createTicket.isPending}>
            {createTicket.isPending ? (
              <>
                <Loader explanation="" />
                Creating...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Create Ticket
              </>
            )}
          </Button>
        </div>
      </form>
    </ContentBox>
  );
}
