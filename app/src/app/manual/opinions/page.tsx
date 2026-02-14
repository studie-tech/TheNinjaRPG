"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import RichInput from "@/layout/RichInput";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { useUserData } from "@/utils/UserContext";
import { type UserReviewSchema, userReviewSchema } from "@/validators/reports";

export default function ManualTravel() {
  // User state
  const { data: userData } = useUserData();

  // Users Query
  const { data, isPending: isLoadingUsers } = api.profile.getPublicUsers.useQuery(
    { orderBy: "Staff", isAi: false, limit: 50 },
    {},
  );
  const users = data?.data || [];

  // Current user reviews
  const { data: userReviews } = api.reports.getUserStaffReviews.useQuery(undefined, {
    enabled: !!userData,
  });

  return (
    <>
      <ContentBox
        title="Opinions"
        subtitle="Let us know that state of affairs"
        defaultBackHref="/manual"
      >
        TNR has always been community-driven; it&apos;s been our strength, but it&apos;s
        also been our weakness, with poor trust between users and staff, toxic
        atmosphere, etc. We wish to change that, and it starts with collecting public
        opinions.
      </ContentBox>
      <ContentBox
        title="Review Staff"
        subtitle="Annonymously share your thoughts"
        initialBreak={true}
      >
        <p className="pb-2 italic">
          Only the game owner will be able to see and review these reports. We collect
          this information to improve the game and the community, not to target specific
          staff members. Abuse of this system will be punished severely and is analyzed
          carefully. Only share your honest opinions, both positive and negative.
        </p>
        {!userData && (
          <p className="pb-2 text-orange-500">
            You need to be signed in to leave reviews.
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
          {users.map((user) => {
            const review = userReviews?.find((r) => r.targetUserId === user.userId);
            return (
              <ReportImage
                key={user.userId}
                user={user}
                positive={review?.positive}
                review={review?.review}
                isLoggedIn={!!userData}
              />
            );
          })}
        </div>
        {isLoadingUsers && <Loader explanation="Loading staff users" />}
      </ContentBox>
    </>
  );
}

interface ReportimageProps {
  user: {
    userId: string;
    avatar: string | null;
    username: string;
    level: number;
    role: string;
  };
  positive?: boolean;
  review?: string;
  isLoggedIn: boolean;
}

const ReportImage: React.FC<ReportimageProps> = (props) => {
  // Destructure information
  const { user, isLoggedIn } = props;

  // Utils
  const utils = api.useUtils();

  // Mutations
  const { mutate: upsertReview, isPending: isCreating } =
    api.reports.upsertStaffReview.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.reports.getUserStaffReviews.invalidate();
      },
    });

  // Form
  const createForm = useForm<UserReviewSchema>({
    resolver: zodResolver(userReviewSchema),
    defaultValues: {
      positive: props.positive,
      review: props.review || "",
      staffUserId: user.userId,
    },
  });
  const watchedPositive = useWatch({
    control: createForm.control,
    name: "positive",
  });

  // Form handlers
  const onSubmit = createForm.handleSubmit((data) => {
    // Must submit either positive or negative
    if (data.positive === undefined) {
      showMutationToast({
        success: false,
        message: "Select positive or negative",
      });
      return;
    }
    upsertReview(data);
  });

  if (isCreating) return <Loader explanation="Creating review" />;

  // Base staff display content
  const staffDisplay = (
    <div className="relative text-center">
      <AvatarImage
        href={user.avatar}
        alt={user.username}
        userId={user.userId}
        hover_effect={isLoggedIn}
        priority={true}
        size={100}
      />
      <div>
        <div className="font-bold">{user.username}</div>
        <div>
          Lvl. {user.level} {capitalizeFirstLetter(user.role)}
        </div>
      </div>
      {props.positive === true && (
        <ThumbsUp className={cn("absolute top-2 right-4 h-6 w-6 fill-orange-500")} />
      )}
      {props.positive === false && (
        <ThumbsDown className={cn("absolute top-2 right-4 h-6 w-6 fill-orange-500")} />
      )}
    </div>
  );

  // If not logged in, just show the staff display without the review popover
  if (!isLoggedIn) {
    return staffDisplay;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{staffDisplay}</PopoverTrigger>
      <PopoverContent>
        <div className="relative max-w-[320px]">
          <div className="flex flex-row gap-2">
            <ThumbsDown
              className={cn(
                "h-6 w-6",
                watchedPositive === false ? "fill-orange-500" : "",
              )}
              onClick={() => createForm.setValue("positive", false)}
            />{" "}
            <ThumbsUp
              className={cn(
                "h-6 w-6",
                watchedPositive === true ? "fill-orange-500" : "",
              )}
              onClick={() => createForm.setValue("positive", true)}
            />{" "}
          </div>
          <Form {...createForm}>
            <form className="space-y-2" onSubmit={onSubmit}>
              <RichInput
                id="review"
                label="Review of this staff member"
                height="300"
                placeholder=""
                control={createForm.control}
                error={createForm.formState.errors.review?.message}
              />
            </form>
            <Button className="mt-2 w-full" onClick={onSubmit}>
              Submit
            </Button>
          </Form>
        </div>
      </PopoverContent>
    </Popover>
  );
};
