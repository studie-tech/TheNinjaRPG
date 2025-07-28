"use client";

import { useState } from "react";
import { use } from "react";
import Link from "next/link";
import ContentBox from "@/layout/ContentBox";
import Post from "@/layout/Post";
import Loader from "@/layout/Loader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SiGithub } from "@icons-pack/react-simple-icons";
import {
  Edit,
  Clock,
  AlertCircle,
  Tag,
  Users,
  Plus,
  Check,
  Copy,
  ExternalLink,
} from "lucide-react";
import { showMutationToast } from "@/libs/toast";
import { api } from "@/app/_trpc/client";
import { useRequiredUserData } from "@/utils/UserContext";
import { canEditCannedResponses, canEscalateToGithub } from "@/utils/permissions";
import { toast } from "sonner";
import {
  SUPPORT_TICKET_STATUS_TRANSITIONS,
  SupportTicketPriorities,
  SupportTicketCategories,
} from "@/drizzle/constants";
import { getStatusIcon } from "@/libs/menus";
import {
  getStatusColor,
  getPriorityColor,
  getCategoryColor,
  formatTimeAgo,
} from "@/libs/support";
import Conversation from "@/layout/Conversation";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import CannedResponsesManagement from "@/layout/CannedResponsesManagement";

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

  // Canned responses state
  const [isManagementOpen, setIsManagementOpen] = useState(false);

  // Derived
  const isStaff = userData?.role && userData?.role !== "USER";

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
  });

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
        toast.success("Canned response copied to clipboard!");
      })
      .catch(() => {
        toast.error("Failed to copy to clipboard");
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
        back_href="/support"
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
                  <Button className="flex items-center gap-1 ">
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
                      <SiGithub className="text-black mr-2" size={10} />
                      {escalateToGithub.isPending
                        ? "Escalating..."
                        : "Escalate to GitHub"}
                    </Button>
                  </div>
                )}
            </>
          }
        >
          <div className="space-y-4">
            {/* Ticket Metadata */}
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>Created {formatTimeAgo(ticket.createdAt)}</span>
              {ticket.assignedTo && (
                <>
                  <Separator orientation="vertical" className="h-4" />
                  <span>Assigned to {ticket.assignedTo.username}</span>
                </>
              )}
            </div>

            {/* Status, Priority, Category & Public Badges with inline controls */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Status */}
              <Popover open={statusOpen} onOpenChange={setStatusOpen}>
                <PopoverTrigger asChild disabled={!canUpdateTicket}>
                  <Badge className={getStatusColor(ticket.status)} role="button">
                    {getStatusIcon(ticket.status)}
                    <span className="ml-1">{ticket.status.replace("_", " ")}</span>
                    {canUpdateTicket && <Edit className="ml-1 h-3 w-3" />}
                  </Badge>
                </PopoverTrigger>
                {canUpdateTicket && (
                  <PopoverContent className="w-48 p-2 space-y-1">
                    {availableStatusTransitions.map((status) => (
                      <button
                        key={status}
                        onClick={() => {
                          updateTicket.mutate({
                            ticketId: params.ticketId,
                            status,
                          });
                          setStatusOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded px-2 py-1 hover:bg-muted ${
                          status === ticket.status ? "font-semibold" : ""
                        }`}
                      >
                        <span className="flex items-center gap-2">
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
              <Popover open={priorityOpen} onOpenChange={setPriorityOpen}>
                <PopoverTrigger asChild disabled={!canUpdateTicket}>
                  <Badge className={getPriorityColor(ticket.priority)} role="button">
                    {ticket.priority}
                    {canUpdateTicket && <Edit className="ml-1 h-3 w-3" />}
                  </Badge>
                </PopoverTrigger>
                {canUpdateTicket && (
                  <PopoverContent className="w-40 p-2 space-y-1">
                    {SupportTicketPriorities.map((p) => (
                      <button
                        key={p}
                        onClick={() => {
                          updateTicket.mutate({
                            ticketId: params.ticketId,
                            priority: p,
                          });
                          setPriorityOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded px-2 py-1 hover:bg-muted ${
                          p === ticket.priority ? "font-semibold" : ""
                        }`}
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
              <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
                <PopoverTrigger asChild disabled={!canUpdateTicket}>
                  <Badge className={getCategoryColor(ticket.category)} role="button">
                    {ticket.category}
                    {canUpdateTicket && <Edit className="ml-1 h-3 w-3" />}
                  </Badge>
                </PopoverTrigger>
                {canUpdateTicket && (
                  <PopoverContent className="w-56 p-2 space-y-1">
                    {SupportTicketCategories.map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          updateTicket.mutate({
                            ticketId: params.ticketId,
                            category: c,
                          });
                          setCategoryOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded px-2 py-1 hover:bg-muted ${
                          c === ticket.category ? "font-semibold" : ""
                        }`}
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
              <Popover open={assignOpen} onOpenChange={setAssignOpen}>
                <PopoverTrigger asChild disabled={!isStaff}>
                  <Badge variant="secondary" role="button">
                    <Users className="h-3 w-3 mr-1" />
                    {ticket.assignedTo ? ticket.assignedTo.username : "Unassigned"}
                    {isStaff && <Edit className="ml-1 h-3 w-3" />}
                  </Badge>
                </PopoverTrigger>
                {isStaff && (
                  <PopoverContent className="w-56 p-2 space-y-1">
                    <button
                      onClick={() => {
                        updateTicket.mutate({
                          ticketId: params.ticketId,
                          assignedToUserId: undefined,
                        });
                        setAssignOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded px-2 py-1 hover:bg-muted ${
                        !ticket.assignedTo ? "font-semibold" : ""
                      }`}
                    >
                      <span>Unassigned</span>
                      {!ticket.assignedTo && <Check className="h-4 w-4 opacity-70" />}
                    </button>
                    {availableStaff.map((staff) => (
                      <button
                        key={staff.userId}
                        onClick={() => {
                          updateTicket.mutate({
                            ticketId: params.ticketId,
                            assignedToUserId: staff.userId,
                          });
                          setAssignOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded px-2 py-1 hover:bg-muted ${
                          ticket.assignedToUserId === staff.userId
                            ? "font-semibold"
                            : ""
                        }`}
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
                onClick={() =>
                  canUpdateTicket &&
                  updateTicket.mutate({
                    ticketId: params.ticketId,
                    isPublic: !ticket.isPublic,
                  })
                }
                className={`${canUpdateTicket ? "cursor-pointer hover:bg-muted" : ""}`}
              >
                <Users className="h-3 w-3 mr-1" />
                {ticket.isPublic ? "Public" : "Private"}
              </Badge>
              {/* End Public */}
            </div>

            {/* Tags with add functionality */}
            <div className="flex items-center gap-1 flex-wrap">
              <Tag className="h-3 w-3 text-gray-500" />
              {ticket.tags.map((tag, index) => (
                <Badge key={index} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
              {canUpdateTicket && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-gray-500 hover:text-orange-500"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-60">
                    <div className="flex items-center gap-2">
                      <Input
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        placeholder="New tag"
                      />
                      <Button
                        onClick={() => {
                          const tagToAdd = newTag.trim();
                          if (tagToAdd.length > 0 && !ticket.tags.includes(tagToAdd)) {
                            updateTicket.mutate({
                              ticketId: params.ticketId,
                              tags: [...ticket.tags, tagToAdd],
                            });
                            setNewTag("");
                          }
                        }}
                      >
                        Add
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
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
        onCommentPosted={() => {
          updateTicket.mutate({
            ticketId: params.ticketId,
            status: "IN_PROGRESS",
          });
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
              <Plus className="h-4 w-4 mr-2" />
              Manage
            </Button>
          }
        >
          <div className="space-y-3">
            {cannedResponses?.map((response) => (
              <div
                key={response.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex-1">
                  <h4 className="font-medium text-sm">{response.title}</h4>
                  <p className="text-xs text-gray-600 mt-1 line-clamp-2">
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
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            {cannedResponses?.length === 0 && (
              <div className="text-center py-4 text-gray-500 text-sm">
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
                className="flex items-center gap-2 text-sm text-gray-600"
              >
                <Clock className="h-3 w-3" />
                <span>{activity.author.username}</span>
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
