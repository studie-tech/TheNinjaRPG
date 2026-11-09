"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { Eye, Pencil, Plus, Trash2, Type, User, Vote, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import type { z } from "zod";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PollOptionType } from "@/drizzle/constants";
import Accordion from "@/layout/Accordion";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import RichInput from "@/layout/RichInput";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import { parseHtml } from "@/utils/parse";
import {
  canAddNonCustomPollOptions,
  canClosePolls,
  canCreatePolls,
  canDeletePollOptions,
  canEditPolls,
} from "@/utils/permissions";
import { useUserPicker } from "@/utils/search";
import { useUserData } from "@/utils/UserContext";
import {
  type AddPollOptionSchema,
  type CreatePollSchema,
  createPollSchema,
  type UpdatePollSchema,
  updatePollSchema,
} from "@/validators/poll";

export default function PollsPage() {
  const { data: userData } = useUserData();
  const [activeTab, setActiveTab] = useState<string>("active");
  const [selectedPollId, setSelectedPollId] = useState<string>("");

  // Check permissions
  const userCanCreatePolls = userData?.role ? canCreatePolls(userData.role) : false;
  const userCanClosePolls = userData?.role ? canClosePolls(userData.role) : false;

  // Get polls data; the sentinel below the tabs loads further pages
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const {
    data: pollsData,
    isLoading,
    fetchNextPage,
    hasNextPage,
  } = api.poll.getPolls.useInfiniteQuery(
    { limit: 20, includeInactive: true },
    { getNextPageParam: (lastPage) => lastPage.nextCursor },
  );
  const polls = pollsData?.pages.flatMap((page) => page.data) ?? [];
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Separate active and closed polls
  const activePolls = polls.filter((poll) => poll.isActive);
  const closedPolls = polls.filter((poll) => !poll.isActive);

  // Set the first active poll as selected by default when data is loaded
  useEffect(() => {
    if (activePolls.length > 0 && !selectedPollId) {
      setSelectedPollId(activePolls?.[0]?.id || "");
    }
  }, [activePolls, selectedPollId]);

  // Handle form success
  const handleCreateSuccess = () => {
    // Switch back to active tab after creating a poll
    setActiveTab("active");
  };

  return (
    <>
      <ContentBox
        title="Community Polls"
        subtitle="Vote and share your opinion"
        defaultBackHref="/manual"
      >
        <p>
          Participate in community polls to share your opinion on various topics.
          {userCanCreatePolls &&
            " As an admin, you can also create new polls for the community."}
        </p>
      </ContentBox>

      <ContentBox title="Polls" initialBreak={true}>
        <Tabs
          defaultValue="active"
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value);
            // When switching to active tab, select the first active poll
            if (value === "active" && activePolls.length > 0) {
              setSelectedPollId(activePolls?.[0]?.id || "");
            }
            // When switching to closed tab, select the first closed poll
            else if (value === "closed" && closedPolls.length > 0) {
              setSelectedPollId(closedPolls?.[0]?.id || "");
            }
          }}
          className="w-full"
        >
          <TabsList
            className={`grid w-full ${userCanCreatePolls ? "grid-cols-3" : "grid-cols-2"}`}
          >
            <TabsTrigger value="active">Active Polls</TabsTrigger>
            <TabsTrigger value="closed">Closed Polls</TabsTrigger>
            {userCanCreatePolls && (
              <TabsTrigger value="create">Create Poll</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="active">
            {isLoading ? (
              <Loader explanation="Loading active polls" />
            ) : activePolls.length > 0 ? (
              <div className="grid grid-cols-1">
                {activePolls.map((poll) => (
                  <PollAccordion
                    key={poll.id}
                    poll={poll}
                    userCanClosePolls={userCanClosePolls}
                    selectedPollId={selectedPollId}
                    setSelectedPollId={setSelectedPollId}
                  />
                ))}
              </div>
            ) : (
              <div className="py-8 text-center">
                <p className="font-semibold text-lg">No active polls available</p>
                <p className="text-muted-foreground">
                  {userCanCreatePolls
                    ? "Create a new poll by clicking the 'Create Poll' tab."
                    : "Check back later for new polls."}
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="closed">
            {isLoading ? (
              <Loader explanation="Loading closed polls" />
            ) : closedPolls.length > 0 ? (
              <div className="grid grid-cols-1">
                {closedPolls.map((poll) => (
                  <PollAccordion
                    key={poll.id}
                    poll={poll}
                    userCanClosePolls={userCanClosePolls}
                    selectedPollId={selectedPollId}
                    setSelectedPollId={setSelectedPollId}
                  />
                ))}
              </div>
            ) : (
              <div className="py-8 text-center">
                <p className="font-semibold text-lg">No closed polls available</p>
                <p className="text-muted-foreground">
                  Closed polls will appear here after they have been completed.
                </p>
              </div>
            )}
          </TabsContent>

          {userCanCreatePolls && (
            <TabsContent value="create">
              <CreatePollForm onSuccess={handleCreateSuccess} />
            </TabsContent>
          )}
        </Tabs>
        <div ref={setLastElement} />
      </ContentBox>
    </>
  );
}

function PollAccordion({
  poll,
  userCanClosePolls,
  selectedPollId,
  setSelectedPollId,
}: {
  poll: PollWithRelations;
  userCanClosePolls: boolean;
  selectedPollId: string;
  setSelectedPollId: React.Dispatch<React.SetStateAction<string>>;
}) {
  const { data: userData } = useUserData();
  const userCanEditPolls = userData?.role ? canEditPolls(userData.role) : false;
  const [showEditDialog, setShowEditDialog] = useState(false);
  const subtitle = `Created by ${poll.createdBy.username} • ${format(new Date(poll.createdAt), "PPP")} • ${poll.totalVotes} votes${!poll.isActive ? " • Closed" : ""}`;

  return (
    <Accordion
      key={poll.id}
      title={poll.title}
      selectionKey={poll.id}
      selectedTitle={selectedPollId}
      unselectedSubtitle={subtitle}
      selectedSubtitle={subtitle}
      onClick={setSelectedPollId}
      options={
        userCanEditPolls ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              setShowEditDialog(true);
            }}
          >
            <Pencil className="h-4 w-4" />
            <span className="sr-only">Edit poll</span>
          </Button>
        ) : undefined
      }
    >
      <PollContent
        poll={poll}
        userLoggedIn={!!userData}
        userCanClosePolls={userCanClosePolls}
      />

      {showEditDialog && (
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Edit Poll</DialogTitle>
              <DialogDescription>
                Update the title and description of this poll.
              </DialogDescription>
            </DialogHeader>
            <EditPollForm poll={poll} onSuccess={() => setShowEditDialog(false)} />
          </DialogContent>
        </Dialog>
      )}
    </Accordion>
  );
}

// Poll content component to contain the poll content
function PollContent({
  poll,
  userLoggedIn,
  userCanClosePolls,
}: {
  poll: PollWithRelations;
  userLoggedIn: boolean;
  userCanClosePolls: boolean;
}) {
  const utils = api.useUtils();
  const [showResults, setShowResults] = useState(true);
  const [customOption, setCustomOption] = useState("");
  const [optionType, setOptionType] = useState<PollOptionType>("text");

  // Get user data
  const { data: userData } = useUserData();
  // Check permissions based on user role
  const userCanAddOptions = userData?.role
    ? canAddNonCustomPollOptions(userData.role)
    : false;

  // Get user's vote
  const { data: userVote } = api.poll.getUserVote.useQuery(
    { pollId: poll.id },
    { enabled: userLoggedIn },
  );

  // Vote mutation
  const { mutate: vote, isPending: isVoting } = api.poll.vote.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        void utils.poll.getUserVote.invalidate({ pollId: poll.id });
        void utils.poll.getPolls.invalidate();
        setShowResults(true);
      }
    },
  });

  // Retract vote mutation
  const { mutate: retractVote, isPending: isRetracting } =
    api.poll.retractVote.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success) {
          void utils.poll.getUserVote.invalidate({ pollId: poll.id });
          void utils.poll.getPolls.invalidate();
        }
      },
    });

  // Add option mutation
  const { mutate: addOption, isPending: isAddingOption } =
    api.poll.addOption.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success) {
          void utils.poll.getPolls.invalidate();
          setCustomOption("");
          userSearchMethods.reset({ username: "", users: [] });
        }
      },
    });

  // Close poll mutation
  const { mutate: closePoll, isPending: isClosingPoll } =
    api.poll.closePoll.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success) {
          void utils.poll.getPolls.invalidate();
        }
      },
    });

  // Delete option mutation
  const { mutate: deleteOption, isPending: isDeletingOption } =
    api.poll.deletePollOption.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success) {
          void utils.poll.getPolls.invalidate();
        }
      },
    });

  // Check if user can delete a specific option
  const canDeleteOption = (option: PollOptionWithRelations) => {
    if (!userLoggedIn || !userData) return false;

    // Creators can delete their own options, whatever their votes
    const isCreator = option.createdBy.userId === userData.userId;

    // Admin can delete any option based on role permissions
    const isAdmin = userData.role ? canDeletePollOptions(userData.role) : false;

    return isCreator || isAdmin;
  };

  // User search form for adding user options
  const maxUsers = 1;
  const { methods: userSearchMethods, users: selectedUsers } = useUserPicker(maxUsers);

  // Use the pre-calculated vote counts and percentages from the backend
  const optionVotes = poll.options;

  const handleVote = (optionId: string) => {
    if (!userLoggedIn) return;
    vote({ pollId: poll.id, optionId });
  };

  const handleRetractVote = () => {
    if (!userLoggedIn || !userVote) return;
    retractVote({ pollId: poll.id });
  };

  const handleAddOption = () => {
    if (optionType === "text") {
      if (!customOption.trim()) return;
      const addOptionData: AddPollOptionSchema = {
        pollId: poll.id,
        type: "text",
        text: customOption,
      };
      addOption(addOptionData);
    } else {
      if (selectedUsers.length === 0) return;

      // Add the first selected user as an option
      const user = selectedUsers[0];
      if (user) {
        const addOptionData: AddPollOptionSchema = {
          pollId: poll.id,
          type: "user",
          userId: user.userId,
          username: user.username,
        };
        addOption(addOptionData);
      }
    }
  };

  const handleDeleteOption = (optionId: string) => {
    deleteOption({ pollId: poll.id, optionId });
  };

  const handleTogglePollStatus = () => {
    if (!userCanClosePolls) return;
    closePoll({ id: poll.id, isActive: !poll.isActive });
  };

  // The voting view only shows for active polls, so both views share the results styling
  const statusButton = userCanClosePolls && (
    <Button
      variant={poll.isActive ? "destructive" : "default"}
      size="sm"
      onClick={handleTogglePollStatus}
      disabled={isClosingPoll}
    >
      {poll.isActive ? "Close Poll" : "Reopen Poll"}
    </Button>
  );

  // Render option content based on option type
  const renderOptionContent = (option: PollWithRelations["options"][0]) => {
    // Check if it's a user option and has a targetUser
    if (option.optionType === "user") {
      // If we have the targetUser relation data
      if (option.targetUser) {
        return (
          <div className="flex items-center gap-2">
            <div className="h-6 w-6">
              <AvatarImage
                href={option.targetUser.avatar}
                alt={option.targetUser.username}
                size={100}
              />
            </div>
            <span>{option.targetUser.username}</span>
          </div>
        );
      }
      // Fallback to just showing the text (which should be the username)
      return (
        <div className="flex items-center gap-2">
          <User className="mr-1 h-4 w-4" />
          <span>{option.text}</span>
        </div>
      );
    }
    // For text options, just return the text
    return option.text;
  };

  return (
    <div className="mt-4 space-y-4">
      <Card className="bg-muted/50">
        <CardContent className="rounded-xl bg-popover p-4">
          <div className="prose max-w-none">
            <p className="text-sm">{parseHtml(poll.description)}</p>
          </div>
        </CardContent>
      </Card>

      <div className="text-muted-foreground text-sm">
        Created on: {format(new Date(poll.createdAt), "PPP")}
      </div>

      {poll.endDate && (
        <div className="text-muted-foreground text-sm">
          Ends on: {format(new Date(poll.endDate), "PPP")}
        </div>
      )}

      <div className="space-y-2">
        {/* Show results or voting options */}
        {showResults || !poll.isActive || !userLoggedIn ? (
          // Results view
          <div className="space-y-3">
            {optionVotes.map((option) => (
              <div key={option.id} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{renderOptionContent(option)}</span>
                  <div className="flex items-center gap-2">
                    <span>
                      {option.voteCount} vote{option.voteCount !== 1 && "s"} (
                      {option.percentage}%)
                    </span>
                    {canDeleteOption(option) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleDeleteOption(option.id)}
                        disabled={isDeletingOption}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full ${userVote?.optionId === option.id ? "bg-primary" : "bg-primary/60"}`}
                    style={{ width: `${option.percentage}%` }}
                  />
                </div>
              </div>
            ))}

            <div className="mt-4 mb-4 flex flex-wrap gap-2">
              {userLoggedIn && poll.isActive && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowResults(false)}
                  disabled={isRetracting}
                >
                  {userVote ? "Change Vote" : "Vote Now"}
                </Button>
              )}

              {/* Admin controls */}
              {statusButton}
            </div>
          </div>
        ) : (
          // Voting view
          <div className="space-y-3">
            {optionVotes.map((option) => (
              <div key={option.id} className="flex items-center gap-2">
                <Button
                  variant={userVote?.optionId === option.id ? "default" : "outline"}
                  className="w-full justify-start"
                  onClick={() => handleVote(option.id)}
                  disabled={isVoting}
                >
                  <Vote className="mr-2 h-4 w-4" />
                  {renderOptionContent(option)}
                </Button>
                {canDeleteOption(option) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="flex-shrink-0"
                    onClick={() => handleDeleteOption(option.id)}
                    disabled={isDeletingOption}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}

            {/* Custom option input */}
            {(poll.allowCustomOptions || userCanAddOptions) && (
              <Card className="mt-4 rounded-xl bg-popover">
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm">Add Option</div>
                      <RadioGroup
                        defaultValue="text"
                        className="flex flex-row space-x-2"
                        onValueChange={(value) =>
                          setOptionType(value as PollOptionType)
                        }
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="text" id="add-text" />
                          <label
                            htmlFor="add-text"
                            className="flex items-center font-medium text-sm"
                          >
                            <Type className="mr-1 h-4 w-4" /> Text
                          </label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="user" id="add-user" />
                          <label
                            htmlFor="add-user"
                            className="flex items-center font-medium text-sm"
                          >
                            <User className="mr-1 h-4 w-4" /> User
                          </label>
                        </div>
                      </RadioGroup>
                    </div>

                    {optionType === "text" ? (
                      <div className="flex gap-2">
                        <Input
                          placeholder="Add your own option..."
                          value={customOption}
                          onChange={(e) => setCustomOption(e.target.value)}
                          disabled={isAddingOption}
                        />
                        <Button
                          variant="outline"
                          onClick={handleAddOption}
                          disabled={!customOption.trim() || isAddingOption}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <UserSearchSelect
                              useFormMethods={userSearchMethods}
                              showYourself={true}
                              label="Search for a user to add as an option"
                              maxUsers={1}
                            />
                          </div>
                          <Button
                            variant="outline"
                            onClick={handleAddOption}
                            disabled={selectedUsers.length === 0 || isAddingOption}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="mt-4 mb-4 flex flex-wrap gap-2">
              {/* View results button */}
              <Button size="sm" onClick={() => setShowResults(true)}>
                <Eye className="mr-2 h-4 w-4" />
                View Results
              </Button>

              {/* Retract vote button */}
              {userVote && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleRetractVote}
                  disabled={isRetracting}
                >
                  <X className="mr-2 h-4 w-4" />
                  Retract Vote
                </Button>
              )}

              {/* Admin controls */}
              {statusButton}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CreatePollForm({ onSuccess }: { onSuccess: () => void }) {
  const [optionType, setOptionType] = useState<PollOptionType>("text");

  const form = useForm<CreatePollInput, unknown, CreatePollSchema>({
    resolver: zodResolver(createPollSchema),
    defaultValues: {
      title: "",
      description: "",
      options: [
        { type: "text", text: "" },
        { type: "text", text: "" },
      ],
      allowCustomOptions: true,
    },
    mode: "onChange",
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "options",
  });
  const textOptions = fields
    .map((option, index) => ({ ...option, index }))
    .filter((option) => option.type === "text");

  const optionsError =
    form.formState.errors.options?.root?.message ??
    form.formState.errors.options?.message;

  // Form for user search
  const maxUsers = 1;
  const { methods: userSearchMethods, users: selectedUsers } = useUserPicker(maxUsers);

  useEffect(() => {
    const options = form.getValues("options");
    const removedIndices = options.flatMap((option, index) =>
      option.type === "user" &&
      !selectedUsers.some((user) => user.userId === option.userId)
        ? [index]
        : [],
    );
    if (removedIndices.length > 0) remove(removedIndices);

    const newUsers = selectedUsers.filter(
      (user) =>
        !options.some(
          (option) => option.type === "user" && option.userId === user.userId,
        ),
    );
    if (newUsers.length > 0) {
      append(
        newUsers.map((user) => ({
          type: "user" as const,
          userId: user.userId,
          username: user.username,
        })),
        { shouldFocus: false },
      );
    }
    if (form.formState.isSubmitted) void form.trigger("options");
  }, [selectedUsers, form, append, remove]);

  const utils = api.useUtils();
  const {
    mutate: createPoll,
    isPending,
    data: saveResponse,
  } = api.poll.createPoll.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (!data.success) return;
      void utils.poll.getPolls.invalidate();
      userSearchMethods.reset();
      form.reset();
      onSuccess();
    },
  });

  const onSubmit = (data: CreatePollSchema) => {
    createPoll(data);
  };

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => {
          void form.handleSubmit(onSubmit)(e);
        }}
        className="space-y-6"
      >
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Poll Title</FormLabel>
              <FormControl>
                <Input placeholder="Enter poll title" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={() => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <RichInput
                  placeholder="Enter poll description"
                  id="description"
                  height="150"
                  control={form.control}
                  error={form.formState.errors.description?.message}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="options"
          render={() => (
            <FormItem className="space-y-4">
              <div className="flex items-center justify-between">
                <FormLabel>Options</FormLabel>
                <RadioGroup
                  defaultValue="text"
                  className="flex flex-row space-x-2"
                  onValueChange={(value) => setOptionType(value as PollOptionType)}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="text" id="text" />
                    <FormLabel htmlFor="text" className="flex items-center">
                      <Type className="mr-1 h-4 w-4" /> Text
                    </FormLabel>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="user" id="user" />
                    <FormLabel htmlFor="user" className="flex items-center">
                      <User className="mr-1 h-4 w-4" /> User
                    </FormLabel>
                  </div>
                </RadioGroup>
              </div>

              {optionType === "text" ? (
                // Text options
                <>
                  {textOptions.map((option, index) => (
                    <FormField
                      key={option.id}
                      control={form.control}
                      name={`options.${option.index}.text`}
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex gap-2">
                            <FormControl>
                              <Input placeholder={`Option ${index + 1}`} {...field} />
                            </FormControl>
                            {textOptions.length > 2 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove option ${index + 1}`}
                                onClick={() => remove(option.index)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ type: "text", text: "" })}
                    className="mt-2"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Text Option
                  </Button>
                </>
              ) : (
                // User options
                <div className="space-y-4">
                  <UserSearchSelect
                    useFormMethods={userSearchMethods}
                    showYourself={true}
                    label="Search for users to add as options"
                  />
                </div>
              )}
              {optionsError && (
                <p role="alert" className="text-destructive text-sm">
                  {optionsError}
                </p>
              )}
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="allowCustomOptions"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center space-x-3 space-y-0">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel>Allow users to add custom options</FormLabel>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="endDate"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>End Date (Optional)</FormLabel>
              <FormControl>
                <Input
                  id="end-date"
                  type="date"
                  value={field.value ? field.value.toISOString().slice(0, 10) : ""}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => {
                    const val = e.target.value;
                    field.onChange(val ? new Date(val) : undefined);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {saveResponse && !saveResponse.success && (
          <p role="alert" className="text-destructive">
            {saveResponse.message}
          </p>
        )}
        <Button type="submit" className="hover:cursor-pointer" disabled={isPending}>
          Create Poll
        </Button>
      </form>
    </Form>
  );
}

function EditPollForm({
  poll,
  onSuccess,
}: {
  poll: PollWithRelations;
  onSuccess: () => void;
}) {
  const form = useForm<UpdatePollSchema>({
    resolver: zodResolver(updatePollSchema),
    defaultValues: {
      id: poll.id,
      title: poll.title,
      description: poll.description,
      allowCustomOptions: poll.allowCustomOptions,
    },
    mode: "onChange",
  });

  const utils = api.useUtils();
  const {
    mutate: updatePoll,
    isPending,
    data: saveResponse,
  } = api.poll.updatePoll.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (!data.success) return;
      void utils.poll.getPolls.invalidate();
      form.reset();
      onSuccess();
    },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((data) => updatePoll(data))}
        className="space-y-4"
      >
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input placeholder="Poll title" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={() => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <RichInput
                  placeholder="Poll description"
                  id="description"
                  height="150"
                  control={form.control}
                  error={form.formState.errors.description?.message}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="allowCustomOptions"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center space-x-3 space-y-0">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel>Allow users to add custom options</FormLabel>
            </FormItem>
          )}
        />

        {saveResponse && !saveResponse.success && (
          <p role="alert" className="text-destructive">
            {saveResponse.message}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onSuccess}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Updating..." : "Update Poll"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

type PollWithRelations = RouterOutputs["poll"]["getPolls"]["data"][number];
type PollOptionWithRelations = PollWithRelations["options"][number];

// Form input type for the poll creation form; z.input keeps Zod v4 prefaults optional
type CreatePollInput = z.input<typeof createPollSchema>;
