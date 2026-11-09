import { Bell, BellOff } from "lucide-react";
import type { ButtonProps } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { useChatMutes } from "@/hooks/useChatMutes";

/**
 * Bell for one conversation or tavern. While all chat is muted it shows muted and turns
 * "mute all" off; otherwise it mutes or unmutes this conversation. Taverns start muted, so
 * they notify only on pings until unmuted. Mutes are saved on the account, so the chat panel
 * and the tavern page always agree.
 */
export function ChatMuteButton({
  label,
  conversationId,
  isTavern = false,
  variant = "ghost",
  size = "icon",
}: {
  label: string;
  conversationId: string;
  isTavern?: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const mutes = useChatMutes();
  const muted = isTavern
    ? mutes.isTavernSilenced(conversationId)
    : mutes.isSilenced(conversationId);
  const action = mutes.chatMuted
    ? "Unmute chat notifications"
    : muted
      ? `Unmute ${label}`
      : `Mute ${label}`;
  const Icon = muted ? BellOff : Bell;
  return (
    <Button
      variant={variant}
      size={size}
      className={size === "icon" ? "w-[32px]" : undefined}
      aria-pressed={muted}
      aria-label={action}
      title={action}
      disabled={mutes.isPending}
      onClick={() =>
        mutes.chatMuted
          ? mutes.setChatMuted(false)
          : isTavern
            ? mutes.toggleTavernMute(conversationId)
            : mutes.toggleMute(conversationId)
      }
    >
      <Icon className={size === "icon" ? "h-[16px] w-[16px]" : "h-6 w-6"} />
    </Button>
  );
}
