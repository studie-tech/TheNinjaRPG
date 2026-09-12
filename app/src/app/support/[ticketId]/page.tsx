"use client";

import { SiGithub } from "@icons-pack/react-simple-icons";
import {
  AlertCircle,
  Check,
  Clock,
  Copy,
  Edit,
  ExternalLink,
  Loader2,
  Plus,
  Tag,
  Users,
} from "lucide-react";
import Link from "next/link";
import { use, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/app/_trpc/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  SUPPORT_TICKET_STATUS_TRANSITIONS,
  SupportTicketCategories,
  SupportTicketPriorities,
} from "@/drizzle/constants";
import CannedResponsesManagement from "@/layout/CannedResponsesManagement";
import ContentBox from "@/layout/ContentBox";
import Conversation from "@/layout/Conversation";
import Loader from "@/layout/Loader";
import Post from "@/layout/Post";
import { getStatusIcon } from "@/libs/menus";
import {
  formatTimeAgo,
  getCategoryColor,
  getPriorityColor,
  getStatusColor,
} from "@/libs/support";
import { showMutationToast } from "@/libs/toast";
import {
  canEditCannedResponses,
  canEscalateToGithub,
  isStaffRole,
} from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";

type TicketUpdateAction = {
  kind:
    | "status"
    | "priority"
    | "category"
    | "assignment"
    | "visibility"
    | "tag"
    | "comment-status";
  label: string;
};

export default function TicketDetail(props: { params: Promise<{ ticketId: string }> }) {
  // State
  const params = use(props.params);
  const { data: userData } = useRequiredUserData();
  const [refreshKey, setRefreshKey] = useState(0);
  const [newTag, setNewTag] = useState("");

  // Popover open states to close after selection
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<TicketUpdateAction | null>(null);
  const ticketUpdateInFlightRef = useRef(false);
  const queuedCommentStatusRef = useRef(false);

  // Canned responses state
  const [isManagementOpen, setIsManagementOpen] = useState(false);

  // Derived
  const isStaff = userData?.role ? isStaffRole(userData.role) : false;

  // Get utils
  const utils = api.useUtils();

  // Query for ticket details
  const { data: ticket, isLoading } = api.support.getTicket.useQuery({
    ticketId: params.ticketId,
  });

  // Query for available staff (for assignment) using getPublicUsers
  const { data: staffData } = api.profile.getPublicUsers.useQuery(
    { orderBy: "Staff", isAi: false, limit: 50 },
    { enabled: isStaff },
  );
  const availableStaff = staffData?.data || [];

  // Query for canned responses
  const { data: cannedResponses, refetch: refetchCannedResponses } =
    api.support.getCannedResponses.useQuery(undefined, {
      enabled: isStaff && canEditCannedResponses(userData?.role),
    });

  // Update ticket mutation
  const updateTicket = api.support.updateTicket.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.support.getTicket.invalidate({ ticketId: params.ticketId }),
          utils.support.getTickets.invalidate(),
        ]);
        setRefreshKey((prev) => prev + 1);
      }
    },
    onError: (error) => {
      toast.error(error.message || "Could not update the ticket. Please try again.");
    },
  });

  const startTicketUpdate = (
    input: Parameters<typeof updateTicket.mutateAsync>[0],
    action: TicketUpdateAction,
    onSuccess?: () => void,
  ) => {
    if (ticketUpdateInFlightRef.current) return false;

    ticketUpdateInFlightRef.current = true;
    setPendingAction(action);
    void updateTicket
      .mutateAsync(input)
      .then((data) => {
        if (data.success) onSuccess?.();
      })
      .catch(() => undefined)
      .finally(() => {
        ticketUpdateInFlightRef.current = false;
        setPendingAction(null);

        if (queuedCommentStatusRef.current) {
          queuedCommentStatusRef.current = false;
          void Promise.resolve().then(() => {
            startTicketUpdate(
              { ticketId: params.ticketId, status: "IN_PROGRESS" },
              {
                kind: "comment-status",
                label: "Updating",
              },
            );
          });
        }
      });

    return true;
  };

  const isUpdatingTicket = pendingAction !== null;

  // Escalate to GitHub mutation
  const escalateToGithub = api.support.escalateToGithub.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.support.getTicket.invalidate({ ticketId: params.ticketId }),
          utils.support.getTickets.invalidate(),
        ]);
        setRefreshKey((prev) => prev + 1);
      }
    },
  });

  // Canned responses handlers
  const handleCopyCannedResponse = (description: string) => {
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

  const handleCannedResponsesChange = () => {
    void refetchCannedResponses();
  };

  // Derived pass 2
  const canUpdateTicket =
    ticket &&
    (ticket.createdByUserId === userData?.userId ||
      isStaff ||
      ticket.assignedToUserId === userData?.userId);

  const availableStatusTransitions = ticket
    ? SUPPORT_TICKET_STATUS_TRANSITIONS[ticket.status] || []
    : [];

  // Guards
  if (isLoading) {
    return <Loader explanation="Loading ticket details..." />;
  }
  if (!ticket) {
    return (
      <ContentBox title="Ticket Not Found">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            The ticket you&apos;re looking for doesn&apos;t exist or you don&apos;t have
            permission to view it.
          </AlertDescription>
        </Alert>
      </ContentBox>
    );
  }

  return (
    <div className="space-y-6">
      {/* Ticket Information in Post Component */}
      <ContentBox
        title="Ticket Information"
        defaultBackHref="/support"
        subtitle={`Ticket#: ${ticket.id}`}
      >
        <Post
          user={ticket.createdBy}
          title={ticket.title}
          options={
            <>
              {ticket.githubIssueUrl && (
                <Link
                  href={ticket.githubIssueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button className="flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" />
                    GitHub Issue
                  </Button>
                </Link>
              )}
              {isStaff &&
                canEscalateToGithub(userData?.role) &&
                !ticket.githubIssueUrl && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (
                          confirm(
                            "Are you sure you want to escalate this ticket to GitHub?",
                          )
                        ) {
                          escalateToGithub.mutate({ ticketId: params.ticketId });
                        }
                      }}
                      disabled={escalateToGithub.isPending}
                    >
                      <SiGithub className="mr-2 text-black" size={10} />
                      {escalateToGithub.isPending ? "Escalating" : "Escalate to GitHub"}
                    </Button>
                  </div>
                )}
            </>
          }
        >
          <div className="space-y-4">
            {/* Ticket Metadata */}
            <div className="flex items-center gap-2 text-gray-600 text-sm">
              <span>Created {formatTimeAgo(ticket.createdAt)}</span>
              {ticket.assignedTo && (
                <>
                  <Separator orientation="vertical" className="h-4" />
                  <span>Assigned to {ticket.assignedTo.username}</span>
                </>
              )}
            </div>

            {/* Status, Priority, Category & Public Badges with inline controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Status */}
              <Popover
                open={statusOpen}
                onOpenChange={(open) => !isUpdatingTicket && setStatusOpen(open)}
              >
                <PopoverTrigger asChild disabled={!canUpdateTicket || isUpdatingTicket}>
                  <Badge
                    className={`${getStatusColor(ticket.status)} ${isUpdatingTicket ? "cursor-not-allowed opacity-70" : ""}`}
                    role="button"
                    aria-disabled={!canUpdateTicket || isUpdatingTicket}
                    aria-busy={pendingAction?.kind === "status"}
                  >
                    {pendingAction?.kind === "status" ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                        <span>{pendingAction.label}</span>
                      </>
                    ) : (
                      <>
                        {getStatusIcon(ticket.status)}
                        <span className="ml-1">{ticket.status.replace("_", " ")}</span>
                        {canUpdateTicket && <Edit className="ml-1 h-3 w-3" />}
                      </>
                    )}
                  </Badge>
                </PopoverTrigger>
                {canUpdateTicket && (
                  <PopoverContent className="w-56 space-y-1 p-2">
                    {availableStatusTransitions.map((status) => (
                      <button
                        type="button"
                        key={status}
                        disabled={isUpdatingTicket}
                        onClick={() => {
                          const accepted = startTicketUpdate(
                            { ticketId: params.ticketId, status },
                            {
                              kind: "status",
                              label: "Updating",
                            },
                          );
                          if (accepted) setStatusOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded px-2 py-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${status === ticket.status ? "font-semibold" : ""}`}
                      >
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          {getStatusIcon(status)} {status.replace("_", " ")}
                        </span>
                        {status === ticket.status && (
                          <Check className="h-4 w-4 opacity-70" />
                        )}
                      </button>
                    ))}
                  </PopoverContent>
                )}
              </Popover>

              {/* Priority */}
              <Popover
                open={priorityOpen}
                onOpenChange={(open) => !isUpdatingTicket && setPriorityOpen(open)}
              >
                <PopoverTrigger asChild disabled={!canUpdateTicket || isUpdatingTicket}>
                  <Badge
                    className={`${getPriorityColor(ticket.priority)} ${isUpdatingTicket ? "cursor-not-allowed opacity-70" : ""}`}
                    role="button"
                    aria-disabled={!canUpdateTicket || isUpdatingTicket}
                    aria-busy={pendingAction?.kind === "priority"}
                  >
                    {pendingAction?.kind === "priority" ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                        <span>{pendingAction.label}</span>
                      </>
                    ) : (
                      <>
                        {ticket.priority}
                        {canUpdateTicket && <Edit className="ml-1 h-3 w-3" />}
                      </>
                    )}
                  </Badge>
                </PopoverTrigger>
                {canUpdateTicket && (
                  <PopoverContent className="w-40 space-y-1 p-2">
                    {SupportTicketPriorities.map((p) => (
                      <button
                        type="button"
                        key={p}
                        disabled={isUpdatingTicket}
                        onClick={() => {
                          const accepted = startTicketUpdate(
                            { ticketId: params.ticketId, priority: p },
                            { kind: "priority", label: "Updating" },
                          );
                          if (accepted) setPriorityOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded px-2 py-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${p === ticket.priority ? "font-semibold" : ""}`}
                      >
                        <span>{p}</span>
                        {p === ticket.priority && (
                          <Check className="h-4 w-4 opacity-70" />
                        )}
                      </button>
                    ))}
                  </PopoverContent>
                )}
              </Popover>

              {/* Category */}
              <Popover
                open={categoryOpen}
                onOpenChange={(open) => !isUpdatingTicket && setCategoryOpen(open)}
              >
                <PopoverTrigger asChild disabled={!canUpdateTicket || isUpdatingTicket}>
                  <Badge
                    className={`${getCategoryColor(ticket.category)} ${isUpdatingTicket ? "cursor-not-allowed opacity-70" : ""}`}
                    role="button"
                    aria-disabled={!canUpdateTicket || isUpdatingTicket}
                    aria-busy={pendingAction?.kind === "category"}
                  >
                    {pendingAction?.kind === "category" ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                        <span>{pendingAction.label}</span>
                      </>
                    ) : (
                      <>
                        {ticket.category}
                        {canUpdateTicket && <Edit className="ml-1 h-3 w-3" />}
                      </>
                    )}
                  </Badge>
                </PopoverTrigger>
                {canUpdateTicket && (
                  <PopoverContent className="w-56 space-y-1 p-2">
                    {SupportTicketCategories.map((c) => (
                      <button
                        type="button"
                        key={c}
                        disabled={isUpdatingTicket}
                        onClick={() => {
                          const accepted = startTicketUpdate(
                            { ticketId: params.ticketId, category: c },
                            {
                              kind: "category",
                              label: "Updating",
                            },
                          );
                          if (accepted) setCategoryOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded px-2 py-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${c === ticket.category ? "font-semibold" : ""}`}
                      >
                        <span>{c.replace("_", " ")}</span>
                        {c === ticket.category && (
                          <Check className="h-4 w-4 opacity-70" />
                        )}
                      </button>
                    ))}
                  </PopoverContent>
                )}
              </Popover>

              {/* Assignment */}
              <Popover
                open={assignOpen}
                onOpenChange={(open) => !isUpdatingTicket && setAssignOpen(open)}
              >
                <PopoverTrigger asChild disabled={!isStaff || isUpdatingTicket}>
                  <Badge
                    variant="secondary"
                    role="button"
                    aria-disabled={!isStaff || isUpdatingTicket}
                    aria-busy={pendingAction?.kind === "assignment"}
                    className={isUpdatingTicket ? "cursor-not-allowed opacity-70" : ""}
                  >
                    {pendingAction?.kind === "assignment" ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                        <span>{pendingAction.label}</span>
                      </>
                    ) : (
                      <>
                        <Users className="mr-1 h-3 w-3" />
                        {ticket.assignedTo ? ticket.assignedTo.username : "Unassigned"}
                        {isStaff && <Edit className="ml-1 h-3 w-3" />}
                      </>
                    )}
                  </Badge>
                </PopoverTrigger>
                {isStaff && (
                  <PopoverContent className="w-56 space-y-1 p-2">
                    <button
                      type="button"
                      disabled={isUpdatingTicket}
                      onClick={() => {
                        const accepted = startTicketUpdate(
                          {
                            ticketId: params.ticketId,
                            assignedToUserId: undefined,
                          },
                          { kind: "assignment", label: "Unassigning" },
                        );
                        if (accepted) setAssignOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded px-2 py-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${!ticket.assignedTo ? "font-semibold" : ""}`}
                    >
                      <span>Unassigned</span>
                      {!ticket.assignedTo && <Check className="h-4 w-4 opacity-70" />}
                    </button>
                    {availableStaff.map((staff) => (
                      <button
                        type="button"
                        key={staff.userId}
                        disabled={isUpdatingTicket}
                        onClick={() => {
                          const accepted = startTicketUpdate(
                            {
                              ticketId: params.ticketId,
                              assignedToUserId: staff.userId,
                            },
                            {
                              kind: "assignment",
                              label: "Assigning",
                            },
                          );
                          if (accepted) setAssignOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded px-2 py-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${ticket.assignedToUserId === staff.userId ? "font-semibold" : ""}`}
                      >
                        <span>{staff.username}</span>
                        {ticket.assignedToUserId === staff.userId && (
                          <Check className="h-4 w-4 opacity-70" />
                        )}
                      </button>
                    ))}
                  </PopoverContent>
                )}
              </Popover>

              {/* Public Flag */}
              <Badge
                variant="outline"
                role="button"
                aria-disabled={!canUpdateTicket || isUpdatingTicket}
                aria-busy={pendingAction?.kind === "visibility"}
                onClick={() => {
                  if (canUpdateTicket) {
                    startTicketUpdate(
                      {
                        ticketId: params.ticketId,
                        isPublic: !ticket.isPublic,
                      },
                      {
                        kind: "visibility",
                        label: `Making ticket ${ticket.isPublic ? "private" : "public"}…`,
                      },
                    );
                  }
                }}
                className={`${canUpdateTicket && !isUpdatingTicket ? "cursor-pointer hover:bg-muted" : "cursor-not-allowed opacity-70"}`}
              >
                {pendingAction?.kind === "visibility" ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                    <span>{pendingAction.label}</span>
                  </>
                ) : (
                  <>
                    <Users className="mr-1 h-3 w-3" />
                    {ticket.isPublic ? "Public" : "Private"}
                  </>
                )}
              </Badge>
              {/* End Public */}
            </div>

            {/* Tags with add functionality */}
            <div className="flex flex-wrap items-center gap-1">
              <Tag className="h-3 w-3 text-gray-500" />
              {ticket.tags.map((tag, i) => (
                <Badge key={`${tag}-${i}`} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
              {canUpdateTicket && (
                <Popover
                  open={tagOpen}
                  onOpenChange={(open) => !isUpdatingTicket && setTagOpen(open)}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-gray-500 hover:text-orange-500"
                      disabled={isUpdatingTicket}
                      aria-label="Add tag"
                    >
                      {pendingAction?.kind === "tag" ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-60">
                    <div className="flex items-center gap-2">
                      <Input
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        placeholder="New tag"
                        disabled={isUpdatingTicket}
                      />
                      <Button
                        disabled={isUpdatingTicket || newTag.trim().length === 0}
                        aria-busy={pendingAction?.kind === "tag"}
                        onClick={() => {
                          const tagToAdd = newTag.trim();
                          if (tagToAdd.length > 0 && !ticket.tags.includes(tagToAdd)) {
                            startTicketUpdate(
                              {
                                ticketId: params.ticketId,
                                tags: [...ticket.tags, tagToAdd],
                              },
                              { kind: "tag", label: "Adding" },
                              () => {
                                setNewTag("");
                                setTagOpen(false);
                              },
                            );
                          }
                        }}
                      >
                        {pendingAction?.kind === "tag" ? (
                          <>
                            <Loader2
                              className="mr-2 h-4 w-4 animate-spin"
                              aria-hidden
                            />
                            Adding
                          </>
                        ) : (
                          "Add"
                        )}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
            <div className="min-h-5" aria-live="polite" aria-atomic="true">
              {pendingAction && (
                <p className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {pendingAction.label}
                </p>
              )}
            </div>
          </div>
        </Post>
      </ContentBox>

      {/* Conversation Component for Comments */}
      <Conversation
        refreshKey={refreshKey}
        convo_id={ticket.conversationId}
        title="Conversation"
        subtitle="Talk with staff"
        supportTicketCreatedByUserId={ticket.createdByUserId}
        onCommentPosted={() => {
          const accepted = startTicketUpdate(
            { ticketId: params.ticketId, status: "IN_PROGRESS" },
            {
              kind: "comment-status",
              label: "Updating",
            },
          );
          if (!accepted) queuedCommentStatusRef.current = true;
        }}
      />

      {/* Canned Responses */}
      {isStaff && canEditCannedResponses(userData?.role) && (
        <ContentBox
          title="Canned Responses"
          subtitle="Quick response templates"
          topRightContent={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsManagementOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Manage
            </Button>
          }
        >
          <div className="space-y-3">
            {cannedResponses?.map((response) => (
              <div
                key={response.id}
                className="flex items-center justify-between rounded-lg bg-gray-50 p-3"
              >
                <div className="flex-1">
                  <h4 className="font-medium text-sm">{response.title}</h4>
                  <p className="mt-1 line-clamp-2 text-gray-600 text-xs">
                    {response.description}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopyCannedResponse(response.description)}
                    className="h-8 w-8 p-0"
                  >
                    <Copy className="h-4 w-4 text-gray-500" />
                  </Button>
                </div>
              </div>
            ))}
            {cannedResponses?.length === 0 && (
              <div className="py-4 text-center text-gray-500 text-sm">
                No canned responses yet.{" "}
                <Button
                  variant="link"
                  className="h-auto p-0 text-sm"
                  onClick={() => setIsManagementOpen(true)}
                >
                  Create one
                </Button>
              </div>
            )}
          </div>
        </ContentBox>
      )}

      {/* Activity Log */}
      {ticket.activities && ticket.activities.length > 0 && (
        <ContentBox title="Activity Log">
          <div className="space-y-2">
            {ticket.activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-center gap-2 text-gray-600 text-sm"
              >
                <Clock className="h-3 w-3" />
                <span>{activity.author?.username ?? "Deleted User"}</span>
                <span>{activity.action.toLowerCase().replace("_", " ")}</span>
                {activity.oldValue && activity.newValue && (
                  <span>
                    from <strong>{activity.oldValue}</strong> to{" "}
                    <strong>{activity.newValue}</strong>
                  </span>
                )}
                <span>{formatTimeAgo(activity.createdAt)}</span>
              </div>
            ))}
          </div>
        </ContentBox>
      )}

      {/* Canned Responses Management Dialog */}
      {isStaff && canEditCannedResponses(userData?.role) && (
        <CannedResponsesManagement
          isOpen={isManagementOpen}
          setIsOpen={setIsManagementOpen}
          onResponsesChange={handleCannedResponsesChange}
        />
      )}
    </div>
  );
}
