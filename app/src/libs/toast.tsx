import { toast } from "@/components/ui/use-toast";
import { ErrorMessage } from "@hookform/error-message";
import { ToastAction } from "@/components/ui/toast";
import { CheckCircle, XOctagon } from "lucide-react";
import type { FieldErrors } from "react-hook-form";
import type { ToastActionElement } from "src/components/ui/toast";
import type { PostProcessedRewards } from "@/libs/quest";
import type { Quest } from "@/drizzle/schema";
import { parseHtml } from "@/utils/parse";
import Image from "next/image";

/**
 * Convenience wrapper for showing toast
 * @param data
 */
export const showMutationToast = (data: {
  success: boolean;
  message: React.ReactNode;
  title?: string;
  action?: ToastActionElement;
  variant?: "destructive" | "default";
}) => {
  // Only show non-trivial messages
  if (data.message && data.message !== "OK") {
    if (data.success) {
      toast({
        title: data?.title ?? "Success",
        description: data.message,
        variant: data.variant ?? "default",
        action: data.action ?? (
          <ToastAction altText="OK" className="bg-green-600 h-5 md:h-10">
            <CheckCircle className="h-4 w-4 md:h-6 md:w-6 text-white my-4" />
          </ToastAction>
        ),
      });
    } else {
      toast({
        title: data?.title ?? "Error",
        description: data.message,
        variant: data.variant ?? "default",
        action: data.action ?? (
          <ToastAction altText="OK" className="bg-red-600 h-5 md:h-10">
            <XOctagon className="h-4 w-4 md:h-6 md:w-6 text-white my-4" />
          </ToastAction>
        ),
      });
    }
  }
};

/**
 * Show hookForm errors as a toast
 * @param errors
 */
export const showFormErrorsToast = (errors: FieldErrors<any>) => {
  const msgs = (
    <>
      {Object.keys(errors).map((key, i) => {
        if (key) {
          return (
            <ErrorMessage
              key={i}
              errors={errors}
              name={key}
              render={({ message }: { message: string }) => (
                <p>
                  <b>{key}:</b> {message ? message : "See form for details"}
                </p>
              )}
            />
          );
        } else {
          return (
            <p key={i}>
              <b>Overall:</b> {errors[key]?.message as string}
            </p>
          );
        }
      })}
    </>
  );
  toast({
    variant: "destructive",
    title: "Form Validation Error",
    description: msgs,
  });
};

/**
 * Message to show in a toast when rewards are collected
 * @param notifications - Notifications to show
 * @param resolved - Whether the quest was resolved
 * @param quest - The quest that was completed
 * @param rewards - The rewards that were collected
 * @returns The message to show in a toast
 */
export const showRewardToast = (
  notifications: string[],
  rewards: PostProcessedRewards,
  title: string,
  resolved?: boolean,
  quest?: Quest,
  badges?: { id: string; name: string; image: string }[],
) => {
  const message = (
    <div className="flex flex-col gap-2">
      {notifications.length > 0 && (
        <div className="flex flex-col gap-2">
          {notifications.map((description, i) => (
            <div key={`objective-success-${i}`}>
              <b>Objective {i + 1}:</b>
              <br />
              <i>{parseHtml(description)}</i>
            </div>
          ))}
        </div>
      )}
      {resolved && quest?.successDescription && (
        <div>
          <b>Quest Completed:</b>
          <br />
          <i>{parseHtml(quest.successDescription)}</i>
        </div>
      )}
      <div className="flex flex-row items-center">
        <div className="flex flex-col basis-2/3">
          {rewards.reward_money > 0 && (
            <span>
              <b>Money:</b> {rewards.reward_money} ryo
            </span>
          )}
          {rewards.reward_clanpoints > 0 && (
            <span>
              <b>Clan points:</b> {rewards.reward_clanpoints}
            </span>
          )}
          {rewards.reward_exp > 0 && (
            <span>
              <b>Experience:</b> {rewards.reward_exp}
            </span>
          )}
          {rewards.reward_tokens > 0 && (
            <span>
              <b>Village tokens:</b> {rewards.reward_tokens}
            </span>
          )}
          {rewards.reward_prestige > 0 && (
            <span>
              <b>Village prestige:</b> {rewards.reward_prestige}
            </span>
          )}
          {rewards.reward_reputation > 0 && (
            <span>
              <b>Reputation points:</b> {rewards.reward_reputation}
            </span>
          )}
          {rewards.reward_jutsus.length > 0 && (
            <span>
              <b>Jutsus: </b> {rewards.reward_jutsus.join(", ")}
            </span>
          )}
          {rewards.reward_badges.length > 0 && (
            <span>
              <b>Badges: </b> {rewards.reward_badges.join(", ")}
            </span>
          )}
          {rewards.reward_bloodlines.length > 0 && (
            <span>
              <b>Swappable Bloodlines: </b> {rewards.reward_bloodlines.join(", ")}
            </span>
          )}
          {rewards.reward_items.length > 0 && (
            <span>
              <b>Items: </b>
              {rewards.reward_items.join(", ")}
            </span>
          )}
        </div>
        <div className="basis-1/3 flex flex-col">
          {badges?.map((badge, i) => (
            <Image
              key={i}
              src={badge.image}
              width={128}
              height={128}
              alt={badge.name}
            />
          ))}
        </div>
      </div>
    </div>
  );
  // Show the toast
  showMutationToast({
    success: true,
    message: message,
    title: title,
  });
};
