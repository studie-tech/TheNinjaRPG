"use client";
import { SendHorizontal } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import Link from "@/layout/Link";

/**
 * Email Reminder Settings component that shows a button to redirect to the email settings page
 */
export const EmailReminderSettings: React.FC<{
  emailReminder: { email: string; secret: string };
}> = ({ emailReminder }) => {
  const emailSettingsUrl = `/emailsettings?email=${encodeURIComponent(emailReminder.email)}&secret=${encodeURIComponent(emailReminder.secret)}`;

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-2 pb-4">
        <p className="text-muted-foreground text-sm">
          You have email reminders set up for:{" "}
          <span className="font-medium">{emailReminder.email}</span>
        </p>
        <p className="text-muted-foreground text-sm">
          Click the button below to manage your email notification preferences.
        </p>
      </div>

      <Link href={emailSettingsUrl}>
        <Button className="flex items-center gap-2">
          <SendHorizontal className="h-4 w-4" />
          Manage Email Settings
        </Button>
      </Link>
    </div>
  );
};
