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
}: {
  label: string;
  conversationId: string;
  isTavern?: boolean;
  variant?: ButtonProps["variant"];
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
  return (
    <Button
      variant={variant}
      size="icon"
      className="w-[32px]"
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
      {muted ? (
        <BellOff className="h-[16px] w-[16px]" />
      ) : (
        <Bell className="h-[16px] w-[16px]" />
      )}
    </Button>
  );
}
