import { toast } from "@/components/ui/use-toast";

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
          <ToastAction
            altText="OK"
            className="bg-green-600 h-5 md:h-10"
            onClick={() => toast.dismiss()}
          >
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
          <ToastAction
            altText="OK"
            className="bg-red-600 h-5 md:h-10"
            onClick={() => toast.dismiss()}
          >
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
  // Recursively extract error messages from FieldErrors
  const extractMessages = (
    errs: FieldErrors<any>,
    parentKey = "",
  ): React.ReactNode[] => {
    return Object.entries(errs).flatMap(([key, value]) => {
      const fullKey = parentKey ? `${parentKey}.${key}` : key;
      if (!value) return [];
      if (typeof value.message === "string" && value.message) {
        return (
          <p key={fullKey}>
            <b>{fullKey}:</b> {value.message}
          </p>
        );
      }
      // If value is an array (e.g. for field arrays), recurse into each item
      if (Array.isArray(value)) {
        return value.flatMap((item, i) =>
          item ? extractMessages(item as FieldErrors<any>, `${fullKey}[${i}]`) : [],
        );
      }
      // If value is an object, recurse into it
      if (typeof value === "object") {
        return extractMessages(value as FieldErrors<any>, fullKey);
      }
      return [];
    });
  };

  const msgs = <>{extractMessages(errors)}</>;

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
          {rewards.reward_seichi_silver > 0 && (
            <span>
              <b>Seichi Silver:</b> {rewards.reward_seichi_silver}
            </span>
          )}
          {rewards.reward_clanpoints > 0 && (
            <span>
              <b>Clan points:</b> {rewards.reward_clanpoints}
            </span>
          )}
          {rewards.reward_anbupoints > 0 && (
            <span>
              <b>Anbu points:</b> {rewards.reward_anbupoints}
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
          {rewards.reward_skillpoints > 0 && (
            <span>
              <b>Skill points:</b> {rewards.reward_skillpoints}
            </span>
          )}
          {rewards.reward_medical_experience > 0 && (
            <span>
              <b>Medical experience:</b> {rewards.reward_medical_experience}
            </span>
          )}
          {rewards.reward_hunting_experience > 0 && (
            <span>
              <b>Hunting experience:</b> {rewards.reward_hunting_experience}
            </span>
          )}
          {rewards.reward_crafting_experience > 0 && (
            <span>
              <b>Crafting experience:</b> {rewards.reward_crafting_experience}
            </span>
          )}
          {rewards.reward_gathering_experience > 0 && (
            <span>
              <b>Gathering experience:</b> {rewards.reward_gathering_experience}
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
