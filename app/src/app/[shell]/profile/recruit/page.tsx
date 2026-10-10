"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Check,
  CheckCircle2,
  ClipboardCopy,
  Clock,
  ExternalLink,
  Info,
  Loader2,
  Trophy,
} from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  ACTIVE_VOTING_SITES,
  RECRUIT_RANK_MILESTONES,
  type RecruitMilestoneRank,
  type RecruitMilestoneStatus,
} from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import NavTabs from "@/layout/NavTabs";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { useInfinitePagination } from "@/libs/pagination";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { getVotingLink } from "@/libs/voting";
import { canReviewLinkPromotions } from "@/utils/permissions";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  type LinkPromotionInput,
  type LinkPromotionReviewInput,
  linkPromotionReviewSchema,
  linkPromotionSchema,
} from "@/validators/linkPromotion";

export default function Recruit() {
  // State
  const { data: userData, updateUser } = useRequiredUserData();
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const [recruitTab, setRecruitTab] = useState<string>("Link");

  // tRPC utility

  // mutations
  const { mutate: claimVotes, isPending } = api.profile.claimVotes.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success && userData && userData?.votes) {
        await updateUser({
          reputationPoints: userData.reputationPoints + 1,
          reputationPointsTotal: userData.reputationPointsTotal + 1,
          votes: { ...userData.votes, userId: userData.userId, claimed: true },
        });
      }
    },
  });

  // Queries
  const {
    data: users,
    fetchNextPage,
    hasNextPage,
  } = api.profile.getPublicUsers.useInfiniteQuery(
    {
      limit: 30,
      orderBy: "Strongest",
      recruiterId: userData?.userId,
    },
    {
      enabled: !!userData?.userId,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
      staleTime: 1000 * 60 * 5, // every 5min
    },
  );

  const { data: milestoneSummary } = api.profile.getRecruitMilestones.useQuery(
    undefined,
    {
      enabled: !!userData?.userId,
      staleTime: 1000 * 60 * 5,
    },
  );

  // Infinite pagination
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Loader
  if (!userData) return <Loader explanation="Loading profile page..." />;

  // Voting progress
  const totalVotes = ACTIVE_VOTING_SITES.length;
  const completedVotes = ACTIVE_VOTING_SITES.filter(
    (site) => userData?.votes?.[site],
  ).length;
  const progress = (completedVotes / totalVotes) * 100;
  const allVotesCompleted = completedVotes === totalVotes;

  // Process data
  const summaryByRecruit = new Map(
    (milestoneSummary ?? []).map((s) => [s.recruitUserId, s]),
  );
  const allUsers = (users?.pages.flatMap((page) => page.data) ?? []).map((user) => {
    const summary = summaryByRecruit.get(user.userId);
    return {
      ...user,
      eligibility: <RecruitEligibilityBadge eligibility={summary?.eligibility} />,
      milestones: <RecruitMilestoneChips milestones={summary?.milestones} />,
    };
  });
  type User = ArrayElement<typeof allUsers>;

  const recruitedColumns: ColumnDefinitionType<User, keyof User>[] = [
    { key: "avatar", header: "", type: "avatar", className: "hidden @lg:table-cell" },
    { key: "username", header: "Username", type: "string" },
    { key: "level", header: "Level", type: "string" },
    {
      key: "reputationPointsTotal",
      header: "Reputation Points",
      type: "string",
      className: "hidden @2xl:table-cell",
    },
    {
      key: "milestones",
      header: <MilestoneRulesHeader label="Milestones" />,
      type: "jsx",
    },
    {
      key: "eligibility",
      header: <MilestoneRulesHeader label="Eligibility" />,
      type: "jsx",
    },
  ];

  return (
    <>
      <ContentBox
        title="TNR Promotion"
        subtitle="Earn by helping us grow"
        defaultBackHref="/profile"
      >
        <p className="mb-4 italic">
          Vote on the following sites to earn reputation points. Once you have voted on
          all voting sites, and the votes have succesfully registered, you can claim 1
          reputation point per day. Note that sites may be added/removed from this list
          regularly.
        </p>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {ACTIVE_VOTING_SITES.map((site) => {
              const hasVoted = userData?.votes?.[site];
              return (
                <Button
                  key={site}
                  variant={hasVoted ? "default" : "outline"}
                  className="flex h-12 items-center justify-between gap-2"
                  onClick={() => {
                    if (userData?.votes) {
                      window.open(getVotingLink(site, userData.votes), "_blank");
                    }
                  }}
                >
                  <span>{site}</span>
                  {hasVoted ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <ExternalLink className="h-5 w-5" />
                  )}
                </Button>
              );
            })}
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Progress</span>
              <span>
                {completedVotes} / {totalVotes} votes
              </span>
            </div>
            <Progress value={progress} />
          </div>

          <Button
            className="flex h-12 w-full items-center justify-center gap-2"
            disabled={!allVotesCompleted || isPending || userData?.votes?.claimed}
            onClick={() => claimVotes()}
            decoration="gold"
            animation="pulse"
          >
            {isPending ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Claiming</span>
              </>
            ) : (
              <>
                {userData?.votes?.claimed ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : (
                  <Trophy className="h-5 w-5" />
                )}
                <span>Claim Reputation Point</span>
              </>
            )}
          </Button>
        </div>
      </ContentBox>
      <ContentBox
        title="Recruitment"
        subtitle="Recruit new members to your village"
        initialBreak
        topRightContent={
          <NavTabs
            id="recruitmentTabs"
            current={recruitTab}
            options={["Link", "Guide", "Rewards"]}
            setValue={setRecruitTab}
          />
        }
      >
        {recruitTab === "Link" && <RecruitLinkTab />}
        {recruitTab === "Guide" && <RecruitGuideTab />}
        {recruitTab === "Rewards" && <RecruitRewardsTab />}
      </ContentBox>

      {allUsers && allUsers.length > 0 && (
        <ContentBox
          title="Recruits"
          subtitle="Members recruited by you"
          initialBreak={true}
          padding={false}
        >
          {/* Columns hide by the box's own width, which the game layout makes narrower
              than the viewport on desktop. */}
          <div className="@container">
            <Table
              data={allUsers}
              columns={recruitedColumns}
              linkPrefix="/username/"
              linkColumn={"username"}
              setLastElement={setLastElement}
            />
          </div>
        </ContentBox>
      )}
    </>
  );
}

// Subcomponents
const RecruitLinkTab: React.FC = () => {
  // State
  const { data: userData } = useRequiredUserData();
  const recruitUrl = `https://www.theninja-rpg.com/?ref=${userData?.userId ?? ""}`;
  const [genin, chunin, jonin, eliteJonin] = RECRUIT_RANK_MILESTONES;
  const [copied, setCopied] = useState<boolean>(false);

  // Render
  return (
    <div>
      <p className="italic">
        Every new member you recruit for your village will potentially earn you rewards.
        We hope you will help us spread the word of the game and invite your friends (or
        strangers) to join you in your journey. (PS. recruitments during alpha & beta
        versions of the game will still be active in final release)
      </p>
      <ul className="py-2">
        <li className="px-2 py-2">
          <strong>Money</strong>
          <br />
          Each time a recruited user levels up, you will receive money in your bank
          account according to the following formula: <code>10 x level³</code>. i.e. if
          a person you recruited achieved level 50, you get {(1250000).toLocaleString()}{" "}
          ryo.
        </li>
        <li className="px-2 py-2">
          <strong>Reputation Points</strong>
          <br />
          Every time a recruited user buys reputation points, you will also receive an
          amount of reputation points equal to 10% of what they bought.
        </li>
        <li className="px-2 py-2">
          <strong>Village Prestige</strong>
          <br />
          Every time a recruited user earns village prestige from quests, you will
          receive 10% of the prestige they earn.
        </li>
        <li className="px-2 py-2">
          <strong>Rank Milestones</strong>
          <br />
          When a recruit reaches Genin you receive {genin.reputation} reputation point,
          Chunin {chunin.reputation}, Jonin {jonin.reputation}, Elite Jonin{" "}
          {eliteJonin.reputation}. Recruits who sign up from an IP address already used
          by another account still count as your recruits but are not eligible for rank
          milestone rewards.
        </li>
      </ul>
      <button
        type="button"
        className={`flex w-full flex-row items-center rounded-lg border bg-card p-4 text-card-foreground italic hover:bg-popover ${!copied ? "cursor-copy" : "cursor-no-drop"}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(recruitUrl);
            setCopied(true);
          } catch (_error) {
            showMutationToast({
              success: false,
              message: "Could not copy to clipboard. Please copy the link manually.",
            });
          }
        }}
      >
        <p className="grow">{recruitUrl}</p>
        <ClipboardCopy className="h-8 w-8" />
      </button>
    </div>
  );
};

const RecruitGuideTab: React.FC = () => {
  // State
  const { data: userData } = useRequiredUserData();

  // Form
  const linkForm = useForm<LinkPromotionInput>({
    resolver: zodResolver(linkPromotionSchema),
    defaultValues: { url: "" },
  });

  // tRPC utility
  const utils = api.useUtils();

  // Mutations
  const submitPromotion = api.linkPromotion.submitLinkPromotion.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        linkForm.reset();
        void utils.linkPromotion.getLinkPromotions.invalidate();
      }
    },
  });
  // Queries
  const {
    data: promotions,
    fetchNextPage,
    hasNextPage,
  } = api.linkPromotion.getLinkPromotions.useInfiniteQuery(
    {
      limit: 30,
      userId: userData?.userId || "placeholder",
    },
    {
      enabled: !!userData?.userId,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
      staleTime: 1000 * 60 * 5,
    },
  );
  const rawPromotions = promotions?.pages.flatMap((page) => page.data) ?? [];
  const allPromotions = rawPromotions.map((promotion) => ({
    ...promotion,
    reviewed: promotion.reviewed
      ? promotion.points > 0
        ? "Reviewed"
        : "Rejected"
      : "Pending",
    user:
      userData && canReviewLinkPromotions(userData.role) ? (
        <div className="w-20 text-center">
          <AvatarImage
            href={promotion.user.avatar}
            alt={promotion.user.username || "Unknown"}
            size={100}
          />
          <p>{promotion.user.username}</p>
        </div>
      ) : null,
    actions:
      !promotion.reviewed && userData && canReviewLinkPromotions(userData.role) ? (
        <ReviewPromotionAction
          promotionId={promotion.id}
          promotionUrl={promotion.url}
        />
      ) : null,
  }));

  // Table definitions
  type Promotion = ArrayElement<typeof allPromotions>;
  const linkColumns: ColumnDefinitionType<Promotion, keyof Promotion>[] = [
    { key: "actions", header: "", type: "jsx" },
    { key: "url", header: "URL", type: "string" },
    { key: "points", header: "Points", type: "string" },
    { key: "reviewed", header: "Status", type: "string" },
  ];
  if (userData) linkColumns.push({ key: "user", header: "", type: "jsx" });
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Render
  return (
    <div>
      <div>
        Share your recruitment link on other websites and social media to earn
        additional reputation points! A high-quality blog post on a high authority
        gaming site can earn you up to 300 reputation points. In addition, for the
        duration of the beta, we will monitor the links performing the best (based on
        below evaluation criteria), and will award <b>a random S-rank bloodline</b> to
        the user who post the best promotion link. Our review system evaluates multiple
        factors to determine the reward amount:
        <div className="space-y-1 rounded-lg bg-card p-4">
          <h3 className="font-semibold">Evaluation Criteria:</h3>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              Website reputation and visibility (high-profile gaming sites receive
              better rewards)
            </li>
            <li>Relevance to the gaming community and target audience</li>
            <li>
              Quality and engagement of recruited players (their activity level and
              progression)
            </li>
            <li>Overall presentation and context of your promotion</li>
          </ul>
        </div>
        <div className="space-y-1 rounded-lg bg-card p-4">
          <h3 className="font-semibold">Recommended Promotion Strategies:</h3>
          <ul className="list-disc space-y-1 pl-6">
            <li>Write detailed blog posts or reviews about your game experience</li>
            <li>
              Share on popular gaming forums (Reddit, GameFAQs, MMORPG.com, medium.com,
              etc.)
            </li>
            <li>Create content on gaming-focused social media channels</li>
            <li>
              Participate in relevant gaming communities and share your experiences
            </li>
            <li>
              <b>Focus on sharing your link in publicly accessible locations</b>
            </li>
            <li className="text-red-500">
              <b>Always follow the rules whereever you decide to promote!</b>
            </li>
          </ul>
        </div>
        <Form {...linkForm}>
          <form
            onSubmit={linkForm.handleSubmit((data) => submitPromotion.mutate(data))}
            className="mt-4 flex flex-row gap-2"
          >
            <FormField
              control={linkForm.control}
              name="url"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input
                      placeholder="Enter URL where you promoted your link..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={submitPromotion.isPending}>
              Submit
            </Button>
          </form>
        </Form>
        {allPromotions.length > 0 && (
          <div className="mt-4">
            <Table
              data={allPromotions}
              columns={linkColumns}
              setLastElement={setLastElement}
            />
          </div>
        )}
      </div>
    </div>
  );
};

interface ReviewPromotionActionProps {
  promotionId: string;
  promotionUrl: string;
}

const ReviewPromotionAction: React.FC<ReviewPromotionActionProps> = ({
  promotionId,
  promotionUrl,
}) => {
  const utils = api.useUtils();
  const submissionInFlight = useRef(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reviewComplete, setReviewComplete] = useState(false);
  const reviewForm = useForm<LinkPromotionReviewInput>({
    resolver: zodResolver(linkPromotionReviewSchema),
    defaultValues: { id: promotionId, points: 0 },
    mode: "onChange",
  });
  const reviewPromotion = api.linkPromotion.reviewLinkPromotion.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        // The server has already committed the award. Settle this control before
        // refreshing so a failed refetch can never offer the mutation again.
        setReviewComplete(true);
        setDialogOpen(false);
        void utils.linkPromotion.getLinkPromotions.invalidate().catch(() => undefined);
      }
    },
    onError: (error) => {
      showMutationToast({ success: false, message: error.message });
    },
  });

  const review = () => {
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    void reviewForm.handleSubmit(
      async (values) => {
        try {
          await reviewPromotion.mutateAsync(values);
        } catch {
          // The mutation callback presents the error and the form stays open for retry.
        } finally {
          submissionInFlight.current = false;
        }
      },
      () => {
        submissionInFlight.current = false;
      },
    )();
  };

  return (
    <>
      <Button
        type="button"
        disabled={reviewPromotion.isPending || reviewComplete}
        onClick={() => setDialogOpen(true)}
      >
        {reviewPromotion.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {reviewComplete
          ? "Reviewed"
          : reviewPromotion.isPending
            ? "Reviewing"
            : "Review"}
      </Button>
      <Modal
        id={`review-promotion-${promotionId}`}
        title="Review Link Promotion"
        isOpen={dialogOpen}
        setIsOpen={setDialogOpen}
        proceed_label="Award Points"
        proceed_loading_label="Awarding"
        isLoading={reviewPromotion.isPending}
        keepOpenOnAccept
        onAccept={review}
      >
        <Form {...reviewForm}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              review();
            }}
          >
            <p className="text-muted-foreground text-sm">URL: {promotionUrl}</p>
            <FormField
              control={reviewForm.control}
              name="points"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Points to award</FormLabel>
                  <FormControl>
                    <NumberInput
                      min={0}
                      max={500}
                      step={1}
                      inputMode="numeric"
                      disabled={reviewPromotion.isPending}
                      value={field.value}
                      onBlur={field.onBlur}
                      onValueChange={field.onChange}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </Modal>
    </>
  );
};

const RecruitRewardsTab: React.FC = () => {
  // State
  const { data: userData } = useRequiredUserData();

  // Query
  const {
    data: rewardsQuery,
    fetchNextPage,
    hasNextPage,
  } = api.profile.getRecruitmentRewards.useInfiniteQuery(
    { limit: 30 },
    {
      enabled: !!userData?.userId,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
      staleTime: 1000 * 60 * 5,
    },
  );
  const rewards = rewardsQuery?.pages?.flatMap((p) => p.data) ?? [];
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Table data
  const tableData = rewards.map((r) => ({
    ...r,
    recruited: (
      <div className="w-20 text-center">
        <AvatarImage
          href={r.recruitedUser?.avatar || ""}
          alt={r.recruitedUser?.username || ""}
          size={100}
        />
        <p>{r.recruitedUser?.username}</p>
      </div>
    ),
  }));

  // Table definitions
  type Reward = ArrayElement<typeof tableData>;
  const cols: ColumnDefinitionType<Reward, keyof Reward>[] = [
    { key: "type", header: "Type", type: "string" },
    { key: "amount", header: "Amount", type: "number" },
    { key: "createdAt", header: "Date", type: "date" },
    { key: "recruited", header: "Recruited", type: "jsx" },
  ];
  return (
    <div>
      {tableData.length === 0 && <p>No rewards yet.</p>}
      {tableData.length > 0 && (
        <Table data={tableData} columns={cols} setLastElement={setLastElement} />
      )}
    </div>
  );
};

type RecruitEligibility = "ELIGIBLE" | "SHARED_IP" | "UNVERIFIED";
type RecruitMilestone = {
  rank: RecruitMilestoneRank;
  reputation: number;
  reached: boolean;
  paid: boolean;
  status: RecruitMilestoneStatus | null;
  reputationAwarded: number;
};

const RecruitEligibilityBadge: React.FC<{
  eligibility: RecruitEligibility | undefined;
}> = ({ eligibility }) => {
  // Reserve the badge's footprint while the summary loads so the row does not shift.
  if (!eligibility) return <span className="inline-block h-5 w-20" />;
  const isEligible = eligibility === "ELIGIBLE";
  const label = isEligible ? "Eligible" : "Ineligible";
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          badgeVariants({ variant: isEligible ? "default" : "destructive" }),
          "cursor-pointer gap-1 whitespace-nowrap",
          isEligible && "bg-green-600 text-white hover:bg-green-700",
        )}
        aria-label={`${label}: show details`}
        onClick={(e) => e.stopPropagation()}
      >
        {label}
        <Info className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverContent className="w-64 text-sm" onClick={(e) => e.stopPropagation()}>
        {ELIGIBILITY_EXPLANATION[eligibility]}
      </PopoverContent>
    </Popover>
  );
};

const RecruitMilestoneChips: React.FC<{
  milestones: RecruitMilestone[] | undefined;
}> = ({ milestones }) => {
  if (!milestones) return <span className="inline-block h-5 w-28" />;
  return (
    <Popover>
      <PopoverTrigger
        className="flex cursor-pointer items-center gap-0.5 whitespace-nowrap rounded-md"
        aria-label="Show rank milestone details"
        onClick={(e) => e.stopPropagation()}
      >
        {milestones.map((m) => (
          <MilestoneChip key={m.rank} milestone={m} />
        ))}
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm" onClick={(e) => e.stopPropagation()}>
        <ul className="space-y-1">
          {milestones.map((m) => (
            <li key={m.rank} className="flex items-start gap-2">
              <MilestoneChip milestone={m} />
              <span>
                <strong>{formatRank(m.rank)}</strong>: {describeMilestone(m)}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};

const MilestoneChip: React.FC<{
  milestone: Pick<RecruitMilestone, "rank" | "reached" | "paid" | "status">;
}> = ({ milestone }) => {
  const state = milestoneState(milestone);
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-0.5 rounded border px-1 font-semibold text-[10px] leading-none",
        state === "paid" && "border-green-600 bg-green-600 text-white",
        state === "unpaid" &&
          "border-muted bg-muted text-muted-foreground line-through",
        state === "before" && "border-muted bg-muted text-muted-foreground",
        state === "pending" &&
          "border-muted-foreground/50 border-dashed text-muted-foreground",
      )}
    >
      {MILESTONE_SHORT_LABEL[milestone.rank]}
      {state === "paid" && <Check className="h-2.5 w-2.5" />}
      {state === "before" && <Clock className="h-2.5 w-2.5" />}
    </span>
  );
};

const MilestoneRulesHeader: React.FC<{ label: string }> = ({ label }) => (
  <span className="inline-flex items-center gap-1">
    {label}
    <Popover>
      <PopoverTrigger
        className="cursor-pointer rounded-full"
        aria-label="How rank milestone rewards work"
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2 text-sm normal-case">
        <p>
          When an eligible recruit first reaches a rank you receive:{" "}
          {RECRUIT_RANK_MILESTONES.map(
            (m) =>
              `${formatRank(m.rank)} ${m.reputation} ${m.reputation === 1 ? "point" : "points"}`,
          ).join(", ")}
          . Each milestone is paid at most once per recruit.
        </p>
        <p>
          Recruits who sign up from an IP address already used by another account still
          count as your recruits but are not eligible for rank milestone rewards.
        </p>
        <ul className="space-y-1">
          {MILESTONE_LEGEND.map(({ example, text }) => (
            <li key={text} className="flex items-center gap-2">
              <MilestoneChip milestone={example} />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  </span>
);

// Helpers
const formatRank = (rank: string) =>
  rank
    .split(" ")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");

const milestoneState = (
  m: Pick<RecruitMilestone, "reached" | "paid" | "status">,
): "paid" | "unpaid" | "before" | "pending" => {
  if (m.paid) return "paid";
  if (m.status === "PRE_EXISTING") return "before";
  if (m.reached) return "unpaid";
  return "pending";
};

const describeMilestone = (m: RecruitMilestone) => {
  switch (milestoneState(m)) {
    case "paid":
      return `+${m.reputationAwarded} reputation ${m.reputationAwarded === 1 ? "point" : "points"} paid`;
    case "before":
      return "reached before rank milestones existed";
    case "unpaid":
      return m.status === "NO_RECRUITER"
        ? "reached, not paid"
        : "reached, not paid (not eligible)";
    case "pending":
      return `not reached yet (+${m.reputation})`;
  }
};

const MILESTONE_SHORT_LABEL: Record<RecruitMilestoneRank, string> = {
  GENIN: "G",
  CHUNIN: "C",
  JONIN: "J",
  "ELITE JONIN": "EJ",
};

const MILESTONE_LEGEND = [
  {
    example: { rank: "GENIN", reached: true, paid: true, status: "PAID" },
    text: "Paid",
  },
  {
    example: { rank: "GENIN", reached: true, paid: false, status: "PRE_EXISTING" },
    text: "Reached before rank milestones existed",
  },
  {
    example: { rank: "GENIN", reached: true, paid: false, status: "INELIGIBLE" },
    text: "Reached, not paid",
  },
  {
    example: { rank: "GENIN", reached: false, paid: false, status: null },
    text: "Not reached yet",
  },
] as const;

const ELIGIBILITY_EXPLANATION: Record<RecruitEligibility, string> = {
  ELIGIBLE: "Eligible for rank milestone rewards.",
  SHARED_IP:
    "Signed up from an IP address already used by another account. Still counts as your recruit, but rank milestones are not paid.",
  UNVERIFIED:
    "Eligibility could not be verified for this recruit. Still counts as your recruit, but rank milestones are not paid.",
};
