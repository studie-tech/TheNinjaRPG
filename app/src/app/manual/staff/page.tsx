"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FileUser, Info, List } from "lucide-react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { StaffApplicationTargetRole } from "@/drizzle/constants";
import { StaffApplicationTargetRoles } from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";
import type { CreateApplicationSchema } from "@/validators/applications";
import { createApplicationSchema } from "@/validators/applications";

export default function Staff() {
  // User Data
  const { data: me } = useUserData();
  const isStaff = me?.role && me.role !== "USER";

  // Users Query
  const { data } = api.profile.getPublicUsers.useQuery(
    { orderBy: "Staff", isAi: false, limit: 50 },
    {},
  );
  const users = data?.data || [];

  // Applications
  const utils = api.useUtils();
  const { data: myApps } = api.applications.list.useQuery({ onlyMine: true });
  const pending = myApps?.data?.find((a) => a.state === "PENDING");

  const form = useForm<CreateApplicationSchema>({
    resolver: zodResolver(createApplicationSchema),
    defaultValues: { targetRole: "CONTENT", motivation: "" },
  });
  const createApp = api.applications.create.useMutation({
    onSuccess: async (res) => {
      showMutationToast(res);
      await utils.applications.list.invalidate();
    },
  });

  // Render results
  return (
    <>
      <ContentBox
        title="TNR Staff"
        subtitle="Structure"
        topRightContent={
          <div className="flex gap-2">
            {pending && (
              <Link href={`/manual/staff/applications/${pending.id}`}>
                <Button>
                  <FileUser className="mr-2 h-5 w-5" />
                  Your Application
                </Button>
              </Link>
            )}
            {isStaff && (
              <Link href={`/manual/staff/applications`}>
                <Button variant={pending ? "default" : "outline"}>
                  <List className="mr-2 h-5 w-5" />
                  Applications
                </Button>
              </Link>
            )}
            {!pending && (
              <Confirm2
                title="Apply for Staff"
                proceed_label="Submit Application"
                button={
                  <Button>
                    <FileUser className="mr-2 h-5 w-5" />
                    Apply
                  </Button>
                }
                isValid={form.formState.isValid}
                onAccept={form.handleSubmit((values) => createApp.mutate(values))}
              >
                <div className="w-[80vw] max-w-[520px] space-y-3">
                  <div>
                    <div className="mb-1 font-semibold">Target Role</div>
                    <Select
                      onValueChange={(v) =>
                        form.setValue("targetRole", v as StaffApplicationTargetRole, {
                          shouldValidate: true,
                        })
                      }
                      value={form.watch("targetRole")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {StaffApplicationTargetRoles.map((r, i) => (
                          <SelectItem key={`${r}-${i}`} value={r}>
                            {r.replace("_", " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <div className="mb-1 font-semibold">
                      Motivation & Qualifications
                    </div>
                    <Textarea
                      placeholder="Tell us why you want to join the staff..."
                      value={form.watch("motivation")}
                      onChange={(e) =>
                        form.setValue("motivation", e.target.value, {
                          shouldValidate: true,
                        })
                      }
                      rows={6}
                    />
                    <div className="mt-1 flex justify-between text-sm">
                      <span className="text-destructive">
                        {form.formState.errors.motivation?.message}
                      </span>
                      <span
                        className={
                          form.watch("motivation").length < 10
                            ? "text-muted-foreground"
                            : "text-green-600"
                        }
                      >
                        {form.watch("motivation").length}/10 min
                      </span>
                    </div>
                  </div>
                </div>
              </Confirm2>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-2">
          {/* Row 1: Coders */}
          <div className="grid grid-cols-3 gap-2">
            <div className="relative rounded-lg bg-slate-300 p-1 font-bold">
              Code Admin & Owner
              <UserList
                users={users.filter((user) => user.role === "CODING-ADMIN")}
                expectedLength={1}
                columnCount={2}
              />
              <Information hoverEffect="hover:fill-slate-500">
                Main responsibility is to set the strategic direction and long-term
                goals, guiding all teams to ensure the game’s success and growth.
                Directly supervises and contributes to maintaining and developing the
                game’s core codebase.
              </Information>
            </div>
            <div className="col-span-2 rounded-lg bg-pink-300 p-1 font-bold">
              Coders
              <UserList
                users={users.filter((user) => user.role === "CODER")}
                expectedLength={4}
                columnCount={4}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-black">
            {/* Column 1: Moderators */}
            <div className="flex flex-col gap-2">
              <div className="relative rounded-lg bg-red-500 p-1 font-bold">
                Moderator Admin
                <UserList
                  users={users.filter((user) => user.role === "MODERATOR-ADMIN")}
                  expectedLength={1}
                />
                <Information hoverEffect="hover:fill-red-800">
                  Main responsibility is to supervise and support our moderation team,
                  ensuring smooth operations and a welcoming environment for all
                  players. Works closely with the Head Moderator to oversee moderator
                  activities, review and address escalated issues, and make high-level
                  decisions on rule enforcement. Guides moderation team in handling
                  reports, applying game guidelines consistently, and fostering a
                  positive, safe community experience.
                </Information>
              </div>
              <div className="rounded-lg bg-emerald-500 p-1 font-bold">
                Head Moderator
                <UserList
                  users={users.filter((user) => user.role === "HEAD_MODERATOR")}
                  expectedLength={1}
                />
              </div>
              <div className="rounded-lg bg-green-800 p-1 font-bold text-white">
                Moderators
                <UserList
                  users={users.filter((user) => user.role === "MODERATOR")}
                  expectedLength={4}
                />
              </div>
            </div>

            {/* Column 2: Content */}
            <div className="flex flex-col gap-2">
              <div className="relative rounded-lg bg-purple-500 p-1 font-bold">
                Content Admin
                <UserList
                  users={users.filter((user) => user.role === "CONTENT-ADMIN")}
                  expectedLength={1}
                />
                <Information hoverEffect="hover:fill-purple-700">
                  Main responsibility is to oversee and manage all in-game content to
                  enhance player engagement and ensure a high-quality experience.
                  Working with content & event members, supervising the creation,
                  review, and implementation of new game elements such as quests, items,
                  jutsus, bloodlines, events etc.
                </Information>
              </div>
              <div className="rounded-lg bg-purple-400 p-1 font-bold">
                Content
                <UserList
                  users={users.filter((user) => user.role === "CONTENT")}
                  expectedLength={6}
                />
              </div>
            </div>

            {/* Column 3: Event */}
            <div className="flex flex-col gap-2">
              <div className="relative rounded-lg bg-rose-300 p-1 font-bold">
                Event Admin
                <UserList
                  users={users.filter((user) => user.role === "EVENT-ADMIN")}
                  expectedLength={1}
                />
                <Information hoverEffect="hover:fill-purple-700">
                  Main responsibility is to oversee and manage all in-game content to
                  enhance player engagement and ensure a high-quality experience.
                  Working with content & event members, supervising the creation,
                  review, and implementation of new game elements such as quests, items,
                  jutsus, bloodlines, events etc.
                </Information>
              </div>
              <div className="rounded-lg bg-orange-600 p-1 font-bold">
                Event
                <UserList
                  users={users.filter((user) => user.role === "EVENT")}
                  expectedLength={5}
                />
              </div>
            </div>
          </div>
        </div>
      </ContentBox>
      <ContentBox title="Staff Guidelines" subtitle="Overall Processes" initialBreak>
        <div className="flex flex-col gap-3">
          <div>
            <b>Hiring Process</b>
            <br />
            Users are strongly discouraged from pestering game staff about staff
            positions. Participate actively and positively in the community, both in
            tavern and on discord, and we will reach out.
          </div>
          <div>
            <b>Staff Conflicts</b>
            <br />
            Staff members may have disagreements, both within teams or across teams,
            e.g. a moderator disagreeing with a piece of content, or a content member
            disagreeing with a moderation decision. It is important to remember that all
            staff members are working towards the same goal: to make the game a better
            place for all players. All such disagreements are expected to be kept out of
            the public eye, both within TNR but also on all other channels, and instead
            be handled by raising the concern &quot;up the ladder&quot;, e.g. from
            moderator to moderator admin, who can then resolve the issue with e.g.
            content admin. If the issue cannot be resolved, it should be escalated to
            the owner, at which point a resolution will be found.
          </div>
          <div>
            <b>Staff Benefits</b>
            <br />
            <ul className="list-disc pl-5">
              <li>
                For every year of service, based on review from direct admin (moderator,
                content, event), the member will be allowed to roll for a random S-rank
                from the S-ranks not currently owned. This is based of admin evaluation
                of actual work + contribution done by the member.
              </li>
              <li>Gold federal support</li>
              <li>Free bloodline reskins</li>
              <li>Free jutsu swaps</li>
            </ul>
          </div>
        </div>
      </ContentBox>
    </>
  );
}

interface UserListProps {
  users: {
    userId: string;
    avatar: string | null;
    username: string;
    level: number;
    role: string;
  }[];
  expectedLength?: number;
  columnCount?: number;
}

const UserList: React.FC<UserListProps> = (props) => {
  // Destructure information
  const { users, expectedLength, columnCount = 2 } = props;
  // Show skeleton if expectedLength is set & there are no users
  if (expectedLength && users.length === 0) {
    return (
      <div
        className={cn(
          expectedLength > 1
            ? `grid grid-cols-1 sm:grid-cols-${columnCount}`
            : "flex flex-row justify-center",
        )}
      >
        {Array.from(
          { length: expectedLength },
          (_, idx) => `staff-skeleton-${idx}`,
        ).map((key) => (
          <Skeleton key={key} className="m-2 aspect-square basis-1/2 rounded-xl" />
        ))}
      </div>
    );
  }

  // Show users
  return (
    <div
      className={cn(
        users.length > 1
          ? `grid grid-cols-1 sm:grid-cols-${columnCount}`
          : "flex flex-row justify-center",
      )}
    >
      {users.map((user, i) => (
        <Link
          className="relative basis-1/2 text-center"
          key={`${user.role}-${i}`}
          href={`/username/${user.username}`}
        >
          <AvatarImage
            href={user.avatar}
            alt={user.username}
            userId={user.userId}
            hover_effect={true}
            priority={true}
            size={100}
          />
          <div>
            <div className="font-bold text-xs">{user.username}</div>
          </div>
        </Link>
      ))}
    </div>
  );
};

interface InformationProps {
  children: React.ReactNode;
  hoverEffect: string;
}

const Information: React.FC<InformationProps> = (props) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Info
          className={cn(
            "absolute right-1 bottom-1 h-6 w-6 hover:cursor-pointer",
            props.hoverEffect,
          )}
        />
      </PopoverTrigger>
      <PopoverContent>
        <div className="relative whitespace-normal">{props.children}</div>
      </PopoverContent>
    </Popover>
  );
};
